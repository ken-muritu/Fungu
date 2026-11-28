"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
// Group books: KES records kept on members' phones, with a tamper-evident fingerprint
// of every entry on Solana. Officials approve entries; no money moves through Fungu.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  bookActions, bookStore, canonical, chainRoot, ENTRY, EntryKind, EntryRecord, fetchBook, fetchBookHistory,
  fetchBooks, fetchProposals, nameOf, names, ownerOfName, rulesStore, sha256, short,
} from "@/lib/fungu";
import { explorer } from "@/lib/config";

const KIND_LABEL: Record<EntryKind, string> = {
  contribution: "Contribution", payout: "Payout", repayment: "Loan repayment", loan: "Loan given", fine: "Fine",
  joined: "Member joined", left: "Member left", note: "Note", rules: "Rule change",
};
const kindName = (k: number) => (Object.keys(ENTRY) as EntryKind[]).find((x) => ENTRY[x] === k) ?? "note";
const kes = (n: number) => `KSh ${Number(n).toLocaleString("en-KE")}`;
const eq = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const hex = (a: number[]) => a.map((x) => x.toString(16).padStart(2, "0")).join("");
const b64 = { enc: (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), dec: (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, "+").replace(/_/g, "/")))) };
const wa = (t: string) => `https://wa.me/?text=${encodeURIComponent(t)}`;
const bookName = (a: string) => names.get()[a] || `Book ${a.slice(0, 4)}`;

async function toKey(s: string): Promise<PublicKey | null> {
  const v = s.trim();
  if (!v) return null;
  if (v.startsWith("@") || (v.length <= 20 && /^[a-z0-9_]{3,20}$/i.test(v))) return ownerOfName(v.replace(/^@/, "").toLowerCase());
  try { return new PublicKey(v); } catch { return null; }
}

/** Save a shared record (from an approval link) to this phone, if its fingerprint is genuine. */
export async function importSharedRecord(book: string, r: string) {
  try {
    const { salt, record } = JSON.parse(b64.dec(r));
    const hash = await sha256(`${salt}|${canonical(record)}`);
    const list = bookStore.get()[book] ?? [];
    if (!list.some((x) => eq(x.hash, hash))) bookStore.set(book, [...list, { salt, record, hash }]);
  } catch { /* ignore a broken link */ }
}

export function Books({ me, busy, run, onOpen }: { me: Keypair; busy: boolean; run: any; onOpen: (a: string) => void }) {
  const [books, setBooks] = useState<any[] | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [others, setOthers] = useState("");
  const [threshold, setThreshold] = useState("2");
  const [rules, setRules] = useState("");
  const [err, setErr] = useState("");
  const load = useCallback(() => fetchBooks(me.publicKey).then(setBooks).catch(() => setBooks([])), [me]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    setErr("");
    const keys = [me.publicKey];
    for (const s of others.split(/[\s,]+/).filter(Boolean)) {
      const k = await toKey(s);
      if (!k) return setErr(`Couldn't find ${s}. Use their @name or Fungu address.`);
      if (!keys.some((x) => x.equals(k))) keys.push(k);
    }
    const t = Number(threshold);
    if (keys.length > 5) return setErr("A book can have up to 5 officials.");
    if (!(t >= 1 && t <= keys.length)) return setErr(`Approvals needed must be between 1 and ${keys.length}.`);
    const r = await run("Opening the book", () => bookActions.create(me, keys, t, rules.trim()));
    if (r) { names.set(r.book.toBase58(), name.trim()); onOpen(r.book.toBase58()); }
  };

  return (
    <div className="stack">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}><h3 style={{ margin: 0 }}>Open a group book</h3><button className="btn small ghost" onClick={() => setOpen(!open)}>{open ? "Close" : "Open"}</button></div>
        <p className="small">A shared record of your group&apos;s money in shillings. Every entry needs your officials&apos; approval, and nobody can change it afterwards without it showing. Fungu never holds the money.</p>
        {open && (
          <div style={{ marginTop: 16 }}>
            <div className="field"><label>Group name</label><input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="e.g. Wamama wa Kahawa welfare" /></div>
            <div className="field"><label>Other officials (treasurer, secretary): @names, separated by commas</label><input value={others} onChange={(e) => setOthers(e.target.value)} placeholder="@wanjiku, @otieno" /></div>
            <div className="field"><label>Approvals needed for each entry</label><input type="number" min="1" max="5" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></div>
            <div className="field"><label>Group rules (contribution, fines, payout order)</label><textarea rows={4} value={rules} onChange={(e) => setRules(e.target.value)} placeholder="KES 500 every Friday. Late payment fine KES 50. Payout order agreed at the first meeting." /></div>
            {err && <div className="notice err">{err}</div>}
            <button className="btn" disabled={busy || !name.trim() || !rules.trim()} onClick={submit}>Open book</button>
          </div>
        )}
      </div>
      <div className="card">
        <h3>Your books</h3>
        {books === null && <p className="small">Loading…</p>}
        {books?.length === 0 && <p className="empty">No books yet. Open one above, or open a link an official sent you.</p>}
        {books?.map((b) => (
          <div key={b.address.toBase58()} className="item" role="button" tabIndex={0} style={{ cursor: "pointer" }} onClick={() => onOpen(b.address.toBase58())} onKeyDown={(e) => e.key === "Enter" && onOpen(b.address.toBase58())}>
            <div className="grow"><strong>{bookName(b.address.toBase58())}</strong><div className="small">{b.entries.toNumber()} entries · {b.threshold} of {b.officials.length} officials approve</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function BookView({ address, me, busy, run, onBack }: { address: string; me: Keypair; busy: boolean; run: any; onBack: () => void }) {
  const key = useMemo(() => { try { return new PublicKey(address); } catch { return null; } }, [address]);
  const [b, setB] = useState<any>(null);
  const [missing, setMissing] = useState(false);
  const [props, setProps] = useState<any[]>([]);
  const [hist, setHist] = useState<{ start: number[] | null; entries: any[] } | null>(null);
  const [check, setCheck] = useState<null | { ok: boolean; text: string }>(null);
  const [kind, setKind] = useState<EntryKind>("contribution");
  const [amount, setAmount] = useState("");
  const [who, setWho] = useState("");
  const [mpesa, setMpesa] = useState("");
  const [note, setNote] = useState("");
  const [share, setShare] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!key) return setMissing(true);
    const x = await fetchBook(key);
    if (!x) return setMissing(true);
    setB(x);
    setProps(await fetchProposals(key).catch(() => []));
    setHist(await fetchBookHistory(key).catch(() => ({ start: null, entries: [] })));
  }, [key]);
  useEffect(() => { load(); }, [load]);

  if (missing) return <div className="card"><p>This book wasn&apos;t found.</p><button className="btn ghost small" onClick={onBack}>Back</button></div>;
  if (!b || !hist) return <p className="small">Loading book…</p>;

  const local = bookStore.get()[address] ?? [];
  const recordFor = (h: number[]) => local.find((x) => eq(x.hash, h));
  const official = b.officials.some((k: PublicKey) => k.equals(me.publicKey));
  const idx = b.officials.findIndex((k: PublicKey) => k.equals(me.publicKey));
  const invite = `${window.location.origin}/app?b=${address}`;
  const act = (label: string, fn: () => Promise<any>) => run(label, fn).then(load);

  const propose = async () => {
    const rec: EntryRecord = { kind, amount: Number(amount) || 0, who: who.trim(), mpesa: mpesa.trim(), note: note.trim(), at: Date.now() };
    const r = await run("Recording the entry", () => bookActions.propose(me, key!, rec));
    if (r) {
      const saved = (bookStore.get()[address] ?? []).slice(-1)[0];
      setShare(`${invite}&r=${b64.enc(JSON.stringify({ salt: saved.salt, record: saved.record }))}`);
      setAmount(""); setWho(""); setMpesa(""); setNote("");
      load();
    }
  };

  const verify = async () => {
    if (!hist.start) return setCheck({ ok: false, text: "Couldn't read the book's opening entry from the network. Try again." });
    const root = await chainRoot(hist.start, hist.entries);
    if (!eq(root, Array.from(b.root as number[]))) return setCheck({ ok: false, text: "The history read from the network doesn't match the book's fingerprint. Don't rely on this copy." });
    let bad = 0;
    for (const e of hist.entries) {
      const r = recordFor(e.hash);
      if (r && !eq(await sha256(`${r.salt}|${canonical(r.record)}`), e.hash)) bad++;
    }
    const have = hist.entries.filter((e) => recordFor(e.hash)).length;
    setCheck(bad ? { ok: false, text: `${bad} record(s) on this phone were changed after approval.` }
      : { ok: true, text: `All ${hist.entries.length} entries are intact. ${have} of them have their details on this phone and match exactly.` });
  };

  const statement = () => {
    const rows = hist.entries.map((e) => {
      const r = recordFor(e.hash)?.record;
      return `<tr><td>${e.seq}</td><td>${new Date(e.time * 1000).toLocaleString("en-KE")}</td><td>${KIND_LABEL[kindName(e.kind)]}</td><td style="text-align:right">${kes(e.amount)}</td><td>${r ? [r.who, r.mpesa, r.note].filter(Boolean).join(" · ").replace(/</g, "&lt;") : "(details not on this phone)"}</td><td class="m">${hex(e.hash).slice(0, 16)}…<br>${e.sig.slice(0, 16)}…</td></tr>`;
    }).join("");
    const offs = b.officials.map((k: PublicKey) => `${nameOf(k, me.publicKey)} (${k.toBase58()})`).join("<br>");
    const html = `<!doctype html><meta charset="utf-8"><title>Statement: ${bookName(address)}</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:900px;margin:32px auto;padding:0 16px;color:#111}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px;text-align:left;vertical-align:top}.m{font:11px ui-monospace,monospace;color:#555}h1{font-size:22px}h2{font-size:16px;margin-top:32px}@media print{button{display:none}}</style>
<h1>Statement of account: ${bookName(address)}</h1>
<p>Book address: <span class="m">${address}</span><br>Network: Solana ${explorer("address", address).includes("devnet") ? "devnet (test network)" : "mainnet"}<br>Officials (${b.threshold} approvals needed):<br>${offs}<br>Current fingerprint (root): <span class="m">${hex(Array.from(b.root))}</span><br>Rules fingerprint: <span class="m">${hex(Array.from(b.rulesHash))}</span><br>Generated: ${new Date().toLocaleString("en-KE")}</p>
<table><tr><th>#</th><th>Recorded</th><th>Type</th><th>Amount</th><th>Details</th><th>Fingerprint / transaction</th></tr>${rows}</table>
<p>Each entry was approved by the required officials before it was recorded. Anyone can check this statement: re-hash each record and compare with the fingerprints recorded on the network at the book address above.</p>
<h2>Certificate under section 106B(4) of the Evidence Act (Cap. 80): template</h2>
<p>I, ______________________ (name), of ID No. __________, being ______________ (office, e.g. treasurer) of ${bookName(address)}, certify that:</p>
<ol><li>This statement was produced by the Fungu application from records kept on my phone and from the public Solana ledger at the address above, during a period when the application and ledger were in regular use by the group.</li>
<li>During that period the device and ledger operated properly, or any fault did not affect the accuracy of these records.</li>
<li>The information in this statement reproduces the records as they were approved by the group's officials, and each entry matches its fingerprint on the ledger.</li></ol>
<p>Signed: ______________________ &nbsp; Date: ____________</p>
<p class="m">This template is a starting point, not legal advice. Have it reviewed by an advocate before relying on it in court.</p>
<button onclick="print()">Print or save as PDF</button>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };

  return (
    <div className="stack">
      <button className="btn ghost small" onClick={onBack}>← All books</button>
      <div className="card stack">
        <h3 style={{ margin: 0 }}>{bookName(address)}</h3>
        <div className="small">{b.entries.toNumber()} entries · {b.threshold} of {b.officials.length} officials approve each one</div>
        <div>{b.officials.map((k: PublicKey) => <div className="item" key={k.toBase58()}><div className="grow">{nameOf(k, me.publicKey)}</div><span className="small">official</span></div>)}</div>
        {rulesStore.get()[address] && <details><summary className="small">Group rules</summary><p className="small" style={{ whiteSpace: "pre-wrap" }}>{rulesStore.get()[address]}</p></details>}
        <div className="row">
          <button className="btn small" onClick={verify}>Check the book</button>
          <button className="btn ghost small" onClick={statement}>Statement for court or audit</button>
          <a className="btn ghost small" href={wa(`Our group book "${bookName(address)}" on Fungu: ${invite}`)} target="_blank" rel="noreferrer">Share on WhatsApp</a>
        </div>
        {check && <div className={`notice ${check.ok ? "ok" : "err"}`}>{check.text}</div>}
      </div>

      {props.length > 0 && (
        <div className="card stack">
          <h3 style={{ margin: 0 }}>Waiting for approval</h3>
          {props.map((p) => {
            const r = recordFor(Array.from(p.entryHash));
            const mine = idx >= 0 && (p.approvals & (1 << idx)) !== 0;
            return (
              <div key={p.address.toBase58()} className="stack" style={{ gap: 8 }}>
                <div className="item"><div className="grow"><strong>{KIND_LABEL[kindName(p.kind)]} · {kes(p.amount.toNumber())}</strong>
                  <div className="small">{r ? [r.record.who, r.record.mpesa, r.record.note].filter(Boolean).join(" · ") : "Ask the proposer for the approval link to see the details"} · {p.approvals.toString(2).split("1").length - 1} of {b.threshold} approvals</div></div></div>
                {official && <div className="row">
                  <button className="btn small" disabled={busy || mine || !r} onClick={() => act("Approving", () => bookActions.approve(me, key!, p.address))}>{mine ? "You approved" : "Approve"}</button>
                  <button className="btn ghost small" disabled={busy} onClick={() => act("Rejecting", () => bookActions.reject(me, key!, p.address))}>Reject</button>
                </div>}
              </div>
            );
          })}
        </div>
      )}

      <div className="card stack">
        <h3 style={{ margin: 0 }}>Record an entry</h3>
        <div className="two">
          <div className="field"><label>Type</label><select value={kind} onChange={(e) => setKind(e.target.value as EntryKind)}>{(Object.keys(KIND_LABEL) as EntryKind[]).filter((k) => k !== "rules").map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></div>
          <div className="field"><label>Amount (KSh)</label><input type="number" min="0" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        </div>
        <div className="two">
          <div className="field"><label>Member</label><input value={who} onChange={(e) => setWho(e.target.value)} maxLength={40} placeholder="e.g. Wanjiku" /></div>
          <div className="field"><label>Payment code (optional)</label><input value={mpesa} onChange={(e) => setMpesa(e.target.value)} maxLength={20} placeholder="e.g. TKL3X9ABCD" /></div>
        </div>
        <div className="field"><label>Note (optional)</label><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={80} /></div>
        <p className="small">Only a fingerprint of this entry goes on the network. The details stay on your phone and on the phones of officials you share them with.</p>
        <button className="btn" disabled={busy || !(Number(amount) >= 0) || amount === ""} onClick={propose}>{official && b.threshold === 1 ? "Record entry" : "Send for approval"}</button>
        {share && <div className="notice ok">Entry sent. Officials need its details to approve: <a href={wa(`Please approve this entry in "${bookName(address)}": ${share}`)} target="_blank" rel="noreferrer">send the approval link on WhatsApp</a>.</div>}
      </div>

      <div className="card">
        <h3>History</h3>
        {hist.entries.length === 0 && <p className="empty">No entries yet.</p>}
        {[...hist.entries].reverse().map((e) => {
          const r = recordFor(e.hash)?.record;
          return (
            <div className="item" key={e.seq}>
              <span className="pill">{e.seq}</span>
              <div className="grow"><strong>{KIND_LABEL[kindName(e.kind)]} · {kes(e.amount)}</strong><div className="small">{r ? [r.who, r.mpesa, r.note].filter(Boolean).join(" · ") : "details not on this phone"} · {new Date(e.time * 1000).toLocaleDateString("en-KE")}</div></div>
              <a className="small" href={explorer("tx", e.sig)} target="_blank" rel="noreferrer">Proof ↗</a>
            </div>
          );
        })}
        <p className="small" style={{ marginTop: 8 }}>Book address <span title={address}>{short(address)}</span></p>
      </div>
    </div>
  );
}
