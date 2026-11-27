"use client";
import { useEffect, useRef } from "react";
import { TURNSTILE_SITE_KEY } from "@/lib/config";

declare global {
  interface Window { turnstile?: { render: (el: HTMLElement, o: object) => string; reset: (id?: string) => void }; }
}

/** Cloudflare Turnstile human check (usually invisible). */
export function Turnstile({ onToken }: { onToken: (t: string | null) => void }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let id: string | undefined;
    const render = () => {
      if (!el.current || !window.turnstile || id) return;
      id = window.turnstile.render(el.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: (t: string) => onToken(t),
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null),
      });
    };
    if (window.turnstile) render();
    else {
      const s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = render;
      document.head.appendChild(s);
    }
  }, [onToken]);
  return <div ref={el} style={{ minHeight: 66 }} />;
}
