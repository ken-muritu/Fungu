"use client";
import { useEffect, useState } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** Registers the service worker and offers "Install Fungu":
 *  the native prompt on Android/desktop Chromium, Share → Add to Home Screen steps on iOS Safari. */
export function Pwa() {
  const [evt, setEvt] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const standalone = matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone || localStorage.getItem("fungu.install.dismissed") || !location.pathname.startsWith("/app")) return;
    const onPrompt = (e: Event) => { e.preventDefault(); setEvt(e as InstallEvent); setShow(true); };
    addEventListener("beforeinstallprompt", onPrompt);
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) { setIos(true); setShow(true); }
    return () => removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  if (!show) return null;
  const close = () => { localStorage.setItem("fungu.install.dismissed", "1"); setShow(false); };
  return (
    <div className="install" role="dialog" aria-label="Install Fungu">
      <img src="/icons/icon-192.png" alt="" width={40} height={40} />
      <div className="grow">
        <strong>Install Fungu</strong>
        <div className="small">{ios ? "Tap Share, then “Add to Home Screen”." : "Open it from your home screen like any app."}</div>
      </div>
      {!ios && evt && <button className="btn small" onClick={async () => { await evt.prompt(); await evt.userChoice; close(); }}>Install</button>}
      <button className="btn ghost small" onClick={close}>Not now</button>
    </div>
  );
}
