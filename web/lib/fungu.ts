"use client";
import { Buffer } from "buffer";
if (typeof window !== "undefined") (window as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer;

import { AnchorProvider, BN, Program, type Idl } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import idl from "./idl.json";
import { MINT, PROGRAM_ID, RPC_URL, SPONSOR, UNIT } from "./config";

// Reads go through our own /api/rpc (retries the rate-limited public endpoint); a custom
// NEXT_PUBLIC_RPC_URL (e.g. a keyed provider) is used directly instead.
const rpc = typeof window !== "undefined" && !process.env.NEXT_PUBLIC_RPC_URL ? `${window.location.origin}/api/rpc` : RPC_URL;
export const conn = new Connection(rpc, { commitment: "confirmed", disableRetryOnRateLimit: true });

// ---------------------------------------------------------------- wallet
// The key is generated and kept on this device only. Fungu's servers never see it.
const WKEY = "fungu.wallet.v1";
export function loadWallet(): Keypair | null {
  const raw = localStorage.getItem(WKEY);
  return raw ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw))) : null;
}
export function createWallet(): Keypair {
  const k = Keypair.generate();
  localStorage.setItem(WKEY, JSON.stringify(Array.from(k.secretKey)));
  return k;
}
export function importWallet(json: string): Keypair {
  const k = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(json)));
  localStorage.setItem(WKEY, JSON.stringify(Array.from(k.secretKey)));
  return k;
}
export const exportWallet = (k: Keypair) => JSON.stringify(Array.from(k.secretKey));

// small local stores: contact names and agreement terms seen on this device
const store = <T,>(key: string) => ({
  get: (): Record<string, T> => JSON.parse(localStorage.getItem(key) || "{}"),
  set(id: string, v: T) { const all = this.get(); all[id] = v; localStorage.setItem(key, JSON.stringify(all)); },
});
export const names = store<string>("fungu.names");
export const termsStore = store<string>("fungu.terms");

// ---------------------------------------------------------------- program
const readOnly = { publicKey: SPONSOR, signTransaction: async <T,>(t: T) => t, signAllTransactions: async <T,>(t: T) => t };
export const program = new Program(idl as Idl, new AnchorProvider(conn, readOnly as never, { commitment: "confirmed" }));
const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const le = (n: number | BN) => new BN(n).toArrayLike(Buffer, "le", 8);
export const profilePda = (k: PublicKey) => pda(Buffer.from("profile"), k.toBuffer());
export const agreementPda = (lender: PublicKey, borrower: PublicKey, id: number) => pda(Buffer.from("agreement"), lender.toBuffer(), borrower.toBuffer(), le(id));
export const chamaPda = (creator: PublicKey, id: number) => pda(Buffer.from("chama"), creator.toBuffer(), le(id));
export const ata = (owner: PublicKey) => getAssociatedTokenAddressSync(MINT, owner, true);
const ensureAta = (owner: PublicKey) => createAssociatedTokenAccountIdempotentInstruction(SPONSOR, ata(owner), owner, MINT);

export async function sha256(text: string): Promise<number[]> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))));
}

/** Sign on this device, then send to the sponsor, which adds the fee-payer signature and submits. */
export async function send(ixs: TransactionInstruction[], signer: Keypair): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = SPONSOR;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.partialSign(signer);
  const r = await fetch("/api/sponsor", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx: tx.serialize({ requireAllSignatures: false }).toString("base64") }) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || "transaction failed");
  return j.signature as string;
}

const m = program.methods as Record<string, (...a: unknown[]) => { accountsPartial: (a: object) => { instruction: () => Promise<TransactionInstruction> } }>;
const ix = (name: string, args: unknown[], accounts: object) => m[name](...args).accountsPartial(accounts).instruction();

// ---------------------------------------------------------------- reads
export type Agreement = Awaited<ReturnType<typeof fetchAgreements>>[number];
export async function fetchAgreements(me: PublicKey) {
  const acc = program.account as Record<string, { all: (f?: object[]) => Promise<{ publicKey: PublicKey; account: any }[]>; fetchNullable: (k: PublicKey) => Promise<any> }>;
  const [a, b, g] = await Promise.all([
    acc.agreement.all([{ memcmp: { offset: 16, bytes: me.toBase58() } }]),
    acc.agreement.all([{ memcmp: { offset: 48, bytes: me.toBase58() } }]),
    // guarantor: Option<Pubkey> = tag byte at 80, key at 81 when present
    acc.agreement.all([{ memcmp: { offset: 81, bytes: me.toBase58() } }]).catch(() => []),
  ]);
  const seen = new Set<string>();
  return [...a, ...b, ...g.filter((x) => x.account.guarantor?.equals?.(me))]
    .filter((x) => (seen.has(x.publicKey.toBase58()) ? false : (seen.add(x.publicKey.toBase58()), true)))
    .map((x) => ({ address: x.publicKey, ...x.account, status: Object.keys(x.account.status)[0] as string }))
    .sort((p, q) => q.createdAt.toNumber() - p.createdAt.toNumber());
}
export async function fetchAgreement(address: PublicKey) {
  const a = await (program.account as any).agreement.fetchNullable(address);
  return a ? { address, ...a, status: Object.keys(a.status)[0] as string } : null;
}
export async function fetchChamas(me: PublicKey) {
  const all = await (program.account as any).chama.all();
  return all
    .map((x: any) => ({ address: x.publicKey as PublicKey, ...x.account, status: Object.keys(x.account.status)[0] as string }))
    .filter((c: any) => c.creator.equals(me) || c.members.some((k: PublicKey) => k.equals(me)));
}
export async function fetchChama(address: PublicKey) {
  const c = await (program.account as any).chama.fetchNullable(address);
  return c ? { address, ...c, status: Object.keys(c.status)[0] as string } : null;
}
export async function fetchProfile(k: PublicKey) {
  return (program.account as any).profile.fetchNullable(profilePda(k));
}
export async function balance(owner: PublicKey): Promise<number> {
  try { return Number((await conn.getTokenAccountBalance(ata(owner))).value.amount) / UNIT; } catch { return 0; }
}

// ---------------------------------------------------------------- actions
export const actions = {
  initProfile: (me: Keypair) => ix("initProfile", [], { payer: SPONSOR, user: me.publicKey }).then((i) => send([i], me)),

  async createAgreement(me: Keypair, borrower: PublicKey, amount: number, dueTs: number, terms: string, guarantor: PublicKey | null) {
    const id = Date.now();
    const agreement = agreementPda(me.publicKey, borrower, id);
    const i = await ix("createAgreement", [new BN(id), new BN(Math.round(amount * UNIT)), new BN(dueTs), await sha256(terms), guarantor], { payer: SPONSOR, lender: me.publicKey, borrower, mint: MINT, agreement });
    const sig = await send([i], me);
    termsStore.set(agreement.toBase58(), terms);
    return { sig, agreement };
  },
  accept: async (me: Keypair, agreement: PublicKey, terms: string) => send([await ix("acceptAgreement", [await sha256(terms)], { borrower: me.publicKey, agreement })], me),
  cosign: async (me: Keypair, agreement: PublicKey, terms: string) => send([await ix("guarantorCosign", [await sha256(terms)], { guarantor: me.publicKey, agreement })], me),
  cancel: async (me: Keypair, agreement: PublicKey) => send([await ix("cancelAgreement", [], { lender: me.publicKey, agreement })], me),
  forgive: async (me: Keypair, agreement: PublicKey) => send([await ix("forgive", [], { lender: me.publicKey, agreement })], me),
  markOverdue: async (me: Keypair, agreement: PublicKey) => send([await ix("markOverdue", [], { agreement })], me),
  fund: async (me: Keypair, a: { address: PublicKey; borrower: PublicKey }) =>
    send([ensureAta(a.borrower), await ix("fundAgreement", [], { lender: me.publicKey, agreement: a.address, mint: MINT, lenderAta: ata(me.publicKey), borrowerAta: ata(a.borrower), tokenProgram: TOKEN_PROGRAM_ID })], me),
  repay: async (me: Keypair, a: { address: PublicKey; lender: PublicKey }, amount: number) =>
    send([ensureAta(a.lender), await ix("repay", [new BN(Math.round(amount * UNIT))], { borrower: me.publicKey, agreement: a.address, borrowerProfile: profilePda(me.publicKey), mint: MINT, borrowerAta: ata(me.publicKey), lenderAta: ata(a.lender), tokenProgram: TOKEN_PROGRAM_ID })], me),
  confirmOffchain: async (me: Keypair, a: { address: PublicKey; borrower: PublicKey }, amount: number, receipt: string) =>
    send([await ix("confirmOffchainRepayment", [new BN(Math.round(amount * UNIT)), await sha256(receipt.trim().toUpperCase())], { lender: me.publicKey, agreement: a.address, borrowerProfile: profilePda(a.borrower) })], me),

  async createChama(me: Keypair, name: string, contribution: number, periodSecs: number, maxMembers: number, bond: number) {
    const id = Date.now();
    const chama = chamaPda(me.publicKey, id);
    const i = await ix("createChama", [new BN(id), name, new BN(Math.round(contribution * UNIT)), new BN(periodSecs), maxMembers, new BN(Math.round(bond * UNIT))], { payer: SPONSOR, creator: me.publicKey, mint: MINT, chama, vault: ata(chama), tokenProgram: TOKEN_PROGRAM_ID });
    return { sig: await send([i], me), chama };
  },
  memberIx: async (name: string, me: Keypair, chama: PublicKey) => send([await ix(name, [], { member: me.publicKey, chama, mint: MINT, vault: ata(chama), memberAta: ata(me.publicKey), tokenProgram: TOKEN_PROGRAM_ID })], me),
  payout: async (me: Keypair, chama: PublicKey, recipient: PublicKey) =>
    send([ensureAta(recipient), await ix("payout", [], { chama, mint: MINT, vault: ata(chama), recipientAta: ata(recipient), tokenProgram: TOKEN_PROGRAM_ID })], me),
  withdrawBond: async (me: Keypair, chama: PublicKey) =>
    send([await ix("withdrawBond", [], { member: me.publicKey, chama, profile: profilePda(me.publicKey), mint: MINT, vault: ata(chama), memberAta: ata(me.publicKey), tokenProgram: TOKEN_PROGRAM_ID })], me),
};

export const fmt = (raw: BN | number) => (typeof raw === "number" ? raw : raw.toNumber() / UNIT).toLocaleString("en-KE", { maximumFractionDigits: 2 });
export const short = (k: PublicKey | string) => { const s = typeof k === "string" ? k : k.toBase58(); return `${s.slice(0, 4)}…${s.slice(-4)}`; };
export const nameOf = (k: PublicKey, me?: PublicKey) => (me && k.equals(me) ? "You" : names.get()[k.toBase58()] || short(k));
