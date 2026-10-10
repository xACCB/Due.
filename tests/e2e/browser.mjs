// A minimal driver for headless Chrome over the DevTools protocol, so the
// end-to-end tests need no extra dependency. Each browser() gets its own
// profile folder, which is what makes two of them behave as two devices.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// CHROME_PATH wins; otherwise the usual install locations.
function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium-browser", "/usr/bin/chromium",
  ].filter(Boolean);
  const found = candidates.find(p => existsSync(p));
  if (!found) throw new Error("Chrome not found. Set CHROME_PATH to its executable.");
  return found;
}

export async function browser(label) {
  const port = 9400 + Math.floor(Math.random() * 500);
  const profile = mkdtempSync(join(tmpdir(), `dueplanner-e2e-${label}-`));
  const proc = spawn(chromePath(), [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    ...(process.env.CI ? ["--no-sandbox"] : []),
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--window-size=1280,900", "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(250);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(t => t.type === "page"); } catch { /* not up yet */ }
  }
  if (!target) { proc.kill(); throw new Error(`Chrome (${label}) didn't start`); }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener("open", resolve); ws.addEventListener("error", reject); });
  let id = 0; const pending = new Map();
  ws.addEventListener("message", e => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  // Runs an expression in the page; a thrown error comes back as "EXC: ...".
  const ev = async expr => {
    const r = await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) return "EXC: " + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
    return r.result?.result?.value;
  };
  await send("Page.enable");
  return {
    label, ev,
    goto: async (url, settleMs = 4000) => { await send("Page.navigate", { url }); await sleep(settleMs); },
    close: () => { try { ws.close(); } catch { /* already closed */ } proc.kill(); setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch { /* still locked */ } }, 500); },
  };
}

// Polls `read()` until `ok(value)` or the time runs out; returns the last value.
export async function waitFor(read, ok, timeoutMs = 15000, everyMs = 300) {
  const until = Date.now() + timeoutMs;
  let value = await read();
  while (!ok(value) && Date.now() < until) { await sleep(everyMs); value = await read(); }
  return value;
}
