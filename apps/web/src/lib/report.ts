// Error reporting (Sentry). Web-only: it loads the browser SDK, and does
// nothing at all unless VITE_SENTRY_DSN is set (like App Check's site key in
// src/firebase.ts), so local development, emulator mode and forks send nothing.
//
// What is sent is deliberately thin: the error, where in the app it happened
// (`where`, a short fixed label), the app version and the browser. No task
// text, no user id or email, no breadcrumbs (they'd record console output and
// clicks), no session replay. public/privacy.html describes this; keep the two
// in step.
//
// The SDK is loaded once the app is idle, not at startup. Errors reported
// before then are queued, and dropped if it turns out reporting is off.
type Sentry = typeof import("@sentry/browser");

let state: "pending" | "off" | "on" = "pending";
let sentry: Sentry | null = null;
const queue: { err: unknown; where: string }[] = [];
const QUEUE_MAX = 20;

export function reportError(err: unknown, where: string): void {
  if (state === "off") return;
  if (sentry) { sentry.captureException(err, { tags: { where } }); return; }
  if (queue.length < QUEUE_MAX) queue.push({ err, where });
}

// The parts of a Sentry event this touches (kept structural so it can be
// unit-tested without the SDK).
type ScrubbableEvent = {
  user?: unknown; extra?: unknown; breadcrumbs?: unknown;
  request?: { url?: string; data?: unknown; cookies?: unknown; query_string?: unknown; headers?: Record<string, string> };
};
// Strips anything that could carry personal data or task content, whatever a
// future SDK version or integration decides to attach.
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  delete event.user;
  delete event.extra;
  delete event.breadcrumbs;
  if (event.request) {
    const ua = event.request.headers?.["User-Agent"];
    event.request = { url: event.request.url?.split(/[?#]/)[0], ...(ua ? { headers: { "User-Agent": ua } } : {}) };
  }
  return event;
}

export function initErrorReporting(dsn: string | undefined, release: string, environment: string): void {
  if (!dsn) { state = "off"; queue.length = 0; return; }
  // Uncaught errors and rejections, from the very start (the SDK's own global
  // handlers are left out below, so nothing is reported twice).
  window.addEventListener("error", e => reportError(e.error ?? e.message, "uncaught"));
  window.addEventListener("unhandledrejection", e => reportError(e.reason, "unhandled-rejection"));
  const load = () => {
    import("@sentry/browser").then(S => {
      S.init({
        dsn, release, environment,
        dataCollection: { userInfo: false, cookies: false, httpHeaders: { request: { allow: ["User-Agent"] }, response: false }, httpBodies: [], urlQueryParams: false },
        defaultIntegrations: false,
        integrations: [S.eventFiltersIntegration(), S.functionToStringIntegration(), S.linkedErrorsIntegration(), S.dedupeIntegration(), S.httpContextIntegration()],
        maxBreadcrumbs: 0,
        beforeSend: event => scrubEvent(event),
      });
      sentry = S;
      state = "on";
      for (const { err, where } of queue.splice(0)) S.captureException(err, { tags: { where } });
    }).catch(() => { state = "off"; queue.length = 0; });
  };
  if ("requestIdleCallback" in window) requestIdleCallback(load, { timeout: 5000 });
  else setTimeout(load, 3000);
}
