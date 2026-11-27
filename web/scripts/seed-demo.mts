// Seeds real devnet state for product screenshots and the demo video: four people with @names, a guarded loan
// two-thirds repaid, a settled loan, a pending proposal and a chama in its second round.
// Writes the demo wallets (devnet test keys only) to the path given as argv[2], outside the repo.
// Usage (from web/): node --import tsx scripts/seed-demo.mts <out.json>
import fs from "node:fs";
import os from "node:os";
const BASE = process.env.BASE_URL || "https://fungu.daelus.co.ke";
const mem = new Map<string, string>();
Object.assign(globalThis, { window: { location: { origin: BASE } }, localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => mem.set(k, v) } });
const realFetch = globalThis.fetch;
globalThis.fetch = ((u: any, o?: any) => realFetch(typeof u === "string" && u.startsWith("/") ? BASE + u : u, o)) as typeof fetch;
const { Connection, Keypair } = await import("@solana/web3.js");
const spl = await import("@solana/spl-token");
const f = await import("../lib/fungu");
const { MINT, UNIT } = await import("../lib/config");

const out = process.argv[2];
if (!out) throw new Error("output path required");
const direct = new Connection("https://api.devnet.solana.com", "confirmed");
const sponsor = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(`${os.homedir()}/.config/solana/fungu-devnet.json`, "utf8"))));
const tag = Date.now().toString(36).slice(-3);
const people = { wanjiru: Keypair.generate(), otieno: Keypair.generate(), akinyi: Keypair.generate(), baraka: Keypair.generate() };
const handle: Record<string, string> = {};
for (const [n, k] of Object.entries(people)) {
  const ata = await spl.getOrCreateAssociatedTokenAccount(direct, sponsor, MINT, k.publicKey);
  await spl.mintTo(direct, sponsor, MINT, ata.address, sponsor, 200 * UNIT);
  await f.actions.initProfile(k);
  const h = (await f.ownerOfName(n)) ? `${n}_${tag}` : n;
  await f.actions.registerName(k, h);
  handle[n] = h;
  console.log("ready", n, "@" + h);
}
const { wanjiru: W, otieno: O, akinyi: A, baraka: B } = people;
const day = 86400, now = Math.floor(Date.now() / 1000);
const terms: Record<string, string> = {};
const T = (lender: string, borrower: string, amt: number, purpose: string, due: number, g?: string) =>
  `Fungu agreement\nLender: @${handle[lender]}\nBorrower: @${handle[borrower]}\nAmount: ${amt} fUSD\nPurpose: ${purpose}\nDue: ${new Date(due * 1000).toDateString()}${g ? `\nGuarantor: @${handle[g]}` : ""}`;

// 1 — W lends O 45 for rent, Akinyi guarantees, 30 repaid in two portions
const d1due = now + 14 * day, t1 = T("wanjiru", "otieno", 45, "Rent top-up for December", d1due, "akinyi");
const { agreement: a1 } = await f.actions.createAgreement(W, O.publicKey, 45, d1due, t1, A.publicKey);
await f.actions.cosign(A, a1, t1); await f.actions.accept(O, a1, t1);
await f.actions.fund(W, (await f.fetchAgreement(a1))!);
await f.actions.repay(O, (await f.fetchAgreement(a1))!, 15);
await f.actions.repay(O, (await f.fetchAgreement(a1))!, 15);
terms[a1.toBase58()] = t1; console.log("debt 1 active 30/45");

// 2 — B lent W 20 for bus fare; W repaid in full → settled
const d2due = now + 7 * day, t2 = T("baraka", "wanjiru", 20, "Bus fare to Nakuru", d2due);
const { agreement: a2 } = await f.actions.createAgreement(B, W.publicKey, 20, d2due, t2, null);
await f.actions.accept(W, a2, t2); await f.actions.fund(B, (await f.fetchAgreement(a2))!);
await f.actions.repay(W, (await f.fetchAgreement(a2))!, 20);
terms[a2.toBase58()] = t2; console.log("debt 2 settled");

// 3 — W proposes 12 to Baraka, waiting for him
const d3due = now + 10 * day, t3 = T("wanjiru", "baraka", 12, "Phone screen repair", d3due);
const { agreement: a3 } = await f.actions.createAgreement(W, B.publicKey, 12, d3due, t3, null);
terms[a3.toBase58()] = t3; console.log("debt 3 proposed");

// chama — 3 members, 10 a week, bond 5; round 1 paid out to W, round 2 has 2 of 3 in
const { chama } = await f.actions.createChama(W, "Wamama wa Kahawa", 10, 7 * day, 3, 5);
for (const k of [W, O, A]) await f.actions.memberIx("joinChama", k, chama);
for (const k of [W, O, A]) await f.actions.memberIx("contribute", k, chama);
const c = await f.fetchChama(chama);
await f.actions.payout(A, chama, c!.members[0]);
for (const k of [O, W]) await f.actions.memberIx("contribute", k, chama);
console.log("chama round 2: 2 of 3 paid");

const names: Record<string, string> = {};
for (const [n, k] of Object.entries(people)) names[k.publicKey.toBase58()] = "@" + handle[n];
fs.writeFileSync(out, JSON.stringify({ wallets: Object.fromEntries(Object.entries(people).map(([n, k]) => [n, Array.from(k.secretKey)])), handle, names, terms, a1: a1.toBase58(), chama: chama.toBase58() }));
console.log("written", out);
