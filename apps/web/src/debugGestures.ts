// On-device gesture diagnostics, off unless the URL has ?debug=touch. Shows a
// live log of pointer and touch events (what was hit, its touch-action,
// cancels) so a gesture problem on a real device -- which desktop emulation
// can't reproduce -- can be read off a single screenshot. Plain DOM, no React,
// so it keeps working even if the app's own handlers are what's broken.
export function installGestureDebug(): void {
  if (!/[?&]debug=touch\b/.test(location.search)) return;
  const panel = document.createElement("div");
  panel.setAttribute("aria-hidden", "true");
  panel.style.cssText = "position:fixed;left:6px;right:6px;top:6px;z-index:99999;max-height:45vh;overflow:hidden;background:rgba(0,0,0,.85);color:#7CFC9A;font:11px/1.35 ui-monospace,Menlo,monospace;padding:6px 8px;border-radius:8px;pointer-events:none;white-space:pre-wrap;word-break:break-all";
  const lines: string[] = [];
  const glass = localStorage.getItem("hw-liquid-glass");
  const head = `gesture debug · ${navigator.userAgent.replace(/^Mozilla\/5\.0 /, "").slice(0, 90)}\nmaxTouchPoints=${navigator.maxTouchPoints} glass=${glass} sw=${"serviceWorker" in navigator && !!navigator.serviceWorker.controller}`;
  const render = () => { panel.textContent = head + "\n" + lines.join("\n"); };
  const describe = (t: EventTarget | null): string => {
    if (!(t instanceof Element)) return String(t);
    const el = t as HTMLElement;
    const card = el.closest("[data-task-id]");
    const label = el.getAttribute("aria-label") || el.className?.toString().split(" ")[0] || "";
    return `${el.tagName.toLowerCase()}${label ? "." + label.slice(0, 24) : ""}${card ? ` card#${card.getAttribute("data-task-id")}` : ""} ta=${getComputedStyle(el).touchAction}`;
  };
  let lastMove = 0;
  const log = (s: string) => { lines.push(s); if (lines.length > 18) lines.shift(); render(); };
  const opts = { capture: true, passive: true } as const;
  for (const type of ["pointerdown", "pointerup", "pointercancel", "gotpointercapture", "lostpointercapture"]) {
    window.addEventListener(type, e => { const p = e as PointerEvent; log(`${type.replace("pointer", "p:")} ${p.pointerType} #${p.pointerId} ${Math.round(p.clientX)},${Math.round(p.clientY)} → ${describe(p.target)}`); }, opts);
  }
  window.addEventListener("pointermove", e => {
    const now = performance.now(); if (now - lastMove < 120) return; lastMove = now;
    log(`p:move ${e.pointerType} ${Math.round(e.clientX)},${Math.round(e.clientY)} buttons=${e.buttons}`);
  }, opts);
  for (const type of ["touchstart", "touchend", "touchcancel"]) {
    window.addEventListener(type, e => { const t = e as TouchEvent; log(`${type} n=${t.touches.length} cancelable=${t.cancelable} → ${describe(t.target)}`); }, opts);
  }
  window.addEventListener("scroll", () => { const now = performance.now(); if (now - lastMove < 120) return; lastMove = now; log(`scroll y=${Math.round(scrollY)}`); }, opts);
  window.addEventListener("error", e => log(`ERROR ${e.message}`));
  window.addEventListener("unhandledrejection", e => log(`REJECTION ${String(e.reason).slice(0, 120)}`));
  const add = () => { document.body.appendChild(panel); render(); };
  if (document.body) add(); else document.addEventListener("DOMContentLoaded", add);
}
