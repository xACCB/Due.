# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start the Vite dev server (default port 5173).
- `npm run build` — type-check (`tsc -b`) then production-build (`vite build`) into `dist/`.
- `npm run lint` — run ESLint over the whole project.
- `npm run preview` — serve the built `dist/` output locally.
- There is no test suite/framework configured in this repo.

## Architecture

**Single-file app.** Nearly the entire app lives in `src/App.tsx` (~2,270 lines), exported as
`HomeworkPlanner` and rendered into `#root` by `src/main.tsx`. `src/App.css` is intentionally
empty (leftover from the Vite template, unused) and `src/index.css` is just a minimal box-sizing
reset — all real styling comes from inline style objects plus one runtime-generated stylesheet
string (`css`, built from the active theme/font inside the component) injected via `<style>{css}</style>`
in both the main view and Focus Mode. There's no CSS modules, styled-components, or Tailwind.

**State & persistence.** All app state (tasks, theme, layout, subjects, scratchpad, notification
prefs, etc.) is `useState` in `HomeworkPlanner`, each persisted to `localStorage` under `hw-*` keys
via a paired `useEffect`. `localStorage` is the source of truth for signed-out/offline use;
Firestore (when signed in with Google via Firebase Auth) is a sync layer on top of it.

**Firebase.** The `firebaseConfig` (project `ai-homework-planner-92260`) is hardcoded directly in
`App.tsx` — this is a public client web API key, not a secret; access is enforced by Firestore
security rules (`firestore.rules` at the repo root, deployed via `npx firebase-tools deploy
--only firestore:rules` — requires `npx firebase-tools login` first), not by hiding the key. There
is no backend beyond Firebase (Auth + Firestore).

**`authDomain` is this site's own domain (`dueplanner.vercel.app`), not Firebase's
`*.firebaseapp.com` one.** `vercel.json` transparently proxies `/__/auth/**` on this domain to
Firebase's real handler, so the OAuth sign-in flow never crosses origins at all. This is what
actually eliminates (not just works around) the class of bug where browsers with strict storage
partitioning — Firefox's Enhanced Tracking Protection notably — break `signInWithRedirect` when
the auth handler lives on a different origin than the app. `signInWithFirebase` also no longer
auto-falls-back from a blocked popup to `signInWithRedirect`; popup doesn't depend on
`sessionStorage` surviving a full page navigation the way redirect does, so it's asked for again
(with a message to allow popups) rather than silently routing into the less reliable method.
Redirect is now only attempted automatically for `auth/operation-not-supported-in-this-environment`
(genuinely no popup support, e.g. some embedded webviews).

**App Check.** Wired up but inert until `VITE_RECAPTCHA_SITE_KEY` is set (a reCAPTCHA Enterprise site key
from Firebase Console → Project Settings → App Check — not a secret, safe as a plain env var).
Generating tokens client-side does nothing by itself; enforcement (Firestore actually rejecting
requests without one) is a separate, off-by-default switch in the console that should only be
flipped on after confirming real traffic is producing valid tokens.

**Performance Monitoring.** `getPerformance(fbApp)` is initialized unconditionally (no key/setup
needed, included on the free plan) — tracks real-world page load time and network request latency,
visible in Firebase Console → Performance. Wrapped in try/catch like the Firestore persistence
setup above, since a monitoring feature shouldn't be able to break the app if its underlying
browser APIs are unavailable somewhere.

**Firestore data model.** Split across two paths per user, specifically so a small edit doesn't
require rewriting a user's entire history:
- `users/{uid}` — small "profile" fields only: `themeName`, `layout`, `completionLog`,
  `unlockedThemesEver`, `scratchpad`. Synced as a whole document (it's small and doesn't grow
  unboundedly), gated behind `profileSyncedForUid` so the first write after sign-in can't race
  ahead of the first read.
- `users/{uid}/tasks/{taskId}` — one document per task (`taskId` is `String(task.id)`). Synced with
  a diff against `lastSyncedTasksRef` (a `Map<id, Task>` of what's last known to be in the
  subcollection), so only tasks that actually changed get written, via a `writeBatch`, instead of
  the whole list on every toggle.
- An earlier version of this app stored the whole task array as one field on `users/{uid}`, which
  had every edit rewrite every task ever created and could eventually hit Firestore's 1MB
  per-document limit for a long-time user. A one-time migration effect (gated by `readyForUid`,
  which both live listeners wait on) checks for that legacy `tasks` field on sign-in and, if found,
  copies it into the subcollection *before* clearing it — new docs are confirmed written first, so
  an interrupted migration just retries next load instead of losing data.
- An empty tasks subcollection is ambiguous (brand-new account with nothing synced yet, vs. a
  returning account that legitimately has zero tasks) -- `isNewAccountForUid` (set from whether a
  profile doc existed at all when migration was checked) disambiguates it, so a first sign-in
  doesn't wipe local starter tasks before they've had a chance to sync up.
- The outbound tasks write is debounced 400ms behind local state (mirroring the scratchpad's own
  debounce), since drag-to-reorder calls `setTasks()` once per card the dragged item passes over --
  without this, a single reorder drag would fire one Firestore write per intermediate step instead
  of one at the end. Local state and `localStorage` stay instant regardless; only the cloud write
  is delayed.
- `firestore.rules` validates the shape of profile/task writes (required fields present, correct
  types, capped string lengths), not just who's making them -- a second layer beyond
  auth-based ownership, since `firebaseConfig` being public means anyone could otherwise script
  requests directly against the project, bounded only by whatever the rules allow.
- Firestore is initialized with `persistentLocalCache`/`persistentMultipleTabManager` for
  IndexedDB-backed offline support (works offline, repeat loads read from local cache first) with
  multiple open tabs sharing one cache. Wrapped in try/catch with a plain in-memory fallback, since
  this runs at module load time before React renders -- an uncaught throw here would blank-page the
  whole app in an exotic environment instead of just missing offline support.

**Design-system constants** at module scope drive both the inline styles and the runtime
stylesheet: `THEMES` (26 color themes, half light/half dark, some gated behind streak milestones
via `THEME_UNLOCK_REQUIREMENTS`), `LAYOUTS` (12 task-list display modes), `FONTS` (16 heading/body
pairings loaded from Google Fonts).

**Domain logic as plain module-level functions** (not hooks):
- `localDateStr` / `todayISO` / `advanceDate` / `computeStreak` — local-timezone date handling for
  due dates and streaks. Deliberately not `toISOString()`/UTC, since a day should roll over at the
  user's local midnight, not UTC midnight.
- `parseSyllabus` — heuristic line-by-line text scanner (no AI/network call) that extracts
  `(title, dueDate)` pairs from pasted syllabus text, used by the Import tab.
- `getPriority` / `daysUntil` / `formatDate` / `formatTime` — due-date-derived display/priority helpers.
- `nextId()` — monotonic counter for task/subtask ids; avoids `Date.now()` collisions when two ids
  are minted in the same millisecond.

**UI shape.** `HomeworkPlanner` renders a tab bar (`tasks` / `tools` / `import` / `options`, via
`activeTab` state) plus a separate full-screen Focus Mode (`focusMode` state) with its own
Pomodoro-style timer. `TaskModal` (task detail, subtasks, session timer) is defined at module
scope, outside `HomeworkPlanner`, specifically so the session timer's once-a-second tick doesn't
redefine it as a "new" component and force React to remount the modal every second.

## Deployment

Deployed on Vercel as a static Vite build, auto-deploying on push to `main`. Build/output is
auto-detected via Vercel's Vite preset; the one entry in `vercel.json` is the auth proxy rewrite
described above, not a build config override.
