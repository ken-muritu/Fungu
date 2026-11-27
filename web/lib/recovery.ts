import "server-only";
import crypto from "node:crypto";
import { createClient, type Client } from "@libsql/client";

/*
 Wallet recovery, zero-knowledge.
 - The wallet key is encrypted on the phone with PBKDF2(recovery PIN + pepper). The server stores only that
   ciphertext. The pepper is random per person, kept encrypted with RECOVERY_KEY, and released only after
   a WhatsApp code (sent by Tafari) and, once enrolled, a Google Authenticator code. A database leak alone
   therefore can't be brute-forced.
 - Phone numbers are never stored: rows are keyed by HMAC(RECOVERY_KEY, phone).
*/

const master = () => {
  const k = process.env.RECOVERY_KEY;
  if (!k || k.length < 64) throw new Error("RECOVERY_KEY is not set");
  return Buffer.from(k, "hex");
};
const subkey = (label: string) => crypto.createHmac("sha256", master()).update(label).digest();

let db: Client | null = null;
let ready: Promise<unknown> | null = null;
export async function sql() {
  db ??= createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
  ready ??= db.batch([
    "CREATE TABLE IF NOT EXISTS v2_otp (ph TEXT PRIMARY KEY, code_hash TEXT, expires INTEGER, attempts INTEGER, sends TEXT)",
    "CREATE TABLE IF NOT EXISTS v2_backup (ph TEXT PRIMARY KEY, wallet TEXT, blob TEXT, pepper TEXT NOT NULL, totp TEXT, totp_pending TEXT, totp_fails INTEGER NOT NULL DEFAULT 0, totp_lock INTEGER NOT NULL DEFAULT 0, updated INTEGER)",
  ], "write");
  await ready;
  return db;
}

// ------------------------------------------------------------ phone
/** Kenyan numbers in any common form (0712…, 712…, 254712…, +254 712 …) → +254712…; other countries need "+". */
export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.replace(/[\s()-]/g, "");
  if (/^0[17]\d{8}$/.test(s)) s = "+254" + s.slice(1);
  else if (/^[17]\d{8}$/.test(s)) s = "+254" + s;
  else if (/^254\d{9}$/.test(s)) s = "+" + s;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}
export const phoneHash = (phone: string) => crypto.createHmac("sha256", subkey("phone")).update(phone).digest("hex");

// ------------------------------------------------------------ sealing small secrets at rest
export function seal(plain: Buffer): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", subkey("seal"), iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
export function unseal(b64: string): Buffer {
  const b = Buffer.from(b64, "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", subkey("seal"), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]);
}

// ------------------------------------------------------------ tickets (short-lived, signed)
export type Stage = "phone" | "unlocked";
export function ticket(ph: string, stage: Stage, minutes = 15): string {
  const body = Buffer.from(JSON.stringify({ ph, stage, exp: Date.now() + minutes * 60_000 })).toString("base64url");
  return `${body}.${crypto.createHmac("sha256", subkey("ticket")).update(body).digest("base64url")}`;
}
export function readTicket(t: unknown, stage: Stage): string | null {
  if (typeof t !== "string" || !t.includes(".")) return null;
  const [body, mac] = t.split(".");
  const want = crypto.createHmac("sha256", subkey("ticket")).update(body).digest("base64url");
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  const v = JSON.parse(Buffer.from(body, "base64url").toString());
  return v.exp > Date.now() && v.stage === stage ? v.ph : null;
}

// ------------------------------------------------------------ WhatsApp codes via Tafari
const codeHash = (ph: string, code: string) => crypto.createHmac("sha256", subkey("code")).update(`${ph}:${code}`).digest("hex");

export async function sendCode(phone: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const ph = phoneHash(phone);
  const d = await sql();
  const row = (await d.execute({ sql: "SELECT sends FROM v2_otp WHERE ph = ?", args: [ph] })).rows[0];
  const hourAgo = Date.now() - 3_600_000;
  const sends = (row?.sends ? (JSON.parse(String(row.sends)) as number[]) : []).filter((t) => t > hourAgo);
  if (sends.length >= 3) return { ok: false, status: 429, error: "Too many codes for this number. Try again in an hour." };
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const r = await fetch(`${process.env.TAFARI_URL}/otp/send`, {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.TAFARI_OTP_KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ phone, code, brand: "Fungu" }),
    signal: AbortSignal.timeout(20_000),
  }).catch(() => null);
  if (!r) return { ok: false, status: 503, error: "WhatsApp delivery is not responding. Try again in a minute." };
  if (r.status === 404) return { ok: false, status: 400, error: "This number isn't on WhatsApp." };
  if (r.status === 429) return { ok: false, status: 429, error: "Too many codes right now. Try again shortly." };
  if (r.status !== 202) return { ok: false, status: 503, error: "Couldn't send the WhatsApp code. Try again in a minute." };
  sends.push(Date.now());
  await d.execute({
    sql: "INSERT INTO v2_otp (ph, code_hash, expires, attempts, sends) VALUES (?, ?, ?, 0, ?) ON CONFLICT(ph) DO UPDATE SET code_hash = excluded.code_hash, expires = excluded.expires, attempts = 0, sends = excluded.sends",
    args: [ph, codeHash(ph, code), Date.now() + 10 * 60_000, JSON.stringify(sends)],
  });
  return { ok: true };
}

export async function checkCode(phone: string, code: unknown): Promise<string | null> {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return null;
  const ph = phoneHash(phone);
  const d = await sql();
  const row = (await d.execute({ sql: "SELECT code_hash, expires, attempts FROM v2_otp WHERE ph = ?", args: [ph] })).rows[0];
  if (!row || !row.code_hash || Number(row.expires) < Date.now() || Number(row.attempts) >= 5) return null;
  const good = crypto.timingSafeEqual(Buffer.from(String(row.code_hash)), Buffer.from(codeHash(ph, code)));
  await d.execute({ sql: good ? "UPDATE v2_otp SET code_hash = NULL WHERE ph = ?" : "UPDATE v2_otp SET attempts = attempts + 1 WHERE ph = ?", args: [ph] });
  return good ? ph : null;
}

// ------------------------------------------------------------ Google Authenticator (RFC 6238, SHA-1, 6 digits, 30 s)
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32(buf: Buffer): string {
  let bits = 0, val = 0, out = "";
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  return bits > 0 ? out + B32[(val << (5 - bits)) & 31] : out;
}
function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac("sha1", secret).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
}
export function totpOk(secret: Buffer, code: unknown, now = Date.now()): boolean {
  if (typeof code !== "string" || !/^\d{6}$/.test(code)) return false;
  const step = Math.floor(now / 30_000);
  return [-1, 0, 1].some((w) => crypto.timingSafeEqual(Buffer.from(hotp(secret, step + w)), Buffer.from(code)));
}
export const totpNow = (secret: Buffer, now = Date.now()) => hotp(secret, Math.floor(now / 30_000)); // for tests

// ------------------------------------------------------------ backup rows
export type BackupRow = { wallet: string | null; blob: string | null; pepper: string; totp: string | null; totp_pending: string | null; totp_fails: number; totp_lock: number };
export async function getBackup(ph: string): Promise<BackupRow | null> {
  const r = (await (await sql()).execute({ sql: "SELECT wallet, blob, pepper, totp, totp_pending, totp_fails, totp_lock FROM v2_backup WHERE ph = ?", args: [ph] })).rows[0];
  return r ? (r as unknown as BackupRow) : null;
}
/** Second factor: checks the code and counts failures (5 wrong → locked for 1 hour). */
export async function checkTotp(ph: string, row: BackupRow, code: unknown): Promise<"ok" | "bad" | "locked"> {
  if (!row.totp) return "ok";
  if (Number(row.totp_lock) > Date.now()) return "locked";
  const d = await sql();
  if (totpOk(unseal(row.totp), code)) { await d.execute({ sql: "UPDATE v2_backup SET totp_fails = 0 WHERE ph = ?", args: [ph] }); return "ok"; }
  const fails = Number(row.totp_fails) + 1;
  await d.execute({ sql: "UPDATE v2_backup SET totp_fails = ?, totp_lock = ? WHERE ph = ?", args: [fails >= 5 ? 0 : fails, fails >= 5 ? Date.now() + 3_600_000 : 0, ph] });
  return fails >= 5 ? "locked" : "bad";
}

export const json = (body: object, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
