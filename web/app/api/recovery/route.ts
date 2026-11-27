import crypto from "node:crypto";
import { NextRequest } from "next/server";
import { verifyTurnstile, isPubkey } from "@/lib/server";
import {
  base32, checkCode, checkTotp, getBackup, json, normalizePhone, readTicket, seal, sendCode, sql, ticket, unseal, totpOk,
} from "@/lib/recovery";

/*
 One endpoint, one "step" per call:
   send    {phone, token}            → WhatsApp code (needs a Cloudflare human check)
   verify  {phone, code}             → ticket(phone) + whether a backup / authenticator exists
   unlock  {ticket, totp?}           → ticket(unlocked) + pepper (+ the encrypted backup if one exists)
   save    {ticket*, wallet, blob}   → stores the encrypted backup        (* unlocked ticket)
   totp-setup   {ticket*}            → new authenticator secret (pending until confirmed)
   totp-confirm {ticket*, code}      → turns the authenticator on
*/
export async function POST(req: NextRequest) {
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return json({ ok: false, error: "bad request" }, 400); }
  try {
    switch (b.step) {
      case "send": {
        const phone = normalizePhone(b.phone);
        if (!phone) return json({ ok: false, error: "Enter a phone number like 0712 345 678 or +254 712 345 678." }, 400);
        if (!(await verifyTurnstile(b.token as string, req.headers.get("x-forwarded-for")))) return json({ ok: false, error: "Human check failed, try again." }, 403);
        const r = await sendCode(phone);
        return r.ok ? json({ ok: true }) : json({ ok: false, error: r.error }, r.status);
      }
      case "verify": {
        const phone = normalizePhone(b.phone);
        const ph = phone && (await checkCode(phone, b.code));
        if (!ph) return json({ ok: false, error: "That code is wrong or has expired." }, 401);
        const row = await getBackup(ph);
        return json({ ok: true, ticket: ticket(ph, "phone"), hasBackup: !!row?.blob, needsTotp: !!row?.totp });
      }
      case "unlock": {
        const ph = readTicket(b.ticket, "phone");
        if (!ph) return json({ ok: false, error: "Your session expired. Start again." }, 401);
        let row = await getBackup(ph);
        if (row) {
          const t = await checkTotp(ph, row, b.totp);
          if (t === "locked") return json({ ok: false, error: "Too many wrong codes. Try again in an hour." }, 429);
          if (t === "bad") return json({ ok: false, error: "That authenticator code is wrong." }, 401);
        } else {
          const pepper = seal(crypto.randomBytes(32));
          await (await sql()).execute({ sql: "INSERT INTO v2_backup (ph, pepper, updated) VALUES (?, ?, ?) ON CONFLICT(ph) DO NOTHING", args: [ph, pepper, Date.now()] });
          row = await getBackup(ph);
        }
        return json({ ok: true, ticket: ticket(ph, "unlocked"), pepper: unseal(row!.pepper).toString("hex"), blob: row!.blob, wallet: row!.wallet, hasTotp: !!row!.totp });
      }
      case "save": {
        const ph = readTicket(b.ticket, "unlocked");
        if (!ph) return json({ ok: false, error: "Your session expired. Start again." }, 401);
        if (!isPubkey(b.wallet) || typeof b.blob !== "string" || b.blob.length > 2000) return json({ ok: false, error: "bad backup" }, 400);
        await (await sql()).execute({ sql: "UPDATE v2_backup SET wallet = ?, blob = ?, updated = ? WHERE ph = ?", args: [b.wallet, b.blob, Date.now(), ph] });
        return json({ ok: true });
      }
      case "totp-setup": {
        const ph = readTicket(b.ticket, "unlocked");
        if (!ph) return json({ ok: false, error: "Your session expired. Start again." }, 401);
        const secret = crypto.randomBytes(20);
        await (await sql()).execute({ sql: "UPDATE v2_backup SET totp_pending = ? WHERE ph = ?", args: [seal(secret), ph] });
        const s = base32(secret);
        const label = typeof b.label === "string" ? b.label.replace(/[^\w .@-]/g, "").slice(0, 24) : "wallet";
        return json({ ok: true, secret: s, uri: `otpauth://totp/Fungu:${encodeURIComponent(label || "wallet")}?secret=${s}&issuer=Fungu&digits=6&period=30` });
      }
      case "totp-confirm": {
        const ph = readTicket(b.ticket, "unlocked");
        if (!ph) return json({ ok: false, error: "Your session expired. Start again." }, 401);
        const row = await getBackup(ph);
        if (!row?.totp_pending || !totpOk(unseal(row.totp_pending), b.code)) return json({ ok: false, error: "That code doesn't match. Check the time on your phone and try the newest code." }, 401);
        await (await sql()).execute({ sql: "UPDATE v2_backup SET totp = totp_pending, totp_pending = NULL, totp_fails = 0 WHERE ph = ?", args: [ph] });
        return json({ ok: true });
      }
      default:
        return json({ ok: false, error: "unknown step" }, 400);
    }
  } catch (e) {
    console.error("recovery", b.step, (e as Error).message);
    return json({ ok: false, error: "Something went wrong on our side. Try again." }, 500);
  }
}
