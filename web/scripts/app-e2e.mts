// End-to-end test of the web app's own client library (lib/fungu.ts) against a live deployment:
// every debt and chama action goes through the deployment's /api/sponsor and /api/rpc, exactly as in the browser.
// Test wallets are funded by minting demo fUSD with the sponsor key (the faucet needs a human check).
// Usage (from web/): BASE_URL=https://fungu.daelus.co.ke npx tsx scripts/app-e2e.mts
import fs from "node:fs";
import os from "node:os";
const BASE = process.env.BASE_URL || "https://fungu.daelus.co.ke";
const mem = new Map<string, string>();
Object.assign(globalThis, {
  window: { location: { origin: BASE } },
  localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v) },
});
const realFetch = globalThis.fetch;
globalThis.fetch = ((u: any, o?: any) => realFetch(typeof u === "string" && u.startsWith("/") ? BASE + u : u, o)) as typeof fetch;

const { Connection, Keypair } = await import("@solana/web3.js");
const spl = await import("@solana/spl-token");
const f = await import("../lib/fungu");
const { MINT, UNIT } = await import("../lib/config");

let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) fails++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const expectErr = async (p: Promise<unknown>, re: RegExp, what: string) => { try { await p; check(false, `${what} (should have failed)`); } catch (e) { check(re.test((e as Error).message), `${what} → ${(e as Error).message.slice(0, 70)}`); } };

const direct = new Connection("https://api.devnet.solana.com", "confirmed"); // setup only: the app proxy is read-only
const sponsor = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.SPONSOR_KEYPAIR || `${os.homedir()}/.config/solana/fungu-devnet.json`, "utf8"))));
const [A, B, G, C] = [0, 1, 2, 3].map(() => Keypair.generate());
for (const [k, n] of [[A, "Amina"], [B, "Brian"], [G, "Grace"], [C, "Chris"]] as const) {
  const ata = await spl.getOrCreateAssociatedTokenAccount(direct, sponsor, MINT, k.publicKey);
  await spl.mintTo(direct, sponsor, MINT, ata.address, sponsor, 100 * UNIT);
  f.names.set(k.publicKey.toBase58(), n);
}
check((await f.balance(A.publicKey)) === 100, "test wallets funded with 100 fUSD");
for (const k of [A, B, G, C]) await f.actions.initProfile(k);
check(!!(await f.fetchProfile(B.publicKey)), "profiles created (sponsored)");

// ---- debt 1: guarantor, fund, part repay on-chain, rest confirmed off-chain
const terms = "Fungu agreement\nAmount: 30 fUSD\nPurpose: rent";
const due = Math.floor(Date.now() / 1000) + 7 * 86400;
const { agreement: a1 } = await f.actions.createAgreement(A, B.publicKey, 30, due, terms, G.publicKey);
let x = await f.fetchAgreement(a1);
check(x?.status === "proposed" && x.guarantor?.equals(G.publicKey), "create agreement with guarantor");
await expectErr(f.actions.accept(B, a1, terms + " (edited)"), /terms|Mismatch/i, "accept with altered terms refused");
await f.actions.cosign(G, a1, terms);
await f.actions.accept(B, a1, terms);
x = await f.fetchAgreement(a1);
check(x?.status === "active" && x.guarantorSigned, "guarantor cosign + borrower accept");
await f.actions.fund(A, x!);
check((await f.balance(B.publicKey)) === 130, "lender funds wallet to wallet (B = 130)");
await expectErr(f.actions.repay(B, x!, 31), /Overpay|more than what is left/i, "overpayment refused");
await f.actions.repay(B, x!, 10.5);
await expectErr(f.actions.confirmOffchain(B, x!, 5, "X"), /has.?one|Constraint|lender/i, "borrower can't confirm own off-chain payment");
await f.actions.confirmOffchain(A, x!, 19.5, "skl3xy");
x = await f.fetchAgreement(a1);
check(x?.status === "settled" && x.repaid.toNumber() === 30 * UNIT, "part repay + off-chain confirm → settled");
check((await f.fetchProfile(B.publicKey)).settled === 1, "borrower record: 1 settled");
const listA = await f.fetchAgreements(A.publicKey), listG = await f.fetchAgreements(G.publicKey);
check(listA.some((d) => d.address.equals(a1)) && listG.some((d) => d.address.equals(a1)), "agreement listed for lender and guarantor");

// ---- debt 2: cancel
const { agreement: a2 } = await f.actions.createAgreement(A, C.publicKey, 5, due, "t2", null);
await f.actions.cancel(A, a2);
check((await f.fetchAgreement(a2))?.status === "cancelled", "lender cancels a proposal");

// ---- debt 3: past due + forgive (due in 25 s)
const { agreement: a3 } = await f.actions.createAgreement(A, C.publicKey, 8, Math.floor(Date.now() / 1000) + 25, "t3", null);
await f.actions.accept(C, a3, "t3");
await expectErr(f.actions.markOverdue(B, a3), /NotYetDue|not due yet/i, "overdue before due date refused");
await sleep(30000);
await f.actions.markOverdue(B, a3); // permissionless
check((await f.fetchAgreement(a3))?.overdue === true, "anyone marks past due after the date");
await f.actions.forgive(A, a3);
check((await f.fetchAgreement(a3))?.status === "forgiven", "lender forgives the rest");

// ---- chama: 3 members, 60 s rounds, one missed round covered by the bond
const { chama } = await f.actions.createChama(A, "E2E Chama", 10, 60, 3, 10);
for (const k of [A, B, C]) await f.actions.memberIx("joinChama", k, chama);
let c = await f.fetchChama(chama);
check(c?.status === "active" && c.members.length === 3, "create + 3 joins → active");
check((await f.fetchChamas(B.publicKey)).some((y: any) => y.address.equals(chama)), "chama listed for a member");
const pay = async (ks: any[]) => { for (const k of ks) await f.actions.memberIx("contribute", k, chama); };
await pay([A, B, C]);
await f.actions.payout(C, chama, c!.members[0]); // anyone may trigger
c = await f.fetchChama(chama);
check(c!.round === 1, "round 1 paid out to member 1");
await pay([B, C]); // A (already paid out) skips round 2
await expectErr(f.actions.payout(B, chama, c!.members[1]), /RoundNotOver|not over|round/i, "payout before time with a missing payment refused");
await sleep(62000);
await f.actions.payout(B, chama, c!.members[1]);
c = await f.fetchChama(chama);
check(c!.round === 2 && c!.defaults[0] === 1, "missed round covered from A's bond (A defaults = 1)");
await pay([A, B, C]);
await f.actions.payout(A, chama, c!.members[2]);
c = await f.fetchChama(chama);
check(c!.status === "completed", "3 rounds → completed");
for (const k of [A, B, C]) await f.actions.withdrawBond(k, chama);
const [ba, bb, bc] = await Promise.all([A, B, C].map((k) => f.balance(k.publicKey)));
console.log(`balances A=${ba} B=${bb} C=${bc}`);
// A: 100-30 lent+10.5 repaid; chama: paid 2 rounds, got the 30 pot, bond used for the missed round → 80.5
// B: 100+30-10.5 = 119.5, chama nets 0 (bond back); C: chama nets 0 → 100; G untouched → 100
check(ba === 80.5 && bb === 119.5 && bc === 100 && (await f.balance(G.publicKey)) === 100, "final balances exact (80.5 / 119.5 / 100 / 100)");
check((await f.fetchProfile(A.publicKey)).chamaMissed === 1 && (await f.fetchProfile(B.publicKey)).chamaCycles === 1, "records: A missed 1, B 1 cycle");

// ---- chama 2: leave while forming
const { chama: ch2 } = await f.actions.createChama(B, "Leave test", 5, 60, 3, 5);
await f.actions.memberIx("joinChama", B, ch2);
const before = await f.balance(B.publicKey);
await f.actions.memberIx("leaveChama", B, ch2);
check((await f.balance(B.publicKey)) === before + 5, "leave while forming refunds the bond");

console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
