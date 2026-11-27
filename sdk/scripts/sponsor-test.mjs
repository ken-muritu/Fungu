// Tests the web app's fee sponsor (/api/sponsor): a user with zero SOL gets a
// Fungu transaction through, and a transaction trying to spend the sponsor's SOL is refused.
// Usage: BASE_URL=http://localhost:3123 node scripts/sponsor-test.mjs
import fs from "node:fs";
import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
const BASE = process.env.BASE_URL || "http://localhost:3123";
const SPONSOR = new PublicKey("G2AumARqudFsRNCeujLzyCyPbwbdkKTpChq5EazsfyTo");
const idl = JSON.parse(fs.readFileSync(new URL("../idl/fungu.json", import.meta.url)));
const conn = new Connection("https://api.devnet.solana.com", "confirmed");
const program = new Program(idl, new AnchorProvider(conn, new Wallet(Keypair.generate()), {}));
const post = async (tx) => (await fetch(`${BASE}/api/sponsor`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tx: tx.serialize({ requireAllSignatures: false }).toString("base64") }) })).json();
const build = async (ixs, signer) => { const tx = new Transaction().add(...ixs); tx.feePayer = SPONSOR; tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash; tx.partialSign(signer); return tx; };
let fail = 0; const check = (ok, what) => { console.log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) fail++; };

const user = Keypair.generate();
check((await conn.getBalance(user.publicKey)) === 0, "new user has 0 SOL");
const ix = await program.methods.initProfile().accountsPartial({ payer: SPONSOR, user: user.publicKey }).instruction();
const r1 = await post(await build([ix], user));
check(r1.ok === true, `sponsored initProfile went through ${r1.signature ? "https://explorer.solana.com/tx/" + r1.signature + "?cluster=devnet" : r1.error}`);
const theft = SystemProgram.transfer({ fromPubkey: SPONSOR, toPubkey: user.publicKey, lamports: 1_000_000_000 });
const r2 = await post(await build([SystemProgram.transfer({ fromPubkey: user.publicKey, toPubkey: user.publicKey, lamports: 0 }), theft], user));
check(r2.ok === false && /not allowed/.test(r2.error), `SOL transfer from sponsor refused (${r2.error})`);
const unsigned = new Transaction().add(ix); unsigned.feePayer = SPONSOR; unsigned.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
const r3 = await post(unsigned);
check(r3.ok === false, `transaction without the user's signature refused (${r3.error})`);
process.exit(fail ? 1 : 0);
