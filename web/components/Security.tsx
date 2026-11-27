"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from "react";
import { Keypair } from "@solana/web3.js";
import QRCode from "qrcode";
import { Turnstile } from "./Turnstile";
import { vault, sealBackup, openBackup, recovery } from "@/lib/vault";
import { exportWallet, handleOf } from "@/lib/fungu";

const PIN_LEN = 6;
const FAILS = "fungu.pinfails";
const BACKUP = "fungu.backup"; // {phone: "+2547•••78", at: ms, totp: bool} — a reminder for this device only

export const backupInfo = (): { phone: string; at: number; totp: boolean } | null => { try { return JSON.parse(localStorage.getItem(BACKUP) || "null"); } catch { return null; } };
const mask = (p: string) => p.replace(/^(\+?\d{4})\d+(\d{2})$/, "$1•••$2");

// ------------------------------------------------------------------ PIN pad
export function PinPad({ label, onDone, error, busy }: { label: string; onDone: (pin: string) => void; error?: string; busy?: boolean }) {
  const [pin, setPin] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (error) setPin(""); }, [error]);
  const push = (d: string) => { if (busy) return; const n = (pin + d).slice(0, PIN_LEN); setPin(n); if (n.length === PIN_LEN) { onDone(n); setTimeout(() => setPin(""), 50); } };
  return (
    <div className="pin">
      <label htmlFor="pin" className="pin-label">{label}</label>
      <input ref={ref} id="pin" className="sr" inputMode="numeric" autoComplete="off" value={pin} aria-describedby={error ? "pin-err" : undefined}
        onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, PIN_LEN); setPin(v); if (v.length === PIN_LEN) { onDone(v); setTimeout(() => setPin(""), 50); } }} />
      <div className="dots" aria-hidden="true" onClick={() => ref.current?.focus()}>{Array.from({ length: PIN_LEN }, (_, i) => <i key={i} className={i < pin.length ? "on" : ""} />)}</div>
      {error && <div id="pin-err" className="pin-err" role="alert">{error}</div>}
      <div className="keys">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => <button key={d} type="button" onClick={() => push(d)} disabled={busy}>{d}</button>)}
        <span />
        <button type="button" onClick={() => push("0")} disabled={busy}>0</button>
        <button type="button" aria-label="Delete" onClick={() => setPin(pin.slice(0, -1))} disabled={busy}>⌫</button>
      </div>
    </div>
  );
}

/** Choose a PIN twice. Rejects the most guessable ones. */
export function NewPin({ onPin, title = "Choose a 6-digit PIN" }: { onPin: (pin: string) => void; title?: string }) {
  const [first, setFirst] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const weak = (p: string) => /^(\d)\1+$/.test(p) || "0123456789".includes(p) || "9876543210".includes(p) || ["123123", "121212", "112233", "696969", "111222"].includes(p);
  return first === null
    ? <PinPad label={title} error={err} onDone={(p) => { if (weak(p)) setErr("That PIN is too easy to guess. Try another."); else { setErr(""); setFirst(p); } }} />
    : <PinPad label="Enter it again to confirm" error={err} onDone={(p) => { if (p === first) onPin(p); else { setErr("Those didn't match. Start again."); setFirst(null); } }} />;
}

// ------------------------------------------------------------------ lock screen
export function LockScreen({ onUnlock, onForgot }: { onUnlock: (k: Keypair) => void; onForgot: () => void }) {
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const bio = vault.hasBio();
  const tried = useRef(false);

  const tryBio = useCallback(async () => {
    setErr(""); setBusy(true);
    try { onUnlock(await vault.unlockBio()); localStorage.removeItem(FAILS); }
    catch { setErr("Fingerprint didn't unlock it. Use your PIN."); }
    finally { setBusy(false); }
  }, [onUnlock]);
  useEffect(() => { if (bio && !tried.current) { tried.current = true; tryBio(); } }, [bio, tryBio]);
  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(wait - 1), 1000); return () => clearTimeout(t); }, [wait]);

  const pin = async (p: string) => {
    if (wait > 0) return;
    setBusy(true); setErr("");
    try { onUnlock(await vault.unlockPin(p)); localStorage.removeItem(FAILS); }
    catch {
      const n = Number(localStorage.getItem(FAILS) || 0) + 1;
      localStorage.setItem(FAILS, String(n));
      const delay = n >= 5 ? Math.min(30 * 2 ** (n - 5), 900) : 0; // 30s, 60s, 120s … up to 15 min
      setWait(delay);
      setErr(delay ? `Wrong PIN ${n} times. Wait ${delay} seconds.` : `Wrong PIN. ${5 - n} tries before a wait.`);
    } finally { setBusy(false); }
  };

  return (
    <main className="lock">
      <div className="lock-card">
        <h1 className="lock-title">Welcome back<span className="dot">.</span></h1>
        <PinPad label={wait ? `Try again in ${wait}s` : "Enter your PIN"} onDone={pin} error={err} busy={busy || wait > 0} />
        {bio && <button className="btn ghost" onClick={tryBio} disabled={busy}>Use fingerprint or face</button>}
        <button className="linkbtn" onClick={onForgot}>Forgot your PIN?</button>
      </div>
    </main>
  );
}

// ------------------------------------------------------------------ phone verification (WhatsApp code from Tafari)
type Verified = { ticket: string; hasBackup: boolean; needsTotp: boolean; phone: string };
export function PhoneVerify({ intro, onVerified }: { intro: string; onVerified: (v: Verified) => void }) {
  const [phone, setPhone] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const onToken = useCallback((t: string | null) => setToken(t), []);
  const send = async () => {
    setBusy(true); setErr("");
    try { await recovery("send", { phone, token }); setSent(true); } catch (e) { setErr((e as Error).message); setToken(null); } finally { setBusy(false); }
  };
  const verify = async (c: string) => {
    setBusy(true); setErr("");
    try { const v = await recovery("verify", { phone, code: c }); onVerified({ ...v, phone }); } catch (e) { setErr((e as Error).message); setCode(""); } finally { setBusy(false); }
  };
  return !sent ? (
    <div className="stack">
      <p className="small">{intro}</p>
      <div className="field"><label htmlFor="ph">WhatsApp number</label><input id="ph" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" /></div>
      <p className="small">We never store your number, only a fingerprint of it. Codes come from Fungu&apos;s WhatsApp line.</p>
      {!token && <Turnstile onToken={onToken} />}
      <button className="btn" disabled={busy || !token || phone.replace(/\D/g, "").length < 9} onClick={send}>{busy ? "Sending…" : "Send me a code on WhatsApp"}</button>
      {err && <div className="notice err">{err}</div>}
    </div>
  ) : (
    <div className="stack">
      <p className="small">We sent a 6-digit code to WhatsApp on <b>{phone}</b>. It works for 10 minutes.</p>
      <div className="field"><label htmlFor="oc">Code</label><input id="oc" className="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
        onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); setCode(v); if (v.length === 6) verify(v); }} disabled={busy} /></div>
      {err && <div className="notice err">{err}</div>}
      <button className="linkbtn" onClick={() => { setSent(false); setCode(""); setToken(null); }}>Use a different number or resend</button>
    </div>
  );
}

// ------------------------------------------------------------------ back up (encrypt on the phone, store ciphertext)
export function BackupFlow({ me, onDone }: { me: Keypair; onDone: () => void }) {
  const [v, setV] = useState<Verified | null>(null);
  const [phrase, setPhrase] = useState("");
  const [phrase2, setPhrase2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [unlocked, setUnlocked] = useState<string | null>(null);
  const [totpNeeded, setTotpNeeded] = useState(false);
  const [totp, setTotp] = useState("");

  const save = async () => {
    setBusy(true); setErr("");
    try {
      const u = await recovery("unlock", { ticket: v!.ticket, totp: totp || undefined });
      if (u.wallet && u.wallet !== me.publicKey.toBase58()) throw new Error("This number already backs up a different Fungu wallet. Use another number.");
      await recovery("save", { ticket: u.ticket, wallet: me.publicKey.toBase58(), blob: await sealBackup(me, phrase, u.pepper) });
      localStorage.setItem(BACKUP, JSON.stringify({ phone: mask(v!.phone.replace(/\s/g, "")), at: Date.now(), totp: !!u.hasTotp }));
      setUnlocked(u.ticket);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  if (unlocked) return <AuthenticatorSetup ticket={unlocked} onDone={onDone} intro="Backed up. Add Google Authenticator so a WhatsApp code alone can never restore your wallet. Recommended." />;
  if (!v) return <PhoneVerify intro="Back up your wallet to your WhatsApp number. If you lose this phone, a code on WhatsApp plus your recovery phrase brings it back." onVerified={(x) => { setV(x); setTotpNeeded(x.needsTotp); }} />;
  const ok = phrase.length >= 8 && phrase === phrase2 && (!totpNeeded || totp.length === 6);
  return (
    <div className="stack">
      <p className="small">Choose a recovery phrase: at least 8 characters, something you won&apos;t forget. Your wallet is locked with it <b>on this phone</b>; Fungu only stores the locked copy and can&apos;t open it.</p>
      <div className="field"><label htmlFor="rp">Recovery phrase</label><input id="rp" type="password" autoComplete="new-password" value={phrase} onChange={(e) => setPhrase(e.target.value)} /></div>
      <div className="field"><label htmlFor="rp2">Type it again</label><input id="rp2" type="password" autoComplete="new-password" value={phrase2} onChange={(e) => setPhrase2(e.target.value)} /></div>
      {phrase2 && phrase !== phrase2 && <p className="small">The two don&apos;t match yet.</p>}
      {totpNeeded && <div className="field"><label htmlFor="tp">Google Authenticator code</label><input id="tp" className="code" inputMode="numeric" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, ""))} /></div>}
      <button className="btn" disabled={!ok || busy} onClick={save}>{busy ? "Locking and saving…" : "Back up my wallet"}</button>
      {err && <div className="notice err">{err}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ Google Authenticator
export function AuthenticatorSetup({ ticket, onDone, intro }: { ticket: string; onDone: () => void; intro: string }) {
  const [s, setS] = useState<{ secret: string; uri: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const begin = async () => {
    setBusy(true); setErr("");
    try { const r = await recovery("totp-setup", { ticket, label: "wallet" }); setS({ ...r, qr: await QRCode.toDataURL(r.uri, { margin: 1, width: 220 }) }); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const confirm = async (c: string) => {
    setBusy(true); setErr("");
    try {
      await recovery("totp-confirm", { ticket, code: c });
      const b = backupInfo(); if (b) localStorage.setItem(BACKUP, JSON.stringify({ ...b, totp: true }));
      onDone();
    } catch (e) { setErr((e as Error).message); setCode(""); } finally { setBusy(false); }
  };
  if (!s) return (
    <div className="stack">
      <p className="small">{intro}</p>
      <div className="row"><button className="btn" onClick={begin} disabled={busy}>{busy ? "…" : "Add Google Authenticator"}</button><button className="btn ghost" onClick={onDone}>Not now</button></div>
      {err && <div className="notice err">{err}</div>}
    </div>
  );
  return (
    <div className="stack">
      <p className="small">In Google Authenticator (or any authenticator app) tap <b>+</b>, then scan this code. On this same phone, tap <b>Open in authenticator</b> or copy the setup key.</p>
      <img src={s.qr} alt="QR code for your authenticator app" width={220} height={220} className="qr" />
      <div className="row"><a className="btn ghost small" href={s.uri}>Open in authenticator</a><button className="btn ghost small" onClick={() => navigator.clipboard.writeText(s.secret)}>Copy setup key</button></div>
      <div className="mono small">{s.secret.replace(/(.{4})/g, "$1 ").trim()}</div>
      <div className="field"><label htmlFor="tc">Type the 6-digit code it shows</label><input id="tc" className="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
        onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); setCode(v); if (v.length === 6) confirm(v); }} disabled={busy} /></div>
      {err && <div className="notice err">{err}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ restore on a new phone
export function RestoreFlow({ onRestored, onCancel }: { onRestored: (k: Keypair) => void; onCancel: () => void }) {
  const [v, setV] = useState<Verified | null>(null);
  const [totp, setTotp] = useState("");
  const [got, setGot] = useState<{ blob: string; pepper: string } | null>(null);
  const [phrase, setPhrase] = useState("");
  const [kp, setKp] = useState<Keypair | null>(null);
  const [paste, setPaste] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const fetchBackup = async () => {
    setBusy(true); setErr("");
    try {
      const u = await recovery("unlock", { ticket: v!.ticket, totp: totp || undefined });
      if (!u.blob) throw new Error("There's no backup for this number.");
      setGot({ blob: u.blob, pepper: u.pepper });
    } catch (e) { setErr((e as Error).message); setTotp(""); } finally { setBusy(false); }
  };
  const open = async () => {
    setBusy(true); setErr("");
    try { setKp(await openBackup(got!.blob, phrase, got!.pepper)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { if (v && v.hasBackup && !v.needsTotp && !got) fetchBackup(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [v]);

  let body;
  if (kp) body = <NewPin title="Set a PIN for this phone" onPin={async (p) => { await vault.create(kp, p); onRestored(kp); }} />;
  else if (got) body = (
    <div className="stack">
      <p className="small">Found your backup. Enter your recovery phrase to open it on this phone.</p>
      <div className="field"><label htmlFor="rr">Recovery phrase</label><input id="rr" type="password" autoComplete="current-password" value={phrase} onChange={(e) => setPhrase(e.target.value)} /></div>
      <button className="btn" disabled={phrase.length < 8 || busy} onClick={open}>{busy ? "Opening…" : "Restore my wallet"}</button>
    </div>
  );
  else if (v && !v.hasBackup) body = <div className="notice">There&apos;s no Fungu backup for {v.phone}. Try the number you backed up with, or use a backup key below.</div>;
  else if (v && v.needsTotp) body = (
    <div className="stack">
      <p className="small">This backup is protected by Google Authenticator. Enter the code from the app.</p>
      <div className="field"><label htmlFor="rt">Authenticator code</label><input id="rt" className="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value.replace(/\D/g, "").slice(0, 6))} /></div>
      <button className="btn" disabled={totp.length !== 6 || busy} onClick={fetchBackup}>{busy ? "Checking…" : "Continue"}</button>
    </div>
  );
  else if (!v) body = <PhoneVerify intro="Restore with the WhatsApp number you backed up with." onVerified={setV} />;

  return (
    <div className="stack">
      <div className="card stack">
        <h1>Restore your wallet</h1>
        {body}
        {err && <div className="notice err">{err}</div>}
      </div>
      {!kp && (
        <details className="card">
          <summary>Restore from a backup key instead</summary>
          <div className="stack" style={{ marginTop: 12 }}>
            <textarea rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder="Paste your backup key" />
            <button className="btn ghost small" onClick={() => { try { setKp(Keypair.fromSecretKey(Uint8Array.from(JSON.parse(paste.trim())))); } catch { setErr("That backup key isn't valid."); } }}>Use this key</button>
          </div>
        </details>
      )}
      <button className="linkbtn" onClick={onCancel}>Back</button>
    </div>
  );
}

// ------------------------------------------------------------------ Me → Security
export function SecurityCard({ me, onLock }: { me: Keypair; onLock: () => void }) {
  const [mode, setMode] = useState<"" | "backup" | "pin" | "key" | "totp">("");
  const [bioOk, setBioOk] = useState(false);
  const [bio, setBio] = useState(vault.hasBio());
  const [msg, setMsg] = useState("");
  const [keyShown, setKeyShown] = useState(false);
  const [ticket, setTicket] = useState<string | null>(null);
  const [handle, setHandle] = useState<string | null>(null);
  const b = backupInfo();
  useEffect(() => { vault.bioAvailable().then(setBioOk); handleOf(me.publicKey).then(setHandle); }, [me]);

  const toggleBio = async () => {
    setMsg("");
    if (bio) { vault.disableBio(); setBio(false); setMsg("Fingerprint unlock is off."); return; }
    try { const ok = await vault.enableBio(me, handle ? `@${handle}` : "Fungu wallet"); setBio(ok); setMsg(ok ? "Fingerprint unlock is on." : "This phone's browser can't lock Fungu with a fingerprint yet. Your PIN still protects it."); }
    catch { setMsg("Fingerprint set-up was cancelled."); }
  };

  return (
    <div className="card stack">
      <h3>Security</h3>
      <ul className="checks">
        <li className="on">PIN lock: your key is encrypted on this phone</li>
        <li className={bio ? "on" : ""}>Fingerprint or face unlock</li>
        <li className={b ? "on" : ""}>WhatsApp backup{b ? ` (${b.phone})` : ""}</li>
        <li className={b?.totp ? "on" : ""}>Google Authenticator on restore</li>
      </ul>
      {msg && <div className="notice">{msg}</div>}

      {mode === "" && (
        <div className="row wrap">
          <button className="btn small" onClick={() => setMode("backup")}>{b ? "Back up again" : "Back up to WhatsApp"}</button>
          {bioOk && <button className="btn ghost small" onClick={toggleBio}>{bio ? "Turn off fingerprint" : "Use fingerprint or face"}</button>}
          {b && !b.totp && <button className="btn ghost small" onClick={() => setMode("totp")}>Add Google Authenticator</button>}
          <button className="btn ghost small" onClick={() => setMode("pin")}>Change PIN</button>
          <button className="btn ghost small" onClick={() => setMode("key")}>Show backup key</button>
          <button className="btn ghost small" onClick={onLock}>Lock now</button>
        </div>
      )}
      {mode === "backup" && <BackupFlow me={me} onDone={() => { setMode(""); setMsg("Your wallet is backed up."); }} />}
      {mode === "totp" && (ticket
        ? <AuthenticatorSetup ticket={ticket} intro="Scan with Google Authenticator." onDone={() => { setMode(""); setTicket(null); setMsg("Google Authenticator is on."); }} />
        : <PhoneVerify intro="First, confirm your backup number." onVerified={async (v) => {
            try { const u = await recovery("unlock", { ticket: v.ticket }); setTicket(u.ticket); } catch (e) { setMsg((e as Error).message); setMode(""); }
          }} />)}
      {mode === "pin" && <ReauthThen onCancel={() => setMode("")} then={(k) => <NewPin title="Choose a new PIN" onPin={async (p) => { await vault.changePin(k, p); setMode(""); setMsg("PIN changed."); }} />} />}
      {mode === "key" && <ReauthThen onCancel={() => { setMode(""); setKeyShown(false); }} then={(k) => (
        <div className="stack">
          <div className="notice err">Anyone with this key controls your wallet. Never send it to anyone, including Fungu.</div>
          {keyShown ? <div className="terms mono" style={{ fontSize: 11 }}>{exportWallet(k)}</div> : <button className="btn ghost small" onClick={() => setKeyShown(true)}>Reveal</button>}
          <div className="row"><button className="btn ghost small" onClick={() => navigator.clipboard.writeText(exportWallet(k))}>Copy</button><button className="btn ghost small" onClick={() => { setMode(""); setKeyShown(false); }}>Done</button></div>
        </div>
      )} />}
    </div>
  );
}

/** Ask for the PIN again before a sensitive action. */
function ReauthThen({ then, onCancel }: { then: (k: Keypair) => React.ReactNode; onCancel: () => void }) {
  const [k, setK] = useState<Keypair | null>(null);
  const [err, setErr] = useState("");
  if (k) return <>{then(k)}</>;
  return (
    <div className="stack">
      <PinPad label="Enter your current PIN" error={err} onDone={async (p) => { try { setK(await vault.unlockPin(p)); } catch { setErr("Wrong PIN."); } }} />
      <button className="linkbtn" onClick={onCancel}>Cancel</button>
    </div>
  );
}
