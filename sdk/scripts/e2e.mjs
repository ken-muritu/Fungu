// End-to-end test of the deployed Fungu program on Solana devnet.
// One debt (with guarantor, on-chain + off-chain repayment) and one full
// 3-member chama in which a member misses a round and is covered by their bond.
// The sponsor wallet pays every fee and rent; Alice, Bob and Carol hold no SOL.
//
// Usage: SPONSOR_KEYPAIR=path/to/keypair.json node scripts/e2e.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { AnchorProvider, Program, Wallet, BN } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";

const idl = JSON.parse(fs.readFileSync(new URL("../idl/fungu.json", import.meta.url)));
const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const keyPath = process.env.SPONSOR_KEYPAIR || path.join(os.homedir(), ".config/solana/fungu-devnet.json");
const sponsor = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath))));
const conn = new Connection(RPC, "confirmed");
const provider = new AnchorProvider(conn, new Wallet(sponsor), { commitment: "confirmed" });
const program = new Program(idl, provider);
const X = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const U = 1_000_000; // 6 decimals, like USDC
const log = [];
let failures = 0;
const check = (ok, what) => { console.log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) failures++; };
const step = async (name, p) => { const sig = await p; log.push({ name, sig }); console.log(`  ✓ ${name}  ${X(sig)}`); return sig; };
const expectFail = async (name, p, code) => {
  try { await p; check(false, `${name} should have failed`); }
  catch (e) { check(String(e).includes(code), `${name} rejected (${code})`); }
};
const pda = (...seeds) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
const le = (n) => new BN(n).toArrayLike(Buffer, "le", 8);
const profileOf = (k) => pda(Buffer.from("profile"), k.toBuffer());
const bal = async (ata) => Number((await getAccount(conn, ata)).amount) / U;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

console.log(`program ${program.programId.toBase58()}  sponsor ${sponsor.publicKey.toBase58()}`);
const [alice, bob, carol] = [Keypair.generate(), Keypair.generate(), Keypair.generate()];

// test stablecoin (devnet USDC can't be minted freely, so the test uses its own 6-decimal mint)
const mint = await createMint(conn, sponsor, sponsor.publicKey, null, 6);
const ata = {};
for (const [n, k] of Object.entries({ alice, bob, carol })) {
  ata[n] = (await getOrCreateAssociatedTokenAccount(conn, sponsor, mint, k.publicKey)).address;
  await mintTo(conn, sponsor, mint, ata[n], sponsor, 100 * U);
}
console.log(`test mint ${mint.toBase58()}; Alice, Bob, Carol each get 100 tUSD`);

for (const [n, k] of Object.entries({ alice, bob, carol }))
  await step(`profile ${n}`, program.methods.initProfile().accountsPartial({ payer: sponsor.publicKey, user: k.publicKey }).signers([k]).rpc());

// ---------------------------------------------------------------- debt
console.log("\nDEBT: Alice lends Bob 50, Carol guarantees");
const terms = "Alice lends Bob 50 tUSD for rent, due in 7 days, pay in parts";
const hash = Array.from(crypto.createHash("sha256").update(terms).digest());
const id = Date.now();
const agreement = pda(Buffer.from("agreement"), alice.publicKey.toBuffer(), bob.publicKey.toBuffer(), le(id));
const due = Math.floor(Date.now() / 1000) + 7 * 86400;
await step("create", program.methods.createAgreement(new BN(id), new BN(50 * U), new BN(due), hash, carol.publicKey)
  .accountsPartial({ payer: sponsor.publicKey, lender: alice.publicKey, borrower: bob.publicKey, mint, agreement }).signers([alice]).rpc());
const wrong = Array.from(crypto.createHash("sha256").update("different terms").digest());
await expectFail("accept with different terms", program.methods.acceptAgreement(wrong).accountsPartial({ borrower: bob.publicKey, agreement }).signers([bob]).rpc(), "TermsMismatch");
await step("Bob accepts", program.methods.acceptAgreement(hash).accountsPartial({ borrower: bob.publicKey, agreement }).signers([bob]).rpc());
await step("Carol co-signs", program.methods.guarantorCosign(hash).accountsPartial({ guarantor: carol.publicKey, agreement }).signers([carol]).rpc());
await step("Alice funds 50", program.methods.fundAgreement().accountsPartial({ lender: alice.publicKey, agreement, mint, lenderAta: ata.alice, borrowerAta: ata.bob, tokenProgram: TOKEN_PROGRAM_ID }).signers([alice]).rpc());
check((await bal(ata.bob)) === 150, "Bob received 50 wallet-to-wallet");
await step("Bob repays 20", program.methods.repay(new BN(20 * U)).accountsPartial({ borrower: bob.publicKey, agreement, borrowerProfile: profileOf(bob.publicKey), mint, borrowerAta: ata.bob, lenderAta: ata.alice, tokenProgram: TOKEN_PROGRAM_ID }).signers([bob]).rpc());
await expectFail("overpay 31 of 30 left", program.methods.repay(new BN(31 * U)).accountsPartial({ borrower: bob.publicKey, agreement, borrowerProfile: profileOf(bob.publicKey), mint, borrowerAta: ata.bob, lenderAta: ata.alice, tokenProgram: TOKEN_PROGRAM_ID }).signers([bob]).rpc(), "Overpayment");
const receipt = Array.from(crypto.createHash("sha256").update("MPESA-TEST-RECEIPT-001").digest());
await expectFail("borrower claims off-chain repayment", program.methods.confirmOffchainRepayment(new BN(30 * U), receipt).accountsPartial({ lender: bob.publicKey, agreement, borrowerProfile: profileOf(bob.publicKey) }).signers([bob]).rpc(), "ConstraintHasOne");
await step("Alice confirms 30 received by mobile money", program.methods.confirmOffchainRepayment(new BN(30 * U), receipt).accountsPartial({ lender: alice.publicKey, agreement, borrowerProfile: profileOf(bob.publicKey) }).signers([alice]).rpc());
const a = await program.account.agreement.fetch(agreement);
check(Object.keys(a.status)[0] === "settled" && a.repaid.toNumber() === 50 * U, "agreement settled, 50 repaid");
check(a.guarantorSigned === true, "guarantor signature recorded");
const pb = await program.account.profile.fetch(profileOf(bob.publicKey));
check(pb.settled === 1 && pb.onTime === 1, "Bob's profile: 1 settled, on time");

// ---------------------------------------------------------------- chama
console.log("\nCHAMA: 3 members, 10 per round, bond 10, 60 s rounds");
const cid = Date.now();
const chama = pda(Buffer.from("chama"), alice.publicKey.toBuffer(), le(cid));
const vault = (await import("@solana/spl-token")).getAssociatedTokenAddressSync(mint, chama, true);
await step("create chama", program.methods.createChama(new BN(cid), "Wamama Test", new BN(10 * U), new BN(60), 3, new BN(10 * U))
  .accountsPartial({ payer: sponsor.publicKey, creator: alice.publicKey, mint, chama, vault, tokenProgram: TOKEN_PROGRAM_ID }).signers([alice]).rpc());
const mm = (k, n) => ({ member: k.publicKey, chama, mint, vault, memberAta: ata[n], tokenProgram: TOKEN_PROGRAM_ID });
for (const [n, k] of Object.entries({ alice, bob, carol }))
  await step(`${n} joins (bond 10)`, program.methods.joinChama().accountsPartial(mm(k, n)).signers([k]).rpc());
let c = await program.account.chama.fetch(chama);
check(Object.keys(c.status)[0] === "active" && c.members.length === 3, "chama full and active");
const payout = (n) => program.methods.payout().accountsPartial({ chama, mint, vault, recipientAta: ata[n], tokenProgram: TOKEN_PROGRAM_ID }).rpc();

// round 1: everyone pays, Alice receives 30
for (const [n, k] of Object.entries({ alice, bob, carol }))
  await step(`R1 ${n} contributes`, program.methods.contribute().accountsPartial(mm(k, n)).signers([k]).rpc());
await expectFail("payout to the wrong member", payout("bob"), "WrongOwner");
await step("R1 payout -> Alice", payout("alice"));
// round 2: Carol misses; payout only after time is up, covered by her bond
for (const [n, k] of Object.entries({ alice, bob }))
  await step(`R2 ${n} contributes`, program.methods.contribute().accountsPartial(mm(k, n)).signers([k]).rpc());
await expectFail("early payout while Carol hasn't paid", payout("bob"), "RoundNotOver");
console.log("  … waiting 62 s for the round to end");
await sleep(62_000);
await step("R2 payout -> Bob (Carol's share from her bond)", payout("bob"));
// round 3: everyone pays, Carol receives
for (const [n, k] of Object.entries({ alice, bob, carol }))
  await step(`R3 ${n} contributes`, program.methods.contribute().accountsPartial(mm(k, n)).signers([k]).rpc());
await step("R3 payout -> Carol", payout("carol"));
c = await program.account.chama.fetch(chama);
check(Object.keys(c.status)[0] === "completed", "chama completed after 3 rounds");
for (const [n, k] of Object.entries({ alice, bob, carol }))
  await step(`${n} withdraws bond`, program.methods.withdrawBond().accountsPartial({ member: k.publicKey, chama, profile: profileOf(k.publicKey), mint, vault, memberAta: ata[n], tokenProgram: TOKEN_PROGRAM_ID }).signers([k]).rpc());
check((await bal(vault)) === 0, "vault empty at the end");
const final = { alice: await bal(ata.alice), bob: await bal(ata.bob), carol: await bal(ata.carol) };
console.log("final balances", final);
// Alice 100-50+20, chama nets 0 -> 70. Bob 100+50-20, chama nets 0 -> 130.
// Carol: bond 10 (used to cover R2), paid R1+R3 = 20, received 30 -> 100.
check(final.alice === 70 && final.bob === 130 && final.carol === 100, "balances add up: Alice 70, Bob 130, Carol 100");
const pc = await program.account.profile.fetch(profileOf(carol.publicKey));
check(pc.chamaCycles === 1 && pc.chamaMissed === 1, "Carol's profile: 1 cycle, 1 missed round");
const pa = await program.account.profile.fetch(profileOf(alice.publicKey));
check(pa.chamaCycles === 1 && pa.chamaMissed === 0, "Alice's profile: 1 cycle, 0 missed");

// ---- books: KES records, salted hash chain, 2-of-3 official approval, no tokens
const sha = (...parts) => { const h = crypto.createHash("sha256"); for (const p of parts) h.update(Buffer.from(p)); return Array.from(h.digest()); };
const rules = "Wanjiku Women Group: KES 500 every Friday; payout order Alice, Bob, Carol; fine KES 50 late";
const bid = Date.now();
const book = pda(Buffer.from("book"), alice.publicKey.toBuffer(), le(bid));
const officials = [alice.publicKey, bob.publicKey, carol.publicKey];
await expectFail("book with threshold 4 of 3", program.methods.createBook(new BN(bid), officials, 4, sha(rules), [...Buffer.from("KES")])
  .accountsPartial({ payer: sponsor.publicKey, creator: alice.publicKey, book }).signers([alice]).rpc(), "BadThreshold");
await step("create book (2 of 3 officials)", program.methods.createBook(new BN(bid), officials, 2, sha(rules), [...Buffer.from("KES")])
  .accountsPartial({ payer: sponsor.publicKey, creator: alice.publicKey, book }).signers([alice]).rpc());
const prop = (seq) => pda(Buffer.from("proposal"), book.toBuffer(), le(seq));
const rec = (o) => sha("salt-" + o.n, "|", JSON.stringify(o));
const e1 = rec({ n: 1, kind: "contribution", amount: 500, who: "carol", mpesa: "TKL3X9ABCD" });
const outsider = Keypair.generate();
// a member (not an official) proposes; needs 2 official approvals
await step("outsider proposes contribution KES 500", program.methods.propose(1, e1, new BN(500))
  .accountsPartial({ payer: sponsor.publicKey, book, proposal: prop(0), proposer: outsider.publicKey }).signers([outsider]).rpc());
await expectFail("outsider cannot approve", program.methods.approve().accountsPartial({ payer: sponsor.publicKey, book, proposal: prop(0), official: outsider.publicKey }).signers([outsider]).rpc(), "NotOfficial");
await step("Alice approves", program.methods.approve().accountsPartial({ payer: sponsor.publicKey, book, proposal: prop(0), official: alice.publicKey }).signers([alice]).rpc());
await expectFail("Alice approves twice", program.methods.approve().accountsPartial({ payer: sponsor.publicKey, book, proposal: prop(0), official: alice.publicKey }).signers([alice]).rpc(), "AlreadyApproved");
let b = await program.account.book.fetch(book);
check(b.entries.toNumber() === 0, "1 of 2 approvals: nothing recorded yet");
await expectFail("rent can't be redirected", program.methods.approve().accountsPartial({ payer: outsider.publicKey, book, proposal: prop(0), official: bob.publicKey }).signers([bob]).rpc(), "Constraint");
await step("Bob approves -> entry lands", program.methods.approve().accountsPartial({ payer: sponsor.publicKey, book, proposal: prop(0), official: bob.publicKey }).signers([bob]).rpc());
b = await program.account.book.fetch(book);
let root = sha(rules);
const chain = (r, kind, amt, h) => sha(r, [kind], new BN(amt).toArrayLike(Buffer, "le", 8), h);
root = chain(root, 1, 500, e1);
check(b.entries.toNumber() === 1 && Buffer.from(b.root).equals(Buffer.from(root)), "root matches the off-chain record chain");
check((await conn.getAccountInfo(prop(0))) === null, "proposal account closed, rent returned");
// an official proposes a payout: their own approval counts, one more needed
const e2 = rec({ n: 2, kind: "payout", amount: 1500, who: "alice" });
await step("Carol proposes payout KES 1,500", program.methods.propose(2, e2, new BN(1500)).accountsPartial({ payer: sponsor.publicKey, book, proposal: prop(1), proposer: carol.publicKey }).signers([carol]).rpc());
await step("Bob rejects it", program.methods.reject().accountsPartial({ payer: sponsor.publicKey, book, proposal: prop(1), official: bob.publicKey }).signers([bob]).rpc());
b = await program.account.book.fetch(book);
check(b.entries.toNumber() === 1, "rejected payout never recorded");
// rule change by 2 officials updates the rules hash
const rules2 = rules.replace("KES 50", "KES 100");
await step("Alice proposes rule change", program.methods.propose(9, sha(rules2), new BN(0)).accountsPartial({ payer: sponsor.publicKey, book, proposal: prop(2), proposer: alice.publicKey }).signers([alice]).rpc());
await step("Carol approves rule change", program.methods.approve().accountsPartial({ payer: sponsor.publicKey, book, proposal: prop(2), official: carol.publicKey }).signers([carol]).rpc());
b = await program.account.book.fetch(book);
root = chain(root, 9, 0, sha(rules2));
check(Buffer.from(b.rulesHash).equals(Buffer.from(sha(rules2))) && Buffer.from(b.root).equals(Buffer.from(root)), "rules updated and chained");
// tamper check: a different record can never reproduce the root
check(!Buffer.from(chain(chain(sha(rules), 1, 5000, e1), 9, 0, sha(rules2))).equals(Buffer.from(b.root)), "an edited amount breaks the root (tamper evident)");

const out = { program: program.programId.toBase58(), mint: mint.toBase58(), agreement: agreement.toBase58(), chama: chama.toBase58(), book: book.toBase58(), final, failures, txs: log };
fs.writeFileSync(new URL("../e2e-result.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}  (${log.length} transactions, saved to sdk/e2e-result.json)`);
process.exit(failures ? 1 : 0);
