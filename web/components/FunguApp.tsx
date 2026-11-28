"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Logo, Ring } from "./Brand";
import { IBook, IChama, IDebts, IHome, IMe, IPlus, IRefresh } from "./Icons";
import { Turnstile } from "./Turnstile";
import { Books, BookView, importSharedRecord } from "./Books";
import { BackupFlow, LockScreen, NewPin, RestoreFlow, SecurityCard } from "./Security";
import { vault } from "@/lib/vault";
import {
  actions, balance, createWallet, fetchAgreement, fetchAgreements, fetchChama, fetchChamas, fetchProfile,
  fmt, handleOf, loadWallet, nameOf, NAME_RE, names, ownerOfName, sha256, short, termsStore,
} from "@/lib/fungu";
import { explorer, UNIT } from "@/lib/config";

type Tab = "home" | "debts" | "chamas" | "books" | "me";
type Msg = { kind: "ok" | "err" | "info"; text: string; sig?: string } | null;

const b64u = {
  enc: (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))),
};
const origin = () => window.location.origin;
const wa = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
/** A friend as @name, a Fungu link (?to=address or ?to=@name) or a raw address. */
const toKey = async (s: string): Promise<PublicKey | null> => {
  const t = s.trim();
  const q = t.match(/[?&]to=(@?[A-Za-z0-9_]{3,44})/);
  const v = decodeURIComponent(q ? q[1] : t);
  const n = v.replace(/^@/, "").toLowerCase();
  if (v.startsWith("@") || (v.length <= 20 && NAME_RE.test(n))) return ownerOfName(n);
  try { return new PublicKey(v); } catch { return null; }
};
const LOCK_AFTER = 5 * 60_000;
let kesRate: number | null = null;
/** "≈ KSh 1,300" for an fUSD amount; empty until the rate loads. fUSD is a test dollar pegged 1:1 to USD. */
const ksh = (usd: number) => (kesRate ? `≈ KSh ${Math.round(usd * kesRate).toLocaleString("en-KE")}` : "");
const dateOf = (ts: any) => new Date(Number(ts) * 1000).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });

export default function FunguApp() {
  const [me, setMe] = useState<Keypair | null>(null);
  const [ready, setReady] = useState(false);
  const [gate, setGate] = useState<"lock" | "migrate" | "new" | "restore" | null>(null);
  const [, setHandlesTick] = useState(0);
  const [tab, setTab] = useState<Tab>("home");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [bal, setBal] = useState(0);
  const [debts, setDebts] = useState<any[]>([]);
  const [chamas, setChamas] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [focus, setFocus] = useState<{ kind: "agreement" | "chama" | "book"; address: string } | null>(null);
  const [prefill, setPrefill] = useState<{ to?: string; name?: string }>({});
  const [startNew, setStartNew] = useState(0); // bumps to open the "new" form on Debts/Chamas
  const [myHandle, setMyHandle] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/rate").then((r) => r.json()).then((j) => { if (j.kes) { kesRate = j.kes; setHandlesTick((n) => n + 1); } }).catch(() => {});
    setGate(vault.exists() ? "lock" : loadWallet() ? "migrate" : "new");
    const q = new URLSearchParams(window.location.search);
    const to = q.get("to"), n = q.get("n"), a = q.get("a"), t = q.get("t"), c = q.get("c");
    if (to) { setPrefill({ to, name: n || "" }); if (n) names.set(to, n); setTab("debts"); }
    if (a) { if (t) { try { termsStore.set(a, b64u.dec(t)); } catch { /* ignore */ } } setFocus({ kind: "agreement", address: a }); setTab("debts"); }
    if (c) { setFocus({ kind: "chama", address: c }); setTab("chamas"); }
    const bk = q.get("b"), r = q.get("r");
    if (bk) { if (r) importSharedRecord(bk, r); setFocus({ kind: "book", address: bk }); setTab("books"); }
    const tb = q.get("tab"); if (tb === "debts" || tb === "chamas" || tb === "books" || tb === "me") setTab(tb);
    setReady(true);
  }, []);

  const refresh = useCallback(async () => {
    if (!me) return;
    const [b, d, c, p] = await Promise.all([balance(me.publicKey), fetchAgreements(me.publicKey).catch(() => []), fetchChamas(me.publicKey).catch(() => []), fetchProfile(me.publicKey).catch(() => null)]);
    setBal(b); setDebts(d); setChamas(c); setProfile(p);
  }, [me]);
  useEffect(() => { refresh(); if (me) handleOf(me.publicKey).then(setMyHandle); }, [refresh, me]);
  // success and progress notes clear themselves; errors stay until the next action
  useEffect(() => { if (msg && msg.kind !== "err" && !busy) { const t = setTimeout(() => setMsg(null), 6000); return () => clearTimeout(t); } }, [msg, busy]);

  // the key is only ever in memory while unlocked; 5 minutes away from the app locks it again
  useEffect(() => {
    if (!me) return;
    let hiddenAt = 0;
    const onVis = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > LOCK_AFTER) { setMe(null); setGate("lock"); }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [me]);

  // show friends by their on-chain @name where they have one
  useEffect(() => {
    const keys = new Set<string>();
    debts.forEach((d) => { keys.add(d.lender.toBase58()); keys.add(d.borrower.toBase58()); if (d.guarantor) keys.add(d.guarantor.toBase58()); });
    let live = true;
    Promise.all([...keys].map(async (k) => { const h = await handleOf(new PublicKey(k)); if (h && live) names.set(k, "@" + h); })).then(() => { if (live) setHandlesTick((n) => n + 1); });
    return () => { live = false; };
  }, [debts]);

  const run = useCallback(async (label: string, fn: () => Promise<string | { sig: string }>) => {
    setBusy(true); setMsg({ kind: "info", text: `${label}…` });
    try {
      const r = await fn();
      const sig = typeof r === "string" ? r : r.sig;
      setMsg({ kind: "ok", text: `${label}: done.`, sig });
      await refresh();
      return r;
    } catch (e) {
      setMsg({ kind: "err", text: `${label} didn't go through: ${(e as Error).message}` });
      return null;
    } finally { setBusy(false); }
  }, [refresh]);

  if (!ready) return null;
  if (!me) {
    const shell = (body: React.ReactNode) => <><header className="top"><div className="wrap"><Logo /><nav className="nav"><a className="navlink" href="/">About Fungu</a></nav></div></header><main className="app">{body}</main></>;
    if (gate === "lock") return <LockScreen onUnlock={setMe} onForgot={() => setGate("restore")} />;
    if (gate === "restore") return shell(<RestoreFlow onRestored={setMe} onCancel={() => setGate(vault.exists() ? "lock" : "new")} />);
    if (gate === "migrate") return shell(
      <div className="card stack">
        <h1>Protect your wallet with a PIN</h1>
        <p className="small">Fungu now locks your wallet on this phone. Choose a PIN; you&apos;ll use it (or your fingerprint) to open Fungu.</p>
        <NewPin onPin={async (p) => { const k = loadWallet()!; await vault.create(k, p); setMe(k); }} />
      </div>);
    return <Onboarding onReady={(k, landing) => { setMe(k); if (landing) setTab(landing); }} onRestore={() => setGate("restore")} />;
  }

  const owedToMe = debts.filter((d) => d.lender.equals(me.publicKey) && d.status === "active").reduce((s, d) => s + (d.principal.toNumber() - d.repaid.toNumber()), 0) / UNIT;
  const iOwe = debts.filter((d) => d.borrower.equals(me.publicKey) && d.status === "active").reduce((s, d) => s + (d.principal.toNumber() - d.repaid.toNumber()), 0) / UNIT;
  const myLink = myHandle ? `${origin()}/app?to=@${myHandle}` : `${origin()}/app?to=${me.publicKey.toBase58()}`;
  const TABS: [Tab, string, () => React.ReactElement][] = [["home", "Home", IHome], ["debts", "Debts", IDebts], ["chamas", "Chamas", IChama], ["books", "Books", IBook], ["me", "Me", IMe]];
  const go = (t: Tab, open = false) => { setTab(t); setFocus(null); if (open) setStartNew((n) => n + 1); };

  return (
    <>
      <header className="top"><div className="wrap"><Logo /><nav className="nav"><a className="navlink" href="/">About Fungu</a></nav></div></header>
      <main className="app">
        <h1 className="sr">Fungu · {TABS.find((x) => x[0] === tab)![1]}</h1><h2 className="sr">{TABS.find((x) => x[0] === tab)![1]}</h2>
        <nav className="tabs" role="tablist" aria-label="Sections">
          {TABS.map(([t, label, Icon]) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => go(t)}><Icon /><span>{label}</span></button>
          ))}
        </nav>

        {msg && (
          <div className={`notice ${msg.kind === "err" ? "err" : msg.kind === "ok" ? "ok" : ""}`} style={{ marginBottom: 16 }}>
            {msg.text} {msg.sig && <a href={explorer("tx", msg.sig)} target="_blank" rel="noreferrer">View on Solana ↗</a>}
          </div>
        )}

        {tab === "home" && (
          <div className="stack">
            <section className="wallet" aria-label="Your balance">
              <div className="wallet-top">
                <span>{myHandle ? `@${myHandle}` : "Your wallet"}</span>
                <button className="iconbtn" onClick={() => refresh()} disabled={busy} aria-label="Refresh balance"><IRefresh /></button>
              </div>
              <div className="wallet-amt"><b>{fmt(bal)}</b> <span>fUSD</span></div>
              <div className="wallet-kes">{ksh(bal) || "\u00a0"}</div>
              <div className="wallet-actions">
                <button className="btn chai" onClick={() => go("debts", true)}><IPlus />Lend to a friend</button>
                <button className="btn onink" onClick={() => go("chamas", true)}>Start a chama</button>
              </div>
            </section>
            <div className="two">
              <div className="card stat"><div className="small">Owed to you</div><div className="fig">{fmt(owedToMe)}</div><div className="small">{ksh(owedToMe)}</div></div>
              <div className="card stat"><div className="small">You owe</div><div className="fig">{fmt(iOwe)}</div><div className="small">{ksh(iOwe)}</div></div>
            </div>
            <div className="card">
              <h3>Your Fungu link</h3>
              <p className="small">{myHandle ? <>Friends can find you as <b>@{myHandle}</b>, or open this link to lend to you directly.</> : "Send this to a friend who is lending you money. It opens Fungu with your details filled in."}</p>
              <div className="row">
                <button className="btn small" onClick={() => { navigator.clipboard.writeText(myLink); setMsg({ kind: "ok", text: "Link copied." }); }}>Copy link</button>
                <a className="btn ghost small" href={wa(`Hi, here's my Fungu link so we can keep our agreement clear: ${myLink}`)} target="_blank" rel="noreferrer">Share on WhatsApp</a>
              </div>
            </div>
            <div className="card">
              <h3>Recent</h3>
              {debts.length + chamas.length === 0 && <p className="empty">Nothing yet. Your agreements and chamas show up here.</p>}
              {debts.slice(0, 3).map((d) => <DebtRow key={d.address.toBase58()} d={d} me={me.publicKey} onOpen={() => { setTab("debts"); setFocus({ kind: "agreement", address: d.address.toBase58() }); }} />)}
              {chamas.slice(0, 2).map((c) => <ChamaRow key={c.address.toBase58()} c={c} onOpen={() => { setTab("chamas"); setFocus({ kind: "chama", address: c.address.toBase58() }); }} />)}
            </div>
          </div>
        )}

        {tab === "debts" && (focus?.kind === "agreement"
          ? <AgreementView address={focus.address} me={me} busy={busy} run={run} onBack={() => setFocus(null)} />
          : <Debts key={`d${startNew}`} startOpen={startNew > 0} me={me} debts={debts} busy={busy} run={run} prefill={prefill} onOpen={(a) => setFocus({ kind: "agreement", address: a })} />)}

        {tab === "chamas" && (focus?.kind === "chama"
          ? <ChamaView address={focus.address} me={me} busy={busy} run={run} onBack={() => setFocus(null)} />
          : <Chamas key={`c${startNew}`} startOpen={startNew > 0} me={me} chamas={chamas} busy={busy} run={run} onOpen={(a) => setFocus({ kind: "chama", address: a })} />)}

        {tab === "books" && (focus?.kind === "book"
          ? <BookView address={focus.address} me={me} busy={busy} run={run} onBack={() => setFocus(null)} />
          : <Books me={me} busy={busy} run={run} onOpen={(a) => setFocus({ kind: "book", address: a })} />)}

        {tab === "me" && <Me me={me} profile={profile} onLock={() => { setMe(null); setGate("lock"); }} />}
      </main>
    </>
  );
}

// ------------------------------------------------------------------ onboarding

function Onboarding({ onReady, onRestore }: { onReady: (k: Keypair, landing?: Tab) => void; onRestore: () => void }) {
  const [step, setStep] = useState<"why" | "name" | "pin" | "making" | "backup">("why");
  const [landing, setLanding] = useState<Tab>("debts");
  const [handle, setHandle] = useState("");
  const [avail, setAvail] = useState<"" | "checking" | "free" | "taken">("");
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState("");
  const [err, setErr] = useState("");
  const [kp, setKp] = useState<Keypair | null>(null);
  const onToken = useCallback((t: string | null) => setToken(t), []);
  const h = handle.toLowerCase().replace(/^@/, "");

  useEffect(() => {
    if (!NAME_RE.test(h)) { setAvail(""); return; }
    setAvail("checking");
    const t = setTimeout(() => ownerOfName(h).then((o) => setAvail(o ? "taken" : "free"), () => setAvail("")), 400);
    return () => clearTimeout(t);
  }, [h]);

  const make = async (pin: string) => {
    setStep("making"); setErr("");
    const k = createWallet();
    try {
      setState("Locking your wallet with your PIN…");
      await vault.create(k, pin);
      names.set(k.publicKey.toBase58(), "@" + h);
      setState("Adding 100 test dollars…");
      const f = await fetch("/api/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: k.publicKey.toBase58(), token }) }).then((r) => r.json());
      if (!f.ok) throw new Error(f.error);
      setState("Setting up your record…");
      await actions.initProfile(k);
      setState(`Claiming @${h}…`);
      await actions.registerName(k, h).catch(() => { throw new Error(`Someone just took @${h}. You can pick another name in Me.`); });
    } catch (e) { setErr((e as Error).message); }
    setKp(k); setStep("backup");
  };

  const order = ["why", "name", "pin", "backup"];
  const at = order.indexOf(step === "making" ? "pin" : step);
  return (
    <>
      <header className="top"><div className="wrap"><Logo /><nav className="nav"><a className="navlink" href="/">About Fungu</a></nav></div></header>
      <main className="app stack">
        <ol className="steps" aria-label={`Step ${at + 1} of 4`}>{["Start", "Name", "PIN", "Backup"].map((x, i) => <li key={x} className={i <= at ? "on" : ""}>{x}</li>)}</ol>
        {step === "why" && (
          <div className="card stack">
            <h1>What brings you to Fungu?</h1>
            <button className="choice" onClick={() => { setLanding("debts"); setStep("name"); }}><b>Lending to or borrowing from a friend</b><span>Write down what you agreed. Repay bit by bit.</span></button>
            <button className="choice" onClick={() => { setLanding("chamas"); setStep("name"); }}><b>Running a chama</b><span>Rounds, payouts and bonds nobody can fiddle with.</span></button>
            <button className="linkbtn" onClick={onRestore}>I already have Fungu on another phone</button>
          </div>
        )}
        {step === "name" && (
          <div className="card stack">
            <h1>Pick your Fungu name</h1>
            <p className="small">Friends send you agreements by this name instead of a long address. It&apos;s public and permanent.</p>
            <div className="field"><label htmlFor="hn">Fungu name</label>
              <div className="at"><span>@</span><input id="hn" value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20))} placeholder="wanjiru" autoCapitalize="none" autoComplete="username" /></div></div>
            <p className={`small ${avail === "taken" ? "bad" : avail === "free" ? "good" : ""}`} aria-live="polite">
              {!h ? "3–20 letters, numbers or _, starting with a letter." : !NAME_RE.test(h) ? "Use 3–20 lower-case letters, numbers or _, starting with a letter." : avail === "checking" ? "Checking…" : avail === "taken" ? `@${h} is taken.` : avail === "free" ? `@${h} is free.` : ""}
            </p>
            <Turnstile onToken={onToken} />
            <button className="btn" disabled={avail !== "free" || !token} onClick={() => setStep("pin")}>Continue</button>
          </div>
        )}
        {step === "pin" && <div className="card stack"><h1>Lock it with a PIN</h1><p className="small">Your wallet lives on this phone, encrypted with this PIN. Fungu never sees it.</p><NewPin onPin={make} /></div>}
        {step === "making" && <div className="card stack"><h1>Setting up</h1><p className="small" aria-live="polite">{state}</p></div>}
        {step === "backup" && kp && (
          <div className="card stack">
            <h1>Back it up before you hold money</h1>
            {err && <div className="notice err">{err}</div>}
            <BackupFlow me={kp} onDone={() => onReady(kp, landing)} />
            <button className="linkbtn" onClick={() => onReady(kp, landing)}>Skip for now (Me → Security later)</button>
          </div>
        )}
      </main>
    </>
  );
}

// ------------------------------------------------------------------ debts

const statusLabel = (d: any, me: PublicKey) => {
  if (d.status === "proposed") return d.borrower.equals(me) ? "Waiting for you" : "Waiting to be accepted";
  if (d.status === "active") return d.overdue || Date.now() / 1000 > d.dueTs.toNumber() ? "Past due date" : `Due ${dateOf(d.dueTs)}`;
  return { settled: "Settled", cancelled: "Cancelled", forgiven: "Forgiven" }[d.status as string] || d.status;
};

function DebtRow({ d, me, onOpen }: { d: any; me: PublicKey; onOpen: () => void }) {
  const lending = d.lender.equals(me);
  const who = lending ? d.borrower : d.lender;
  const progress = d.repaid.toNumber() / d.principal.toNumber();
  const late = d.status === "active" && (d.overdue || Date.now() / 1000 > d.dueTs.toNumber());
  return (
    <div className="item" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()} style={{ cursor: "pointer" }}>
      <Ring value={progress} size={38} stroke={5} />
      <div className="grow">
        <strong>{lending ? `${nameOf(who)} owes you` : d.guarantor?.equals?.(me) ? `You guarantee ${nameOf(d.borrower)}` : `You owe ${nameOf(who)}`}</strong>
        <div className="small">{fmt(d.repaid)} of {fmt(d.principal)} fUSD paid</div>
      </div>
      <span className={`pill ${d.status === "settled" ? "settled" : d.status === "proposed" ? "proposed" : late ? "late" : ""}`}>{statusLabel(d, me)}</span>
    </div>
  );
}

function Debts({ me, debts, busy, run, prefill, onOpen, startOpen }: { me: Keypair; debts: any[]; busy: boolean; run: any; prefill: { to?: string; name?: string }; onOpen: (a: string) => void; startOpen?: boolean }) {
  const [to, setTo] = useState(prefill.to || "");
  const [who, setWho] = useState(prefill.name || "");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [due, setDue] = useState(() => new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
  const [guarantor, setGuarantor] = useState("");
  const [created, setCreated] = useState<{ link: string; text: string } | null>(null);
  const [open, setOpen] = useState(!!prefill.to || !!startOpen);

  const submit = async () => {
    const borrower = await toKey(to);
    if (!borrower) return alert(to.trim().startsWith("@") ? `Nobody has the name ${to.trim()} yet.` : "That Fungu name, link or address isn't valid.");
    if (borrower.equals(me.publicKey)) return alert("You can't lend to yourself.");
    const g = guarantor.trim() ? await toKey(guarantor) : null;
    if (guarantor.trim() && !g) return alert("The guarantor's link or address isn't valid.");
    if (who.trim()) names.set(borrower.toBase58(), who.trim());
    const amt = Number(amount);
    const dueTs = Math.floor(new Date(due + "T20:59:59Z").getTime() / 1000); // end of the day in Nairobi (UTC+3)
    const myName = names.get()[me.publicKey.toBase58()] || "the lender";
    const terms = [
      "Fungu agreement",
      `Lender: ${myName} (${me.publicKey.toBase58()})`,
      `Borrower: ${who.trim() || "borrower"} (${borrower.toBase58()})`,
      `Amount: ${amt} fUSD`,
      `Purpose: ${purpose.trim()}`,
      `Due: ${due} (end of day, Nairobi time)`,
      g ? `Guarantor: ${g.toBase58()}` : "Guarantor: none",
      "Repay in parts at any time. No interest. No penalties.",
    ].join("\n");
    const r = await run("Creating the agreement", () => actions.createAgreement(me, borrower, amt, dueTs, terms, g));
    if (r) {
      const link = `${origin()}/app?a=${r.agreement.toBase58()}&t=${b64u.enc(terms)}`;
      setCreated({ link, text: `Hi ${who.trim() || ""}, I've put our agreement on Fungu: ${amt} fUSD for ${purpose.trim()}, due ${due}. Please open it and accept: ${link}` });
      setAmount(""); setPurpose(""); setGuarantor("");
    }
  };

  return (
    <div className="stack">
      {created && (
        <div className="card stack">
          <h3>Send this to your friend</h3>
          <p className="small">They open it, read the exact terms and accept. Nothing moves until they do.</p>
          <div className="row">
            <a className="btn small" href={wa(created.text)} target="_blank" rel="noreferrer">Send on WhatsApp</a>
            <button className="btn ghost small" onClick={() => navigator.clipboard.writeText(created.link)}>Copy link</button>
          </div>
        </div>
      )}
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Lend to a friend</h3>
          <button className="btn small ghost" onClick={() => setOpen(!open)}>{open ? "Close" : "Start"}</button>
        </div>
        {open && (
          <div style={{ marginTop: 16 }}>
            <div className="field"><label>Friend&apos;s @name or Fungu link</label><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="@otieno, or paste their link" autoCapitalize="none" /></div>
            <div className="two">
              <div className="field"><label>Their name</label><input value={who} onChange={(e) => setWho(e.target.value)} placeholder="e.g. Otieno" maxLength={24} /></div>
              <div className="field"><label>Amount (fUSD)</label><input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            </div>
            <div className="field"><label>What it&apos;s for</label><input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. rent for December" maxLength={80} /></div>
            <div className="field"><label>Pay back by</label><input type="date" value={due} min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)} onChange={(e) => setDue(e.target.value)} /></div>
            <div className="field"><label>Guarantor (optional): their @name or Fungu link</label><input value={guarantor} onChange={(e) => setGuarantor(e.target.value)} /></div>
            <div className="notice" style={{ marginBottom: 14 }}>
              <strong>Before you lend:</strong> can you afford to wait if it comes back late? Have you agreed what happens if it can&apos;t be repaid on time? Lend only what you could live without.
            </div>
            <button className="btn" disabled={busy || !to || !(Number(amount) > 0) || !purpose.trim()} onClick={submit}>Create agreement</button>
          </div>
        )}
      </div>
      <div className="card">
        <h3>Your debts</h3>
        {debts.length === 0 && <p className="empty">No agreements yet. When you lend or borrow, it shows up here with its progress ring.</p>}
        {debts.map((d) => <DebtRow key={d.address.toBase58()} d={d} me={me.publicKey} onOpen={() => onOpen(d.address.toBase58())} />)}
      </div>
    </div>
  );
}

function AgreementView({ address, me, busy, run, onBack }: { address: string; me: Keypair; busy: boolean; run: any; onBack: () => void }) {
  const [a, setA] = useState<any>(null);
  const [terms, setTerms] = useState<string | null>(null);
  const [termsOk, setTermsOk] = useState<boolean | null>(null);
  const [amount, setAmount] = useState("");
  const [receipt, setReceipt] = useState("");
  const [missing, setMissing] = useState(false);
  const key = useMemo(() => { try { return new PublicKey(address); } catch { return null; } }, [address]);

  const load = useCallback(async () => {
    if (!key) return setMissing(true);
    const x = await fetchAgreement(key);
    if (!x) return setMissing(true);
    setA(x);
    const t = termsStore.get()[address] ?? null;
    setTerms(t);
    if (t) setTermsOk(JSON.stringify(await sha256(t)) === JSON.stringify(Array.from(x.termsHash)));
  }, [key, address]);
  useEffect(() => { load(); }, [load]);

  if (missing) return <div className="card"><p>This agreement wasn&apos;t found on Solana.</p><button className="btn ghost small" onClick={onBack}>Back</button></div>;
  if (!a) return <p className="small">Loading agreement…</p>;

  const mk = me.publicKey;
  const isLender = a.lender.equals(mk), isBorrower = a.borrower.equals(mk), isGuarantor = a.guarantor?.equals?.(mk);
  const left = (a.principal.toNumber() - a.repaid.toNumber()) / UNIT;
  const due = a.dueTs.toNumber();
  const act = (label: string, fn: () => Promise<string>) => run(label, fn).then(load);

  return (
    <div className="stack">
      <button className="btn ghost small" onClick={onBack}>← All debts</button>
      <div className="card stack">
        <div className="item">
          <Ring value={a.repaid.toNumber() / a.principal.toNumber()} size={56} stroke={7} />
          <div className="grow">
            <h3 style={{ margin: 0 }}>{fmt(a.principal)} fUSD</h3>
            <div className="small">{nameOf(a.lender, mk)} → {nameOf(a.borrower, mk)} · due {dateOf(due)}</div>
          </div>
          <span className={`pill ${a.status}`}>{statusLabel(a, mk)}</span>
        </div>
        <div className="small">Paid {fmt(a.repaid)} · left {fmt(left)} · {a.funded ? "sent on Fungu" : a.status === "proposed" ? "not sent yet" : "money given outside Fungu"}{a.guarantor ? ` · guarantor ${nameOf(a.guarantor, mk)} ${a.guarantorSigned ? "has signed" : "hasn't signed yet"}` : ""}</div>
        {terms ? (
          <>
            <div className="terms">{terms}</div>
            <div className={`notice ${termsOk ? "ok" : "err"}`}>{termsOk ? "These are exactly the terms sealed on Solana." : "These terms don't match what's sealed on Solana. Don't accept."}</div>
          </>
        ) : <div className="notice">The full wording isn&apos;t on this device. Ask the lender to open this agreement in Fungu and tap &ldquo;Send on WhatsApp&rdquo;, then open the link they send.</div>}
        <a className="small" href={explorer("address", address)} target="_blank" rel="noreferrer">View on Solana ↗</a>
      </div>

      {a.status === "proposed" && isBorrower && terms && termsOk && (
        <div className="card stack"><h3>Accept these terms?</h3><p className="small">You agree to repay {fmt(a.principal)} fUSD by {dateOf(due)}. You can pay in parts.</p>
          <button className="btn" disabled={busy} onClick={() => act("Accepting", () => actions.accept(me, key!, terms))}>I accept</button></div>
      )}
      {isGuarantor && !a.guarantorSigned && (a.status === "proposed" || a.status === "active") && terms && termsOk && (
        <div className="card stack"><h3>Guarantee this debt?</h3><p className="small">You&apos;re vouching for {nameOf(a.borrower, mk)}. No money moves from you automatically.</p>
          <button className="btn" disabled={busy} onClick={() => act("Signing as guarantor", () => actions.cosign(me, key!, terms))}>I&apos;ll guarantee it</button></div>
      )}
      {a.status === "proposed" && isLender && (
        <div className="card stack">
          <h3>Send the agreement to {nameOf(a.borrower, mk)}</h3>
          {terms ? (() => {
            const link = `${origin()}/app?a=${address}&t=${b64u.enc(terms)}`;
            return (<>
              <p className="small">They open this link, read the exact terms and accept. {a.guarantor ? "Send the same link to the guarantor." : ""}</p>
              <div className="row">
                <a className="btn small" href={wa(`Hi, I've put our agreement on Fungu: ${fmt(a.principal)} fUSD, due ${dateOf(due)}. Please open it and accept: ${link}`)} target="_blank" rel="noreferrer">Send on WhatsApp</a>
                <button className="btn ghost small" onClick={() => navigator.clipboard.writeText(link)}>Copy link</button>
              </div>
            </>);
          })() : <p className="small">The terms were written on another device. Open this agreement there to share it.</p>}
          <button className="btn ghost small" disabled={busy} onClick={() => act("Cancelling", () => actions.cancel(me, key!))}>Cancel this proposal</button>
        </div>
      )}

      {a.status === "active" && isLender && (
        <div className="card stack">
          {!a.funded && <><h3>Send the money</h3><p className="small">Send {fmt(a.principal)} fUSD straight to {nameOf(a.borrower, mk)}&apos;s wallet. Skip this if you gave it another way.</p>
            <button className="btn" disabled={busy} onClick={() => act("Sending", () => actions.fund(me, a))}>Send {fmt(a.principal)} fUSD</button></>}
          <h3>Paid you another way?</h3>
          <p className="small">Record cash or mobile-money repayments. Only you can confirm these.</p>
          <div className="two">
            <div className="field"><label>Amount</label><input type="number" min="0.01" max={left} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            <div className="field"><label>Receipt code (kept private)</label><input value={receipt} onChange={(e) => setReceipt(e.target.value)} placeholder="e.g. SKL3XY..." /></div>
          </div>
          <button className="btn ghost" disabled={busy || !(Number(amount) > 0) || Number(amount) > left} onClick={() => act("Recording the repayment", () => actions.confirmOffchain(me, a, Number(amount), receipt || "cash")).then(() => { setAmount(""); setReceipt(""); })}>Confirm I received it</button>
          <div className="row">
            {Date.now() / 1000 > due && !a.overdue && <button className="btn ghost small" disabled={busy} onClick={() => act("Marking as past due", () => actions.markOverdue(me, key!))}>Mark past due</button>}
            <button className="btn ghost small" disabled={busy} onClick={() => confirm("Forgive the rest? This can't be undone.") && act("Forgiving", () => actions.forgive(me, key!))}>Forgive the rest</button>
          </div>
        </div>
      )}
      {a.status === "active" && isBorrower && (
        <div className="card stack"><h3>Repay</h3><p className="small">Pay any part of the {fmt(left)} fUSD left, straight to {nameOf(a.lender, mk)}.</p>
          <div className="row">
            <input type="number" min="0.01" max={left} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ maxWidth: 160 }} />
            <button className="btn ghost small" onClick={() => setAmount(String(left))}>All of it</button>
          </div>
          <button className="btn" disabled={busy || !(Number(amount) > 0) || Number(amount) > left} onClick={() => act("Repaying", () => actions.repay(me, a, Number(amount))).then(() => setAmount(""))}>Pay {amount || ""} fUSD</button>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ chamas

function ChamaRow({ c, onOpen }: { c: any; onOpen: () => void }) {
  const n = c.members.length;
  return (
    <div className="item" role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === "Enter" && onOpen()} style={{ cursor: "pointer" }}>
      <Ring value={c.status === "completed" ? 1 : c.status === "forming" ? n / c.maxMembers : c.round / n} size={38} stroke={5} />
      <div className="grow"><strong>{c.name}</strong><div className="small">{fmt(c.contribution)} fUSD a round · {n}/{c.maxMembers} members</div></div>
      <span className={`pill ${c.status === "completed" ? "settled" : c.status === "forming" ? "proposed" : ""}`}>{c.status === "forming" ? "Gathering members" : c.status === "active" ? `Round ${c.round + 1} of ${n}` : "Completed"}</span>
    </div>
  );
}

function Chamas({ me, chamas, busy, run, onOpen, startOpen }: { me: Keypair; chamas: any[]; busy: boolean; run: any; onOpen: (a: string) => void; startOpen?: boolean }) {
  const [open, setOpen] = useState(!!startOpen);
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("10");
  const [members, setMembers] = useState("3");
  const [period, setPeriod] = useState("604800");
  const [bond, setBond] = useState("10");
  const submit = async () => {
    const r = await run("Creating the chama", () => actions.createChama(me, name.trim(), Number(amount), Number(period), Number(members), Number(bond)));
    if (r) {
      await run("Joining as the first member", () => actions.memberIx("joinChama", me, r.chama));
      onOpen(r.chama.toBase58());
    }
  };
  return (
    <div className="stack">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0 }}>Start a chama</h3><button className="btn small ghost" onClick={() => setOpen(!open)}>{open ? "Close" : "Start"}</button></div>
        {open && (
          <div style={{ marginTop: 16 }}>
            <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="e.g. Wamama wa Kahawa" /></div>
            <div className="two">
              <div className="field"><label>Contribution per round (fUSD)</label><input type="number" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
              <div className="field"><label>Members (2–12)</label><input type="number" min="2" max="12" value={members} onChange={(e) => setMembers(e.target.value)} /></div>
            </div>
            <div className="two">
              <div className="field"><label>Round length</label>
                <select value={period} onChange={(e) => setPeriod(e.target.value)}>
                  <option value="120">2 minutes (demo)</option><option value="86400">1 day</option><option value="604800">1 week</option><option value="2592000">30 days</option>
                </select></div>
              <div className="field"><label>Bond per member (fUSD)</label><input type="number" min="0" value={bond} onChange={(e) => setBond(e.target.value)} /></div>
            </div>
            <p className="small">The bond is refunded at the end. It covers a member who stops paying after getting their payout.</p>
            <button className="btn" disabled={busy || !name.trim() || !(Number(amount) > 0) || Number(members) < 2 || Number(members) > 12} onClick={submit}>Create chama</button>
          </div>
        )}
      </div>
      <div className="card">
        <h3>Your chamas</h3>
        {chamas.length === 0 && <p className="empty">No chamas yet. Start one above, or open an invite link a member sent you.</p>}
        {chamas.map((c) => <ChamaRow key={c.address.toBase58()} c={c} onOpen={() => onOpen(c.address.toBase58())} />)}
      </div>
    </div>
  );
}

function ChamaView({ address, me, busy, run, onBack }: { address: string; me: Keypair; busy: boolean; run: any; onBack: () => void }) {
  const [c, setC] = useState<any>(null);
  const [missing, setMissing] = useState(false);
  const [now, setNow] = useState(Date.now() / 1000);
  const key = useMemo(() => { try { return new PublicKey(address); } catch { return null; } }, [address]);
  const load = useCallback(async () => {
    if (!key) return setMissing(true);
    const x = await fetchChama(key);
    if (!x) return setMissing(true);
    setC(x);
  }, [key]);
  useEffect(() => { load(); const t = setInterval(() => setNow(Date.now() / 1000), 1000); return () => clearInterval(t); }, [load]);

  if (missing) return <div className="card"><p>This chama wasn&apos;t found on Solana.</p><button className="btn ghost small" onClick={onBack}>Back</button></div>;
  if (!c) return <p className="small">Loading chama…</p>;

  const mk = me.publicKey;
  const n = c.members.length;
  const idx = c.members.findIndex((m: PublicKey) => m.equals(mk));
  const member = idx >= 0;
  const paid = (i: number) => (c.paidMask & (1 << i)) !== 0;
  const allPaid = c.status === "active" && Array.from({ length: n }, (_, i) => paid(i)).every(Boolean);
  const ends = c.roundStart.toNumber() + c.periodSecs.toNumber();
  const canPayout = c.status === "active" && (allPaid || now >= ends);
  const recipient = c.status === "active" ? c.members[c.round] : null;
  const invite = `${origin()}/app?c=${address}`;
  const act = (label: string, fn: () => Promise<string>) => run(label, fn).then(load);
  const left = Math.max(0, Math.round(ends - now));

  return (
    <div className="stack">
      <button className="btn ghost small" onClick={onBack}>← All chamas</button>
      <div className="card stack">
        <div className="item">
          <Ring value={c.status === "completed" ? 1 : c.status === "forming" ? n / c.maxMembers : c.round / n} size={56} stroke={7} />
          <div className="grow"><h3 style={{ margin: 0 }}>{c.name}</h3><div className="small">{fmt(c.contribution)} fUSD a round · bond {fmt(c.bond)} · pot {fmt(c.contribution.toNumber() * n / UNIT)}</div></div>
        </div>
        {c.status === "forming" && <div className="notice">Gathering members: {n} of {c.maxMembers}. Round 1 starts when the chama is full.</div>}
        {c.status === "active" && <div className="notice">Round {c.round + 1} of {n}: the pot goes to <strong>{nameOf(recipient, mk)}</strong>. {allPaid ? "Everyone has paid." : left > 0 ? `Round ends in ${left > 86400 ? Math.ceil(left / 86400) + " days" : left > 3600 ? Math.ceil(left / 3600) + " hours" : left + " seconds"}.` : "Time is up: the pot can be paid out; anyone who missed is covered from their bond."}</div>}
        {c.status === "completed" && <div className="notice ok">All {n} rounds done. Members can take back their bonds.</div>}
        <div>
          {c.members.map((m: PublicKey, i: number) => (
            <div className="item" key={m.toBase58()}>
              <span className="pill">{i + 1}</span>
              <div className="grow">{nameOf(m, mk)}{c.defaults[i] > 0 ? <span className="small"> · missed {c.defaults[i]}</span> : null}</div>
              <span className="small">{c.status === "active" ? (i < c.round ? "paid out ✓" : paid(i) ? "paid this round" : "not yet paid") : c.status === "completed" ? (c.bonds[i].toString() === "18446744073709551615" ? "bond returned" : `bond ${fmt(c.bonds[i])}`) : "joined"}</span>
            </div>
          ))}
        </div>
        <a className="small" href={explorer("address", address)} target="_blank" rel="noreferrer">View on Solana ↗</a>
      </div>

      {c.status === "forming" && (
        <div className="card stack">
          {!member ? <><h3>Join this chama</h3><p className="small">You&apos;ll stake a {fmt(c.bond)} fUSD bond, refunded at the end, and pay {fmt(c.contribution)} fUSD each round. Your turn is #{n + 1}.</p>
            <button className="btn" disabled={busy} onClick={() => act("Joining", () => actions.memberIx("joinChama", me, key!))}>Join and stake {fmt(c.bond)} fUSD</button></>
            : <button className="btn ghost" disabled={busy} onClick={() => act("Leaving", () => actions.memberIx("leaveChama", me, key!))}>Leave and get my bond back</button>}
          <div className="row">
            <a className="btn ghost small" href={wa(`Join our chama "${c.name}" on Fungu: ${fmt(c.contribution)} fUSD a round, ${c.maxMembers} members. ${invite}`)} target="_blank" rel="noreferrer">Invite on WhatsApp</a>
            <button className="btn ghost small" onClick={() => navigator.clipboard.writeText(invite)}>Copy invite link</button>
          </div>
        </div>
      )}
      {c.status === "active" && (
        <div className="card stack">
          {member && !paid(idx) && <button className="btn" disabled={busy} onClick={() => act("Contributing", () => actions.memberIx("contribute", me, key!))}>Pay my {fmt(c.contribution)} fUSD</button>}
          <button className="btn ghost" disabled={busy || !canPayout} onClick={() => act("Paying out", () => actions.payout(me, key!, recipient))}>Pay the pot to {nameOf(recipient, mk)}</button>
        </div>
      )}
      {c.status === "completed" && member && c.bonds[idx].toString() !== "18446744073709551615" && (
        <button className="btn" disabled={busy} onClick={() => act("Taking back my bond", () => actions.withdrawBond(me, key!))}>Take back my bond ({fmt(c.bonds[idx])} fUSD)</button>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ me

function Me({ me, profile, onLock }: { me: Keypair; profile: any; onLock: () => void }) {
  const [err, setErr] = useState("");
  const [handle, setHandle] = useState<string | null | undefined>(undefined);
  const [want, setWant] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { handleOf(me.publicKey).then(setHandle); }, [me]);
  const claim = async () => {
    setErr("");
    const n = want.toLowerCase().replace(/^@/, "");
    if (!NAME_RE.test(n)) return setErr("Use 3–20 lower-case letters, numbers or _, starting with a letter.");
    setBusy(true);
    try {
      if (await ownerOfName(n)) throw new Error(`@${n} is taken.`);
      await actions.registerName(me, n); names.set(me.publicKey.toBase58(), "@" + n); setHandle(n);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="stack">
      <div className="card stack">
        <h3>{handle ? `@${handle}` : "Your Fungu name"}</h3>
        {handle === null && (<>
          <p className="small">Claim a name so friends can find you without your address.</p>
          <div className="at"><span>@</span><input aria-label="Fungu name" value={want} onChange={(e) => setWant(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20))} placeholder="wanjiru" autoCapitalize="none" /></div>
          <button className="btn small" onClick={claim} disabled={!want || busy}>{busy ? "Claiming…" : "Claim it"}</button>
        </>)}
        {handle && <p className="small">Friends can lend to you by typing <b>@{handle}</b>.</p>}
        {err && <div className="notice err">{err}</div>}
      </div>
      <div className="card stack">
        <h3>Your record</h3>
        {profile ? (
          <div className="two">
            <div><div className="amt" style={{ fontFamily: "var(--display)", fontSize: 28 }}>{profile.settled}</div><div className="small">debts settled ({profile.onTime} on time, {profile.late} late)</div></div>
            <div><div className="amt" style={{ fontFamily: "var(--display)", fontSize: 28 }}>{profile.chamaCycles}</div><div className="small">chama cycles completed ({profile.chamaMissed} rounds missed)</div></div>
          </div>
        ) : (
          <><p className="small">Your record isn&apos;t set up yet.</p><button className="btn small" onClick={() => actions.initProfile(me).then(() => location.reload(), (e) => setErr(e.message))}>Set it up</button></>
        )}
        <p className="small">This is public and simple on purpose. It isn&apos;t a credit score.</p>
      </div>
      <SecurityCard me={me} onLock={onLock} />
      <div className="card stack">
        <h3>Your wallet address</h3>
        <div className="mono">{me.publicKey.toBase58()}</div>
        <a className="small" href={explorer("address", me.publicKey.toBase58())} target="_blank" rel="noreferrer">View on Solana ↗</a>
        <p className="small">Short: {short(me.publicKey)}</p>
      </div>
    </div>
  );
}
