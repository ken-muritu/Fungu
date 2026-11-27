import { NextRequest, NextResponse } from "next/server";
import { RPC_URL } from "@/lib/config";

// Read-only Solana RPC proxy: the public devnet endpoint rate-limits browsers (429 without
// CORS headers shows up as "Failed to fetch"). Only read methods pass; sending goes via /api/sponsor.
const ALLOWED = new Set([
  "getLatestBlockhash", "getAccountInfo", "getMultipleAccounts", "getProgramAccounts", "getTokenAccountBalance",
  "getBalance", "getSignatureStatuses", "getMinimumBalanceForRentExemption", "getSlot", "getBlockHeight",
  "getEpochInfo", "getVersion", "getGenesisHash", "isBlockhashValid", "getFeeForMessage",
]);
const upstream = process.env.RPC_URL || RPC_URL;

export async function POST(req: NextRequest) {
  const body = await req.text();
  if (body.length > 20_000) return NextResponse.json({ error: "too large" }, { status: 413 });
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return NextResponse.json({ error: "bad json" }, { status: 400 }); }
  const calls = Array.isArray(parsed) ? parsed : [parsed];
  if (calls.length > 10 || !calls.every((c) => c && typeof c === "object" && ALLOWED.has((c as { method?: string }).method ?? "")))
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32601, message: "method not allowed" } }, { status: 403 });
  for (let i = 0, wait = 300; i < 5; i++, wait *= 2) {
    const r = await fetch(upstream, { method: "POST", headers: { "content-type": "application/json" }, body });
    if (r.status !== 429 && r.status < 500) return new NextResponse(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
    await new Promise((s) => setTimeout(s, wait));
  }
  return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32005, message: "Solana is busy, try again in a moment" } }, { status: 503 });
}
