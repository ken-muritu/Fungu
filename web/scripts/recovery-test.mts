// Tests /api/recovery end to end against the real database, with the WhatsApp delivery (Tafari) and the
// human check intercepted so no message is sent. Proves: codes, expiry rules, tickets, zero-knowledge
// backup, authenticator enrolment, the second factor on restore and the lockout.
// Usage (from web/): node --conditions=react-server --import tsx scripts/recovery-test.mts
import fs from "node:fs";
import os from "node:os";
for (const f of ["turso.env", "recovery.env", "turnstile.env"])
  for (const line of fs.readFileSync(`${os.homedir()}/.config/fungu/${f}`, "utf8").split(/\r?\n/)) { const m = line.match(/^(\w+)=(.*)$/); if (m) process.env[m[1]] = m[2]; }
process.env.TAFARI_URL = "https://tafari.test";
process.env.TAFARI_OTP_KEY = "test";

let lastCode = "";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (u: any, o?: any) => {
  const url = String(u);
  if (url.startsWith("https://tafari.test")) { lastCode = JSON.parse(o.body).code; return new Response(null, { status: 202 }); }
  if (url.includes("turnstile")) return Response.json({ success: true });
  return realFetch(u, o);
}) as typeof fetch;

const { POST } = await import("../app/api/recovery/route");
const { totpNow, sql, phoneHash } = await import("../lib/recovery");
const { Keypair } = await import("@solana/web3.js");
const { sealBackup, openBackup } = await import("../lib/vault");
const call = async (step: string, body: object) => (await POST(new Request("http://x/api/recovery", { method: "POST", body: JSON.stringify({ step, ...body }) }) as any)).json();

let fails = 0;
const check = (ok: boolean, what: string) => { console.log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) fails++; };
const phone = `07${String(Date.now()).slice(-8)}`; // a fresh test number every run
const kp = Keypair.generate();

check((await call("send", { phone: "123", token: "t" })).ok === false, "bad phone format refused");
check((await call("send", { phone, token: "t" })).ok === true && /^\d{6}$/.test(lastCode), "WhatsApp code sent (6 digits)");
check((await call("verify", { phone, code: "000000" === lastCode ? "111111" : "000000" })).ok === false, "wrong code refused");
const v = await call("verify", { phone: "+254" + phone.slice(1), code: lastCode });
check(v.ok && !v.hasBackup && !v.needsTotp, "right code accepted (same number in +254 form)");
check((await call("verify", { phone, code: lastCode })).ok === false, "a code works only once");
check((await call("unlock", { ticket: v.ticket.replace(/.$/, (c: string) => (c === "A" ? "B" : "A")) })).ok === false, "tampered ticket refused");
const u = await call("unlock", { ticket: v.ticket });
check(u.ok && /^[0-9a-f]{64}$/.test(u.pepper) && !u.blob, "unlock gives a pepper, no backup yet");
check((await call("save", { ticket: v.ticket, wallet: kp.publicKey.toBase58(), blob: "x" })).ok === false, "saving needs an unlocked ticket");
const blob = await sealBackup(kp, "correct horse battery", u.pepper);
check((await call("save", { ticket: u.ticket, wallet: kp.publicKey.toBase58(), blob })).ok, "encrypted backup saved");
const row = (await (await sql()).execute({ sql: "SELECT blob, pepper FROM v2_backup WHERE ph = ?", args: [phoneHash("+254" + phone.slice(1))] })).rows[0];
check(!String(row.blob).includes(kp.publicKey.toBase58()) && !String(row.pepper).includes(u.pepper), "database holds only ciphertext and a sealed pepper");

const t = await call("totp-setup", { ticket: u.ticket, label: "test" });
check(t.ok && t.uri.startsWith("otpauth://totp/Fungu:"), "authenticator secret issued");
const secret = Buffer.from(base32decode(t.secret));
check((await call("totp-confirm", { ticket: u.ticket, code: "123456" === totpNow(secret) ? "654321" : "123456" })).ok === false, "wrong authenticator code refused at enrolment");
check((await call("totp-confirm", { ticket: u.ticket, code: totpNow(secret) })).ok, "authenticator turned on");

// restore on a "new phone"
await call("send", { phone, token: "t" });
const v2 = await call("verify", { phone, code: lastCode });
check(v2.ok && v2.hasBackup && v2.needsTotp, "second login: backup exists, authenticator required");
check((await call("unlock", { ticket: v2.ticket })).ok === false, "restore without the authenticator code refused");
const r = await call("unlock", { ticket: v2.ticket, totp: totpNow(secret) });
check(r.ok && !!r.blob, "restore with WhatsApp + authenticator returns the backup");
check((await openBackup(r.blob, "correct horse battery", r.pepper)).publicKey.equals(kp.publicKey), "the right passphrase reopens the same wallet");
await openBackup(r.blob, "wrong passphrase", r.pepper).then(() => check(false, "wrong passphrase"), () => check(true, "a wrong passphrase can't open it"));
for (let i = 0; i < 5; i++) await call("unlock", { ticket: v2.ticket, totp: "000000" });
check(/hour/.test((await call("unlock", { ticket: v2.ticket, totp: totpNow(secret) })).error || ""), "5 wrong authenticator codes lock restore for an hour");

await (await sql()).execute({ sql: "DELETE FROM v2_backup WHERE ph = ?", args: [phoneHash("+254" + phone.slice(1))] });
await (await sql()).execute({ sql: "DELETE FROM v2_otp WHERE ph = ?", args: [phoneHash("+254" + phone.slice(1))] });
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);

function base32decode(s: string) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, val = 0; const out: number[] = [];
  for (const c of s) { val = (val << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return out;
}
