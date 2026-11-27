import { Logo, Ring } from "@/components/Brand";
export const metadata = { title: "Page not found · Fungu" };
export default function NotFound() {
  return (
    <>
      <header className="top"><div className="wrap"><Logo /><nav className="nav"><a className="btn small" href="/app">Open app</a></nav></div></header>
      <main className="nf">
        <div style={{ justifySelf: "center" }}><Ring value={0.5} /></div>
        <h1>Nothing here</h1>
        <p className="sub">This page doesn&apos;t exist. What you&apos;re looking for is probably in the app.</p>
        <div className="row" style={{ justifyContent: "center" }}><a className="btn" href="/">Go home</a><a className="btn ghost" href="/help">Get help</a></div>
      </main>
    </>
  );
}
