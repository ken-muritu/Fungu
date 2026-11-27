import { PublicKey } from "@solana/web3.js";
export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL || "https://api.devnet.solana.com";
export const PROGRAM_ID = new PublicKey("6NtCwcAU57GGeLCKQcJCgnk9Nzu9892jdQFDUaM2T4bE");
export const MINT = new PublicKey(process.env.NEXT_PUBLIC_MINT || "CuE2gU322FNfnnsfvaH91Amossu8kyvVg4fXt2U3KseZ");
export const SPONSOR = new PublicKey(process.env.NEXT_PUBLIC_SPONSOR || "G2AumARqudFsRNCeujLzyCyPbwbdkKTpChq5EazsfyTo");
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "0x4AAAAAAGVzGECi_psMpsx7";
export const DECIMALS = 6;
export const UNIT = 10 ** DECIMALS;
export const explorer = (kind: "tx" | "address", v: string) => `https://explorer.solana.com/${kind}/${v}?cluster=devnet`;
