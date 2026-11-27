// Fee sponsor: co-signs (as fee payer only) transactions that touch nothing but
// the Fungu program, the compute-budget program and idempotent token-account
// creation. Users therefore never need SOL, and the sponsor can't be used to
// pay for anything else.
import { NextResponse } from "next/server";
import { ComputeBudgetProgram, Transaction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PROGRAM_ID } from "@/lib/config";
import { connection, sponsorKey } from "@/lib/server";

export const runtime = "nodejs";

const ALLOWED = new Set([PROGRAM_ID.toBase58(), ComputeBudgetProgram.programId.toBase58(), ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()]);
const MAX_IX = 6;

export async function POST(req: Request) {
  let tx: Transaction;
  try {
    const { tx: b64 } = (await req.json()) as { tx?: string };
    if (!b64 || b64.length > 2000) return bad("missing or oversized transaction");
    tx = Transaction.from(Buffer.from(b64, "base64"));
  } catch {
    return bad("unreadable transaction");
  }
  const sponsor = sponsorKey();
  if (!tx.feePayer?.equals(sponsor.publicKey)) return bad("fee payer must be the Fungu sponsor");
  if (tx.instructions.length === 0 || tx.instructions.length > MAX_IX) return bad("wrong number of instructions");
  for (const ix of tx.instructions) {
    const pid = ix.programId.toBase58();
    if (!ALLOWED.has(pid)) return bad(`program ${pid} is not allowed`);
    // ATA program: only CreateIdempotent (data = [1]) is allowed
    if (pid === ASSOCIATED_TOKEN_PROGRAM_ID.toBase58() && !(ix.data.length === 1 && ix.data[0] === 1)) return bad("only idempotent token-account creation is allowed");
    // the sponsor may appear in Fungu instructions only as the rent/fee payer (first account)
    if (pid === PROGRAM_ID.toBase58()) {
      const idx = ix.keys.findIndex((k) => k.pubkey.equals(sponsor.publicKey));
      if (idx > 0) return bad("sponsor can only be the fee payer");
    }
  }
  tx.partialSign(sponsor);
  if (!tx.verifySignatures()) return bad("missing user signature");
  const conn = connection();
  try {
    const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
    const bh = { blockhash: tx.recentBlockhash!, lastValidBlockHeight: (await conn.getLatestBlockhash()).lastValidBlockHeight };
    const res = await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    if (res.value.err) return NextResponse.json({ ok: false, signature: sig, error: JSON.stringify(res.value.err) }, { status: 400 });
    return NextResponse.json({ ok: true, signature: sig });
  } catch (e) {
    const err = e as { message?: string; logs?: string[] };
    const logs = err.logs ?? [];
    const msg = logs.find((l) => l.includes("Error Message:"))?.split("Error Message:")[1]?.trim() ?? err.message ?? "transaction failed";
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}

function bad(error: string) {
  return NextResponse.json({ ok: false, error }, { status: 400 });
}
