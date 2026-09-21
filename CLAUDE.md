# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start the Vite dev server (default port 5173).
- `npm run build` — type-check (`tsc -b`) then production-build (`vite build`) into `dist/`.
- `npm run lint` — run ESLint over the whole project.
- `npm run preview` — serve the built `dist/` output locally.
- `npm test` — Vitest, unit tests for the pure functions in `src/lib/` (dates, priority/format
  helpers, syllabus parsing). Fast, no external services; this is what CI runs.
- `npm run test:rules` — Firestore emulator + `@firebase/rules-unit-testing`, verifying
  `firestore.rules` actually rejects malformed writes and cross-user access. Not run in CI (needs
  the emulator, which needs a JRE); run locally before changing `firestore.rules`.
- `npm run audit:contrast` — diagnostic script (`scripts/check-theme-contrast.ts`, run via `node
  --experimental-strip-types`) that checks every theme in `src/themes.ts` against WCAG AA contrast
  ratios and prints failures. Reports only; doesn't fix anything, since adjusting a theme's hex
  values is a design call on a live, user-facing palette.
- A pre-commit hook (husky + lint-staged, `.husky/pre-commit`) runs `eslint --fix` on staged
  `.ts`/`.tsx` files. Dependabot (`.github/dependabot.yml`) opens weekly npm dependency-update PRs.
- `.github/workflows/ci.yml` runs `npm run build` + `npm run lint` + `npm test` (plus a
  non-blocking `npm audit`) on every push/PR to `main` — Vercel's own build would already catch a
  broken build, but not lint/test failures, which this exists to catch.

## Architecture

**Mostly-single-file app.** The bulk of the app (component tree, all state, all Firebase wiring)
still lives in `src/App.tsx`, exported as `HomeworkPlanner` and rendered into `#root` by
`src/main.tsx`. Pure, dependency-free pieces have been split out so they're independently testable
and reusable outside React: `src/types.ts` (`Priority`/`Recurrence`), `src/themes.ts` (the `THEMES`
palette data, importable by non-React scripts like the contrast auditor), `src/lib/` (`dates.ts`,
`format.ts`, `syllabus.ts`, `id.ts`, `download.ts` — the module-level functions with unit tests in
`npm test`), `src/hooks/usePersistedState.ts` (see below), and `src/components/ErrorBoundary.tsx`.
Everything with real UI logic — tab bodies, pickers, `TaskModal` — is still defined inside
`App.tsx`; splitting those out further is a deliberately deferred, larger effort (see below).
`src/App.css` is intentionally empty (leftover from the Vite template, unused) and `src/index.css`
is just a minimal box-sizing reset — all real styling comes from inline style objects plus one
runtime-generated stylesheet string (`css`, built from the active theme/font inside the component)
injected via `<style>{css}</style>` in both the main view and Focus Mode. There's no CSS modules,
styled-components, or Tailwind. A tiny inline script in `index.html` reads a `hw-bg` localStorage
key (kept in sync with the active theme's background by `App.tsx`) and paints it on `<html>`
before React mounts, to avoid a flash of the default background for returning dark-theme users.

**State & persistence.** All app state (tasks, theme, layout, subjects, scratchpad, notification
prefs, etc.) lives in `HomeworkPlanner`, persisted to `localStorage` under `hw-*` keys.
`localStorage` is the source of truth for signed-out/offline use; Firestore (when signed in with
Google via Firebase Auth) is a sync layer on top of it. Most simple fields (no extra
validation/merge logic on read) use `usePersistedState(key, initial)` — a small hook
(`src/hooks/usePersistedState.ts`) replacing the repeated `useState` + localStorage `useEffect`
pair. It JSON-serializes on write, and on read falls back to the raw string if `JSON.parse` throws
— several fields predate the hook and stored plain unquoted strings (e.g. `"list"`, not
`'"list"'`), and this keeps those intact on the first load after adopting the hook rather than
silently resetting them to the default. Fields with real extra logic on read (`tasks` — order
backfill; `themeName` — validates against `THEMES`; `themeByMode` — derives from current theme;
`subjectColors` — merges with defaults; `accentOverride` — `removeItem` instead of writing `null`;
`scratchpad` — its own separate debounce, see below) are deliberately left as hand-written
`useState`/`useEffect` pairs rather than forced into the generic hook.

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

**Analytics.** `getAnalytics(fbApp)` (basic page views/session/engagement tracking, free on Spark)
is gated behind `isSupported()` rather than just try/catch, since the underlying `gtag.js` script
commonly gets silently blocked by ad/privacy-blocker extensions (AdGuard, uBlock, etc.) rather than
throwing -- `isSupported()` checks that explicitly instead of half-initializing. `public/privacy.html`
discloses this; keep that page in sync if what's collected here changes.

**Firestore data model.** Split across two paths per user, specifically so a small edit doesn't
require rewriting a user's entire history:
- `users/{uid}` — small "profile" fields only: `themeName`, `layout`, `scratchpad`. Synced as a
  whole document (it's small and doesn't grow unboundedly), gated behind `profileSyncedForUid` so
  the first write after sign-in can't race ahead of the first read.
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
- Account deletion (Options tab, "Danger Zone", gated on being signed in) batch-deletes every doc
  in the tasks subcollection plus the profile doc, then calls Firebase Auth's `deleteUser`, then
  clears every `hw-*` localStorage key and reloads -- "delete my data" means all of it, not just
  the cloud copy. Gated behind a type-`DELETE`-to-confirm panel rather than a plain `window.confirm`,
  given it's irreversible. Not chunked past Firestore's 500-op batch limit, matching the existing
  tasks-sync effect's `writeBatch` usage elsewhere.

**Design-system constants** drive both the inline styles and the runtime stylesheet: `THEMES` (26
color themes, 13 light / 13 dark, all freely selectable — data lives in `src/themes.ts`; `stealthLight`
is a literal per-channel RGB inversion of `stealth`'s achromatic grays, nudged slightly on
`textMuted` since a naive hex inversion doesn't perfectly preserve WCAG contrast ratios -- gamma
non-linearity means inverting each channel isn't the same as mirroring relative luminance; the "BOW"
theme that briefly existed alongside `stealthLight` has been removed again),
`LAYOUTS` (12 task-list display modes, still in `App.tsx`), `FONTS` (16 heading/body pairings
loaded from Google Fonts, still in `App.tsx`).

**Domain logic as plain functions** (not hooks), all in `src/lib/` and unit-tested via `npm test`:
- `dates.ts`: `localDateStr` / `todayISO` / `advanceDate` — local-timezone date handling for due
  dates. Deliberately not `toISOString()`/UTC, since a day should roll over at the user's local
  midnight, not UTC midnight.
- `syllabus.ts`: `parseSyllabus` — heuristic line-by-line text scanner (no AI/network call) that
  extracts `(title, dueDate)` pairs from pasted syllabus text, used by the Import tab.
- `format.ts`: `getPriority` / `daysUntil` / `formatDate` / `formatTime` / `contrastColor` /
  `csvField` — due-date-derived display/priority helpers, plus the WCAG-luminance-based
  light/dark-text picker (`contrastColor`) and CSV field quoting used by data export.
- `id.ts`: `nextId()` — monotonic counter for task/subtask ids; avoids `Date.now()` collisions when
  two ids are minted in the same millisecond.
- `download.ts`: `downloadFile` — the `Blob` + object URL + synthetic `<a download>` click pattern
  used by data export.

**UI shape.** `HomeworkPlanner` renders a tab bar (`tasks` / `tools` / `import` / `options`, via
`activeTab` state) plus a separate full-screen Focus Mode (`focusMode` state) with its own
Pomodoro-style timer. `TaskModal` (task detail, subtasks, session timer) is defined at module
scope, outside `HomeworkPlanner`, specifically so the session timer's once-a-second tick doesn't
redefine it as a "new" component and force React to remount the modal every second. It hand-rolls a
focus trap (Tab/Shift+Tab cycle within the panel, focus-return to whatever opened it on close,
Escape-to-close unless a session is active) since it's a custom `<div>` overlay rather than a
native `<dialog>`; the trap effect intentionally runs once (mount/unmount only) and reads
`sessionActive`/`onClose` through refs rather than including them as effect deps, so it doesn't
re-steal focus into the first element on every unrelated re-render. `TaskModal`'s render site in
`HomeworkPlanner` is wrapped in `<ErrorBoundary>` (`src/components/ErrorBoundary.tsx`, also reused
by `main.tsx` for the app-wide boundary) with a small inline fallback, so a malformed task object
only closes the modal instead of blanking the whole app -- narrower than the app-wide boundary,
which still exists as the outer safety net for anything else.

**Task fields beyond the original core set:**
- `tags?: string[]` — free-form, cross-cutting, distinct from `subject` (one per task, tags are
  many). Edited in `TaskModal`; `allTags` (derived, deduplicated across all tasks) drives the
  autocomplete suggestion chips there.
- `priorityOverride?: Priority` — manually pins a task's priority instead of always deriving it
  from due date/estimate. `getPriority(dueDate, estMins, override?)` checks this first; every call
  site was updated to pass `task.priorityOverride` as the third argument.

**Bulk edit / multi-select** (`selectionMode`/`selectedIds` state) is deliberately scoped to the
default list layout only (`MiniCard`) — the other 11 layouts each render their own custom task row
markup, so extending selection to all of them was judged not worth the scope. `MiniCard` accepts
`selectionMode`/`isSelected`/`onToggleSelect` and repurposes the done-toggle button into a selection
checkbox when active, gating swipe/drag handlers off at the same time to avoid gesture conflicts.

**Task templates** (`TaskTemplate`, `templates` state) are local-only — `localStorage`, not synced
to Firestore. Deliberate scope call: a personal convenience, not core data, not worth a second
synced subcollection right now. Starting a task from a template (`startFromTemplate`) skips the
normal step-by-step add-task wizard straight to the due-date question via `usingTemplate`/
`templateSubtasks` state, since the template already answered the other questions.

**Reminders** (`REMINDER_OFFSETS`, `enabledOffsets` state) support multiple independently-toggleable
lead times (1 day / 3 hours / 1 hour before, or at due time) for tasks with a specific due *time*;
tasks with only a due date fall back to the original once-daily due/overdue summary. Sent-reminder
tracking is keyed by `(taskId, offsetKey, dueDate+dueTime)` in `localStorage`, so editing a task's
due date/time naturally resets what's still owed. A 1-minute `setInterval` re-checks while the tab
is open, since offset reminders need to fire close to a specific time, not just on tab-focus.

**Data export** (`exportAllDataJSON`/`exportTasksCSV`) uses a shared `downloadFile()` helper
(`Blob` + object URL + a synthetic `<a download>` click) — the standard client-side download
pattern, no server involved.

## Branding

The company is **Due Studios**; this product is **DuePlanner** (the intended umbrella structure is
one company, multiple products — e.g. a hypothetical future "DueCalendar" would be a sibling
product under the same company, not a rename of this one). In UI text and any user-facing copy,
use "DuePlanner" for anything referring to this product/app specifically; "due. studios" (kept
lowercase/stylized to match the app's existing minimalist lowercase design language) is correct
when a line is crediting/attributing the company itself, as in the existing "by due. studios"
taglines. Don't reintroduce bare "due." as the product's name or wordmark -- there's an established,
same-category competitor app literally called "Due" (dueapp.com), which is exactly the naming
collision this convention avoids.

## Deployment

Deployed on Vercel as a static Vite build, auto-deploying on push to `main`. Build/output is
auto-detected via Vercel's Vite preset; `vercel.json` holds the auth proxy rewrite described above
plus basic security response headers (`X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`, `Permissions-Policy`) applied to everything except the `/__/auth/**` proxy paths
-- deliberately excluded so they can't interact with Firebase's own proxied auth handler content.
No `Content-Security-Policy` is set; one was deliberately not added given the risk of silently
breaking Google Sign-In/reCAPTCHA/Google Fonts without a live test cycle to verify against.
