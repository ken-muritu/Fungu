import { Logo } from "./Brand";
export function DocPage({ title, lede, children }: { title: string; lede: string; children: React.ReactNode }) {
  return (
    <>
      <header className="top"><div className="wrap"><Logo /><nav className="nav"><a className="navlink hide-sm" href="/security">Security</a><a className="navlink hide-sm" href="/help">Help</a><a className="btn small" href="/app">Open app</a></nav></div></header>
      <main className="wrap doc"><h1>{title}</h1><p className="lede">{lede}</p>{children}</main>
      <footer className="foot"><div className="wrap"><span>© 2026 Fungu, by Daelus · Nairobi</span><nav className="footnav" aria-label="Footer"><a href="/">Home</a><a href="/security">Security</a><a href="/help">Help</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="https://github.com/ken-muritu/Fungu">Source</a></nav></div></footer>
    </>
  );
}
