"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";
import { Logo, Ring } from "./Brand";
import { Turnstile } from "./Turnstile";
import {
  actions, balance, createWallet, exportWallet, fetchAgreement, fetchAgreements, fetchChama, fetchChamas, fetchProfile,
  fmt, importWallet, loadWallet, nameOf, names, sha256, short, termsStore,
} from "@/lib/fungu";
import { explorer, UNIT } from "@/lib/config";

type Tab = "home" | "debts" | "chamas" | "me";
type Msg = { kind: "ok" | "err" | "info"; text: string; sig?: string } | null;

const b64u = {
  enc: (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
  dec: (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))),
};
const origin = () => window.location.origin;
const wa = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;
const toKey = (s: string): PublicKey | null => {
  try {
    const m = s.match(/[?&]to=([1-9A-HJ-NP-Za-km-z]{32,44})/);
    return new PublicKey((m ? m[1] : s).trim());
  } catch { return null; }
};
const dateOf = (ts: any) => new Date(Number(ts) * 1000).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });

export default function FunguApp() {
  const [me, setMe] = useState<Keypair | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("home");
  const [msg, setMsg] = useState<Msg>(null);
  const [busy, setBusy] = useState(false);
  const [bal, setBal] = useState(0);
  const [debts, setDebts] = useState<any[]>([]);
  const [chamas, setChamas] = useState<any[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [focus, setFocus] = useState<{ kind: "agreement" | "chama"; address: string } | null>(null);
  const [prefill, setPrefill] = useState<{ to?: string; name?: string }>({});

  useEffect(() => {
    setMe(loadWallet());
    const q = new URLSearchParams(window.location.search);
    const to = q.get("to"), n = q.get("n"), a = q.get("a"), t = q.get("t"), c = q.get("c");
    if (to) { setPrefill({ to, name: n || "" }); if (n) names.set(to, n); setTab("debts"); }
    if (a) { if (t) { try { termsStore.set(a, b64u.dec(t)); } catch { /* ignore */ } } setFocus({ kind: "agreement", address: a }); setTab("debts"); }
    if (c) { setFocus({ kind: "chama", address: c }); setTab("chamas"); }
    setReady(true);
  }, []);

  const refresh = useCallback(async () => {
    if (!me) return;
    const [b, d, c, p] = await Promise.all([balance(me.publicKey), fetchAgreements(me.publicKey).catch(() => []), fetchChamas(me.publicKey).catch(() => []), fetchProfile(me.publicKey).catch(() => null)]);
    setBal(b); setDebts(d); setChamas(c); setProfile(p);
  }, [me]);
  useEffect(() => { refresh(); }, [refresh]);

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
  if (!me) return <Onboarding onReady={(k) => { setMe(k); }} />;

  const owedToMe = debts.filter((d) => d.lender.equals(me.publicKey) && d.status === "active").reduce((s, d) => s + (d.principal.toNumber() - d.repaid.toNumber()), 0) / UNIT;
  const iOwe = debts.filter((d) => d.borrower.equals(me.publicKey) && d.status === "active").reduce((s, d) => s + (d.principal.toNumber() - d.repaid.toNumber()), 0) / UNIT;
  const myLink = `${origin()}/app?to=${me.publicKey.toBase58()}&n=${encodeURIComponent(names.get()[me.publicKey.toBase58()] || "")}`;

  return (
    <>
      <header className="top"><div className="wrap"><Logo /><nav className="nav"><a className="small" href="/">About Fungu</a></nav></div></header>
      <main className="app">
        <div className="tabs" role="tablist">
          {(["home", "debts", "chamas", "me"] as Tab[]).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => { setTab(t); setFocus(null); }}>{{ home: "Home", debts: "Debts", chamas: "Chamas", me: "Me" }[t]}</button>
          ))}
        </div>

        {msg && (
          <div className={`notice ${msg.kind === "err" ? "err" : msg.kind === "ok" ? "ok" : ""}`} style={{ marginBottom: 16 }}>
            {msg.text} {msg.sig && <a href={explorer("tx", msg.sig)} target="_blank" rel="noreferrer">View on Solana ↗</a>}
          </div>
        )}

        {tab === "home" && (
          <div className="stack">
            <div className="card balance">
              <div><div className="small">Your balance</div><div className="amt">{fmt(bal)} <span className="small">fUSD</span></div></div>
              <button className="btn ghost small" onClick={refresh} disabled={busy}>Refresh</button>
            </div>
            <div className="two">
              <div className="card"><div className="small">Owed to you</div><div className="amt" style={{ fontSize: 24, fontFamily: "var(--display)" }}>{fmt(owedToMe)}</div></div>
              <div className="card"><div className="small">You owe</div><div className="amt" style={{ fontSize: 24, fontFamily: "var(--display)" }}>{fmt(iOwe)}</div></div>
            </div>
            <div className="card">
              <h3>Your Fungu link</h3>
              <p className="small">Send this to a friend who is lending you money. It opens Fungu with your details filled in.</p>
              <div className="row">
                <button className="btn small" onClick={() => { navigator.clipboard.writeText(myLink); setMsg({ kind: "ok", text: "Link copied." }); }}>Copy link</button>
                <a className="btn ghost small" href={wa(`Hi, here's my Fungu link so we can keep our agreement clear: ${myLink}`)} target="_blank" rel="noreferrer">Share on WhatsApp</a>
              </div>
            </div>
            <div className="card">
              <h3>Recent</h3>
              {debts.length + chamas.length === 0 && <p className="empty">Nothing yet. Start a debt or a chama.</p>}
              {debts.slice(0, 3).map((d) => <DebtRow key={d.address.toBase58()} d={d} me={me.publicKey} onOpen={() => { setTab("debts"); setFocus({ kind: "agreement", address: d.address.toBase58() }); }} />)}
              {chamas.slice(0, 2).map((c) => <ChamaRow key={c.address.toBase58()} c={c} onOpen={() => { setTab("chamas"); setFocus({ kind: "chama", address: c.address.toBase58() }); }} />)}
            </div>
          </div>
        )}

        {tab === "debts" && (focus?.kind === "agreement"
          ? <AgreementView address={focus.address} me={me} busy={busy} run={run} onBack={() => setFocus(null)} />
          : <Debts me={me} debts={debts} busy={busy} run={run} prefill={prefill} onOpen={(a) => setFocus({ kind: "agreement", address: a })} />)}

        {tab === "chamas" && (focus?.kind === "chama"
          ? <ChamaView address={focus.address} me={me} busy={busy} run={run} onBack={() => setFocus(null)} />
          : <Chamas me={me} chamas={chamas} busy={busy} run={run} onOpen={(a) => setFocus({ kind: "chama", address: a })} />)}

        {tab === "me" && <Me me={me} profile={profile} />}
      </main>
    </>
  );
}

// ------------------------------------------------------------------ onboarding

function Onboarding({ onReady }: { onReady: (k: Keypair) => void }) {
  const [name, setName] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<string>("");
  const [err, setErr] = useState("");
  const [restore, setRestore] = useState("");
  const onToken = useCallback((t: string | null) => setToken(t), []);

  const start = async () => {
    setErr("");
    const k = createWallet();
    names.set(k.publicKey.toBase58(), name.trim());
    try {
      setState("Creating your wallet on this phone…");
      setState("Adding 100 test dollars…");
      const f = await fetch("/api/faucet", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ owner: k.publicKey.toBase58(), token }) }).then((r) => r.json());
      if (!f.ok) throw new Error(f.error);
      setState("Setting up your record…");
      await actions.initProfile(k);
      onReady(k);
    } catch (e) {
      setErr((e as Error).message);
      setState("");
      onReady(k); // the wallet exists; the record can be set up later from "Me"
    }
  };

  return (
    <>
      <header className="top"><div className="wrap"><Logo /><nav className="nav"><a className="small" href="/">About Fungu</a></nav></div></header>
      <main className="app stack">
        <div className="card stack">
          <h2 style={{ fontSize: 28 }}>Welcome to Fungu</h2>
          <p className="small">Your wallet is created on this device and only you hold its key. Fungu pays the network fees. This is a test version on Solana devnet with free test dollars (fUSD).</p>
          <div className="field"><label htmlFor="nm">Your first name (saved on this device only)</label><input id="nm" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wanjiru" maxLength={24} /></div>
          <Turnstile onToken={onToken} />
          <button className="btn" disabled={!name.trim() || !token || !!state} onClick={start}>{state || "Create my wallet"}</button>
          {err && <div className="notice err">{err}</div>}
        </div>
        <details className="card">
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Restore a wallet from a backup</summary>
          <div className="stack" style={{ marginTop: 12 }}>
            <textarea rows={3} value={restore} onChange={(e) => setRestore(e.target.value)} placeholder="Paste your backup key" />
            <button className="btn ghost small" onClick={() => { try { onReady(importWallet(restore)); } catch { setErr("That backup key isn't valid."); } }}>Restore</button>
          </div>
        </details>
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

function Debts({ me, debts, busy, run, prefill, onOpen }: { me: Keypair; debts: any[]; busy: boolean; run: any; prefill: { to?: string; name?: string }; onOpen: (a: string) => void }) {
  const [to, setTo] = useState(prefill.to || "");
  const [who, setWho] = useState(prefill.name || "");
  const [amount, setAmount] = useState("");
  const [purpose, setPurpose] = useState("");
  const [due, setDue] = useState(() => new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
  const [guarantor, setGuarantor] = useState("");
  const [created, setCreated] = useState<{ link: string; text: string } | null>(null);
  const [open, setOpen] = useState(!!prefill.to);

  const submit = async () => {
    const borrower = toKey(to);
    if (!borrower) return alert("That Fungu link or address isn't valid.");
    if (borrower.equals(me.publicKey)) return alert("You can't lend to yourself.");
    const g = guarantor.trim() ? toKey(guarantor) : null;
    if (guarantor.trim() && !g) return alert("The guarantor's link or address isn't valid.");
    if (who.trim()) names.set(borrower.toBase58(), who.trim());
    const amt = Number(amount);
    const dueTs = Math.floor(new Date(due + "T21:00:00Z").getTime() / 1000); // end of the day in Nairobi (UTC+3)
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
            <div className="field"><label>Friend&apos;s Fungu link or address</label><input value={to} onChange={(e) => setTo(e.target.value)} placeholder="Paste the link they sent you" /></div>
            <div className="two">
              <div className="field"><label>Their name</label><input value={who} onChange={(e) => setWho(e.target.value)} placeholder="e.g. Otieno" maxLength={24} /></div>
              <div className="field"><label>Amount (fUSD)</label><input type="number" min="0.01" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
            </div>
            <div className="field"><label>What it&apos;s for</label><input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. rent for December" maxLength={80} /></div>
            <div className="field"><label>Pay back by</label><input type="date" value={due} min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)} onChange={(e) => setDue(e.target.value)} /></div>
            <div className="field"><label>Guarantor (optional): their Fungu link or address</label><input value={guarantor} onChange={(e) => setGuarantor(e.target.value)} /></div>
            <div className="notice" style={{ marginBottom: 14 }}>
              <strong>Before you lend:</strong> can you afford to wait if it comes back late? Have you agreed what happens if it can&apos;t be repaid on time? Lend only what you could live without.
            </div>
            <button className="btn" disabled={busy || !to || !(Number(amount) > 0) || !purpose.trim()} onClick={submit}>Create agreement</button>
          </div>
        )}
      </div>
      <div className="card">
        <h3>Your debts</h3>
        {debts.length === 0 && <p className="empty">No debts yet.</p>}
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
        <div className="small">Paid {fmt(a.repaid)} · left {fmt(left)} · {a.funded ? "sent on Fungu" : "money given outside Fungu or not yet sent"}{a.guarantor ? ` · guarantor ${nameOf(a.guarantor, mk)} ${a.guarantorSigned ? "has signed" : "hasn't signed yet"}` : ""}</div>
        {terms ? (
          <>
            <div className="terms">{terms}</div>
            <div className={`notice ${termsOk ? "ok" : "err"}`}>{termsOk ? "These are exactly the terms sealed on Solana." : "These terms don't match what's sealed on Solana. Don't accept."}</div>
          </>
        ) : <div className="notice">The full wording isn&apos;t on this device. Ask the lender for the agreement link.</div>}
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
      {a.status === "proposed" && isLender && <button className="btn ghost" disabled={busy} onClick={() => act("Cancelling", () => actions.cancel(me, key!))}>Cancel this proposal</button>}

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

function Chamas({ me, chamas, busy, run, onOpen }: { me: Keypair; chamas: any[]; busy: boolean; run: any; onOpen: (a: string) => void }) {
  const [open, setOpen] = useState(false);
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
        {chamas.length === 0 && <p className="empty">No chamas yet. Start one, or open an invite link.</p>}
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

function Me({ me, profile }: { me: Keypair; profile: any }) {
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [name, setName] = useState(names.get()[me.publicKey.toBase58()] || "");
  return (
    <div className="stack">
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
        {err && <div className="notice err">{err}</div>}
      </div>
      <div className="card stack">
        <h3>Your wallet</h3>
        <div className="field"><label>Your name on this device</label><input value={name} onChange={(e) => { setName(e.target.value); names.set(me.publicKey.toBase58(), e.target.value); }} maxLength={24} /></div>
        <div className="small">Address</div><div className="mono">{me.publicKey.toBase58()}</div>
        <a className="small" href={explorer("address", me.publicKey.toBase58())} target="_blank" rel="noreferrer">View on Solana ↗</a>
        <div className="notice">Your key lives only on this device. Back it up somewhere safe: if you clear this browser without a backup, the wallet is gone.</div>
        <div className="row">
          <button className="btn ghost small" onClick={() => setShow(!show)}>{show ? "Hide backup key" : "Show backup key"}</button>
          <button className="btn ghost small" onClick={() => navigator.clipboard.writeText(exportWallet(me))}>Copy backup key</button>
        </div>
        {show && <div className="terms mono" style={{ fontSize: 11 }}>{exportWallet(me)}</div>}
      </div>
      <p className="small">Short address: {short(me.publicKey)}</p>
    </div>
  );
}
