// Development only, and only with VITE_DEV_REMOTE=1 (`npm run dev`): lets a
// script on the Mac drive the app in the iPhone Simulator's Safari without
// tapping, to compare screens with the phone app (apps/mobile has the same
// idea in src/lib/devRemote.ts). Every second it reads
// http://localhost:8099/web.json and acts once per new `n`:
//   {"n":2,"ls":{"hw-layout":"board"}}  write localStorage keys (JSON), then reload
//   {"n":3,"click":"Settings"}          click the first visible button whose text or aria-label is that
//   {"n":4,"css":"[data-tour=layout]"}  click the first element matching a selector
//   {"n":5,"scroll":600}                scroll the page to y
//   {"n":5,"scroll":600,"in":"[role=dialog]"}  scroll the first scrollable box inside that element instead
//   {"n":6,"reload":true}
// The server must send Access-Control-Allow-Origin (a plain http.server doesn't).
const URL = "http://localhost:8099/web.json";

type Cmd = { n?: number; ls?: Record<string, unknown>; clearLs?: boolean; click?: string; css?: string; scroll?: number; in?: string; reload?: boolean };

function visible(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

function clickText(text: string): void {
  const want = text.trim().toLowerCase();
  const els = [...document.querySelectorAll<HTMLElement>("button,[role=button],a,label,summary,[role=tab],[role=radio]")].filter(visible);
  const name = (el: HTMLElement) => (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
  const el = els.find(e => name(e) === want) ?? els.find(e => name(e).startsWith(want));
  el?.click();
}

export function startDevRemote(): void {
  let last: number | null = Number(sessionStorage.getItem("dev-remote-n") ?? "NaN");
  if (Number.isNaN(last)) last = null;
  setInterval(async () => {
    try {
      const res = await fetch(URL, { cache: "no-store" });
      if (!res.ok) return;
      const cmd = (await res.json()) as Cmd;
      if (typeof cmd.n !== "number" || cmd.n === last) return;
      const first = last === null;
      last = cmd.n;
      sessionStorage.setItem("dev-remote-n", String(cmd.n));
      if (first) return; // what was there before the page loaded isn't new
      if (cmd.clearLs) { for (const k of Object.keys(localStorage)) if (k.startsWith("hw-")) localStorage.removeItem(k); }
      if (cmd.ls) { for (const [k, v] of Object.entries(cmd.ls)) { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } }
      if (cmd.ls || cmd.clearLs || cmd.reload) { location.reload(); return; }
      if (cmd.click) clickText(cmd.click);
      if (cmd.css) (document.querySelector(cmd.css) as HTMLElement | null)?.click();
      if (typeof cmd.scroll === "number") {
        const root = cmd.in ? document.querySelector<HTMLElement>(cmd.in) : null;
        const box = root ? [root, ...root.querySelectorAll<HTMLElement>("*")].find(el => el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) : null;
        if (box) box.scrollTop = cmd.scroll; else window.scrollTo(0, cmd.scroll);
      }
    } catch { /* no script running */ }
  }, 1000);
}
