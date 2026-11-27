import "server-only";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { RPC_URL } from "./config";

let sponsor: Keypair | null = null;
export function sponsorKey(): Keypair {
  if (!sponsor) {
    const raw = process.env.SPONSOR_SECRET;
    if (!raw) throw new Error("SPONSOR_SECRET is not set");
    sponsor = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  }
  return sponsor;
}

export const connection = () => new Connection(process.env.RPC_URL || RPC_URL, "confirmed");

export async function verifyTurnstile(token: string | undefined, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !token) return false;
  const body = new URLSearchParams({ secret, response: token });
  if (ip) body.set("remoteip", ip);
  const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
  const j = (await r.json()) as { success?: boolean };
  return j.success === true;
}

export function isPubkey(s: unknown): s is string {
  try { return typeof s === "string" && !!new PublicKey(s); } catch { return false; }
}
