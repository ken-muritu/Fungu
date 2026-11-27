// Demo faucet: gives a new wallet 100 fUSD (devnet test dollars) once,
// behind Cloudflare Turnstile so bots can't drain it.
import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getAccount, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { MINT, UNIT } from "@/lib/config";
import { connection, isPubkey, sponsorKey, verifyTurnstile } from "@/lib/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { owner, token } = (await req.json().catch(() => ({}))) as { owner?: string; token?: string };
  if (!isPubkey(owner)) return NextResponse.json({ ok: false, error: "bad wallet address" }, { status: 400 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  if (!(await verifyTurnstile(token, ip))) return NextResponse.json({ ok: false, error: "human check failed, try again" }, { status: 403 });
  const conn = connection();
  const sponsor = sponsorKey();
  const ownerKey = new PublicKey(owner);
  try {
    const ata = await getOrCreateAssociatedTokenAccount(conn, sponsor, MINT, ownerKey);
    const acct = await getAccount(conn, ata.address);
    if (acct.amount >= BigInt(50 * UNIT)) return NextResponse.json({ ok: true, skipped: true, ata: ata.address.toBase58() });
    const sig = await mintTo(conn, sponsor, MINT, ata.address, sponsor, 100 * UNIT);
    return NextResponse.json({ ok: true, signature: sig, ata: ata.address.toBase58() });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
