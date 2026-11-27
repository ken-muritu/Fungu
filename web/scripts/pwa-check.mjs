// Asks Chromium itself whether Fungu is installable (Page.getInstallabilityErrors), checks the
// manifest parses cleanly, the service worker takes control, and /app still opens offline.
// Usage: node scripts/pwa-check.mjs [url] [path-to-chrome]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const URL_ = process.argv[2] || "https://fungu.daelus.co.ke/app";
const CHROME = process.argv[3] || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "fungu-pwa-"));
const proc = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? "PASS" : "FAIL"}  ${what}`); if (!ok) fails++; };

try {
  let target;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === "page"); } catch {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const pending = new Map();
  const sessions = new Map(); // attached targets (the service worker) → sessionId
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (d.method === "Target.attachedToTarget") sessions.set(d.params.targetInfo.type, d.params.sessionId);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  });
  const cdp = (method, params = {}, sessionId) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const evalJs = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;

  await cdp("Page.enable");
  await cdp("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
  await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  await cdp("Page.navigate", { url: URL_ });
  await sleep(8000);
  const sw = await evalJs("navigator.serviceWorker.ready.then(r => !!r.active && r.active.state)");
  check(sw === "activated", `service worker active (${sw})`);
  await cdp("Page.reload"); await sleep(5000);
  check(await evalJs("!!navigator.serviceWorker.controller"), "service worker controls the page");
  const inst = (await cdp("Page.getInstallabilityErrors")).result?.installabilityErrors || [];
  check(inst.length === 0, `Chromium installability: ${inst.length ? inst.map((e) => e.errorId).join(", ") : "installable"}`);
  const man = (await cdp("Page.getAppManifest")).result || {};
  check(!!man.url && (man.errors || []).length === 0, `manifest parsed (${(man.errors || []).length} errors) ${man.url || ""}`);
  check(await evalJs("matchMedia('(max-width: 400px)').matches && document.documentElement.scrollWidth <= innerWidth"), "no horizontal scroll at 390px");

  // offline for the page AND the service worker (the worker has its own network stack)
  const off = { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
  const swSession = sessions.get("service_worker");
  check(!!swSession, "attached to the service worker to cut its network");
  for (const sid of [undefined, swSession]) { await cdp("Network.enable", {}, sid); await cdp("Network.emulateNetworkConditions", off, sid); }
  check(/Failed to fetch|NetworkError|TypeError/i.test(String(await evalJs("fetch('/api/rpc',{method:'POST',body:'{}'}).then(()=> 'online', e => String(e))"))), "network really is off");
  await cdp("Page.navigate", { url: URL_ }); await sleep(4000);
  const offlineTitle = await evalJs("document.title + ' | ' + (document.body.innerText || '').slice(0, 60).replace(/\\s+/g, ' ')");
  check(!!offlineTitle && !/ERR_|not available|No internet/i.test(offlineTitle), `opens offline: "${offlineTitle}"`);
  await cdp("Page.navigate", { url: new URL("/some-uncached-page", URL_).href }); await sleep(3000);
  check(/offline/i.test(await evalJs("document.title")), "uncached page offline → Fungu offline page");
  ws.close();
} finally {
  proc.kill();
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
process.exit(fails ? 1 : 0);
