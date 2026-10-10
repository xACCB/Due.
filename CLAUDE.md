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
  `firestore.rules` actually rejects malformed writes and cross-user access. Needs Java (a JRE) for
  the emulator; CI installs one and runs it. Run it locally before changing `firestore.rules`.
- Emulator mode: `npx firebase-tools emulators:start --only auth,firestore` (needs Java), then
  `VITE_FIREBASE_EMULATORS=1 npm run dev` -- the app talks to the local Auth/Firestore emulators
  (fake Google sign-in, throwaway data) instead of production. Dev server only; never in a build.
- `npm run audit:contrast` — diagnostic script (`scripts/check-theme-contrast.ts`, run via `node
  --experimental-strip-types`) that checks every theme in `src/themes.ts` against WCAG AA contrast
  ratios and prints failures. Reports only; doesn't fix anything, since adjusting a theme's hex
  values is a design call on a live, user-facing palette.
- A pre-commit hook (husky + lint-staged, `.husky/pre-commit`) runs `eslint --fix` on staged
  `.ts`/`.tsx` files. Dependabot (`.github/dependabot.yml`) opens weekly npm dependency-update PRs.
- `.github/workflows/ci.yml` runs on every push/PR to `main` and weekly (Monday cron). Job
  `build-and-lint`: `npm run build`, `npm run lint`, `npm test`, `npm run test:rules`. Job
  `security`: `npm audit --audit-level=high` (blocking, dev dependencies included; Dependabot's PRs
  are the usual fix) and a gitleaks secret scan of the full git history (pinned binary, config in
  `.gitleaks.toml`, which allowlists only the public Firebase web API key by exact value). Vercel's
  own build would catch a broken build, but not these. GitHub's own secret scanning and push
  protection are repo settings (Settings -> Advanced Security), not files in the repo.

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
styled-components, or Tailwind. The fonts are loaded by non-blocking `<link>`s in `index.html`, never by an `@import`
in that runtime stylesheet: an `@import` holds back the whole stylesheet until it loads, which showed
the app unstyled for a moment on slow connections (the visually hidden `<h1>` appearing as a second
title, the layout stretched). `index.html` also holds the launch screen (`#splash`: the dp mark on black, plain HTML
plus a small script that fades it out once `#root` has content, after at least 600ms, with a 4s
safety timeout). A tiny inline script in `index.html` reads a `hw-bg` localStorage
key (kept in sync with the active theme's background by `App.tsx`) and paints it on `<html>`
before React mounts, to avoid a flash of the default background for returning dark-theme users.

**State & persistence.** All app state (tasks, theme, layout, subjects, notification
prefs, etc.) lives in `HomeworkPlanner`, persisted to `localStorage` under `hw-*` keys.
`localStorage` is the source of truth for signed-out/offline use; Firestore (when signed in with
Google via Firebase Auth) is a sync layer on top of it. Most simple fields (no extra
validation/merge logic on read) use `usePersistedState(key, initial)` — a small hook
(`src/hooks/usePersistedState.ts`) replacing the repeated `useState` + localStorage `useEffect`
pair. It JSON-serializes on write, and on read falls back to the raw string if `JSON.parse` throws
— several fields predate the hook and stored plain unquoted strings (e.g. `"list"`, not
`'"list"'`), and this keeps those intact on the first load after adopting the hook rather than
silently resetting them to the default. Fields with real extra logic on read (`tasks` — order
backfill; `subjectColors` — merges with defaults; `accentOverride` — `removeItem` instead of
writing `null`; `dismissedWhatsNew` — one-time migration from the old whole-feed `hw-whatsnew`
key, see What's New below) are deliberately left as hand-written
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

**App Check.** Live and **enforced** for Cloud Firestore and Authentication (since 2026-09-23):
requests without a valid App Check token are rejected, so scripts using the public `firebaseConfig`
can't reach the data -- this is the write-rate/abuse protection that `firestore.rules` can't
provide. The token comes from reCAPTCHA Enterprise (score-based, invisible) via the site key in
Vercel's `VITE_RECAPTCHA_SITE_KEY` env var (not a secret); the key allows `dueplanner.vercel.app`
only, so **a new domain (e.g. the custom one) must be added to the reCAPTCHA key before switching**,
or every request from it is rejected. Automated/headless browsers get a low score and are refused
(403 from the token exchange) -- expected, not a bug. Local `npm run dev` against production has
no key, so it's rejected too: register a debug token (App Check -> Apps -> Manage debug tokens) and
set `self.FIREBASE_APPCHECK_DEBUG_TOKEN` before init, or use emulator mode (below), which App Check
doesn't apply to. If sign-in or sync ever breaks for real users, "Unenforce" on the App Check -> APIs
page undoes it instantly.

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
- `users/{uid}` — small "profile" fields only: `layout`, `colorCodeUrgency`, `subjects`,
  `subjectColors`, `timeFormat` (`"12h"`/`"24h"`), `weekStart` (0 = Sunday, 1 = Monday) (a legacy `scratchpad` field may still exist on old docs; nothing reads it now that
  the Tools tab is gone). Synced as a whole document
  (it's small and doesn't grow unboundedly), gated behind `profileSyncedForUid` so the first write
  after sign-in can't race ahead of the first read. `themeName` isn't a field here (or in
  `firestore.rules`'s `isValidProfile`) -- see Design-system constants below: it's a derived value
  now, not independent state, so there's nothing to sync.
- `users/{uid}/tasks/{taskId}` — one document per live task (`taskId` is `String(task.id)`), plus
  an `updatedAt` (when the edit happened). `users/{uid}/trash/{taskId}` — Recently deleted: the
  whole task plus `deletedAt`. Trash is a separate collection, not a flag on `tasks/` docs, so an
  older app version still open on another device sees a plain delete rather than the task
  reappearing. Emptying the trash / the 30-day cleanup deletes the doc for real.
- `users/{uid}/meta/devices` — the devices signed in to the account, as one map
  (`{ d: { deviceId: { name, createdAt, lastSeen } } }`), capped at 20 by the rules. See Devices below.
- **Conflict handling** (`src/lib/sync.ts`, unit-tested): `baseRef` holds what we last knew the cloud
  held per task, `dirtyAtRef` when this device last changed a task it hasn't written yet. Incoming
  snapshots (both collections; merging waits until each has arrived once) are merged, not applied
  wholesale: an untouched task takes the cloud version; one changed on both sides is merged field
  by field (a field only one side changed takes that side; a field both changed takes the newer
  edit; delete vs. edit is newest-wins). This fixes the old bug where another device's change
  arriving within the 400ms write delay overwrote an unsaved edit. Writes are one small
  `writeBatch` per changed task (so one rejected write can't sink the rest), and an edit to an
  existing task is a merge write of only its changed fields (removed fields -> `deleteField()`).
  `baseRef` is updated optimistically at write time -- Firestore applies the write to its cache
  immediately and retries it. `syncUidRef` resets this state when the account changes.
- Sync status: both listeners use `includeMetadataChanges` so `lastSyncedAt`/`hasPendingWrites`
  track when writes reach the server; with `online` (browser online/offline events) they drive
  `syncStatus` ("Synced 2m ago" / "Saving..." / "Offline ...") inside the Profile screen (no longer under Profile in the title menu, which only shows a sync error), plus
  an "offline" note under the wordmark when signed in.
- An earlier version of this app stored the whole task array as one field on `users/{uid}`, which
  had every edit rewrite every task ever created and could eventually hit Firestore's 1MB
  per-document limit for a long-time user. A one-time migration effect (gated by `readyForUid`,
  which both live listeners wait on) checks for that legacy `tasks` field on sign-in and, if found,
  copies it into the subcollection *before* clearing it — new docs are confirmed written first, so
  an interrupted migration just retries next load instead of losing data.
- An empty tasks subcollection is ambiguous (brand-new account with nothing synced yet, vs. a
  returning account that legitimately has zero tasks) -- `isNewAccountForUid` (set from whether a
  profile doc existed at all when migration was checked) disambiguates it, so a first sign-in
  doesn't wipe tasks added while signed out before they've had a chance to sync up. (The app no longer
  seeds example tasks: a new list starts empty. `LEGACY_EXAMPLE_TASKS` only exists to recognise the old
  four, which are cleared once per device if untouched, `hw-examples-removed`.)
- The outbound tasks write is debounced 400ms behind local state, since drag-to-reorder calls `setTasks()` once per card the dragged item passes over --
  without this, a single reorder drag would fire one Firestore write per intermediate step instead
  of one at the end. Local state and `localStorage` stay instant regardless; only the cloud write
  is delayed. The pending write is kept in `pendingTasksWrite` so `signOutFirebase` can flush it
  before signing out (capped at 3s, since offline a write only resolves once it reaches the
  server) -- sign-out then clears local tasks/subjects from the device (they come back
  from the cloud on the next sign-in), since signed-out use is local-only.
- `firestore.rules` validates the shape of profile/task writes (required fields present, correct
  types, enums, capped string lengths, capped list/map sizes and field counts), not just who's making
  them. The size limits live in `src/lib/limits.ts` (`LIMITS`, unit-tested) and the app stays inside
  them -- subtask/tag/subject inputs stop at the cap, `addSession()` drops the oldest session past
  1000, and JSON import runs `sanitizeTask()` -- because a write over a rules cap saves locally but is
  silently refused by the cloud. Change a limit in both places; `tests/firestore.rules.test.ts`
  checks the rules side.
- **Task counter / per-account cap.** Rules can't count a collection, so `users/{uid}/meta/counts`
  (`n` = docs in tasks/, `t` = docs in trash/, `last` = the task id the latest change was about)
  does. Every batch that creates, deletes or moves a task bumps it (`countDelta()` in
  `src/lib/sync.ts`; batches are built by `addTaskWrite()` in `src/lib/taskWrites.ts`, shared with
  `tests/firestore.counter.test.ts` so the rules are tested against the app's real writes). The
  rules check each change against which docs actually exist before/after the batch, cap creates at
  5000 tasks / 500 trash entries, never block deletes, start the doc at zero (pre-existing tasks
  just aren't counted) and forbid deleting it (else delete+recreate would reset the cap, so it
  outlives account deletion, holding only numbers). The prepare effect creates it at sign-in; if
  that check fails (offline, nothing cached) it queues the creation anyway, since every write is
  counted and the rules refuse an uncounted create. A write rejected because this device's
  view was stale is retried once from what really exists (`addTaskWriteFromActual`). `enforceTaskCap()`
  in `firestore.rules` is `true` (phase B, since 2026-09-22): a create without the counter is
  refused. It was `false` (phase A) for the rollout; setting it back is the escape hatch if creates
  ever fail for a reason the counter gets wrong. An app version from before the counter can still
  edit/complete/delete, but a task it *creates* is refused and then dropped by its own merge -- so
  after changing anything here, reload every open copy before adding tasks. The shape tests in
  `tests/firestore.rules.test.ts` load the rules with it off; `tests/firestore.counter.test.ts`
  covers both settings. Write rate limiting is left to App Check (see below), not rules.
- **In-flight writes vs. the two listeners.** One batch can touch tasks/ and trash/ (moving a task
  to Recently deleted), but the two `onSnapshot` listeners hear about it separately, so for a
  moment the task looks gone from both -- which the merge used to read as a remote delete, wiping
  the trash entry locally and then in the cloud. `inFlightRef` counts un-acked writes per task id;
  while one is pending the merge uses what we wrote instead of the cloud's in-between state, and
  `applyRef` re-merges when it lands. -- a second layer beyond
  auth-based ownership, since `firebaseConfig` being public means anyone could otherwise script
  requests directly against the project, bounded only by whatever the rules allow.
- Firestore is initialized with `persistentLocalCache`/`persistentMultipleTabManager` for
  IndexedDB-backed offline support (works offline, repeat loads read from local cache first) with
  multiple open tabs sharing one cache. Wrapped in try/catch with a plain in-memory fallback, since
  this runs at module load time before React renders -- an uncaught throw here would blank-page the
  whole app in an exotic environment instead of just missing offline support.
- Account deletion (Options tab, "Danger Zone", gated on being signed in) batch-deletes every doc
  in the tasks and trash subcollections plus the profile doc, then calls Firebase Auth's `deleteUser`, then
  clears every `hw-*` localStorage key and reloads -- "delete my data" means all of it, not just
  the cloud copy (except the task counter doc, which rules keep undeletable). The device list doc
  is deleted too, which signs the account's other devices out. Gated behind a
  type-`DELETE`-to-confirm panel rather than a plain `window.confirm`, given it's irreversible.
  Deletes in chunks of 450 (Firestore's batch limit is 500; an account can hold ~5,500 docs), with
  the profile doc last so an interrupted run can be retried.

**Devices (Profile → Devices).** Lists the devices signed in to the account and lets one sign the
others out. There is no backend, and a web app can't cancel another device's Google sign-in, so
this is cooperative: each device keeps an entry in `users/{uid}/meta/devices`, watches that doc, and
signs itself out (`signOutFirebase`, then a message on the sign-in screen) when the server says its
entry is gone. So a device signs out the next time it has the app open and online, and it is not a
defence against a stolen session; the Profile note says both. Don't describe it as more than that.
The logic is `deviceAction()` in `src/lib/devices.ts` (unit-tested), driven by the Devices effect in
`HomeworkPlanner` (declared below `recaps`, since it holds `signOutFirebase` in a ref and the React
Compiler rejects forward references). The safety rules, each of which exists to make a wrongful
sign-out impossible:
- Only a snapshot straight from the server counts (`!fromCache && !hasPendingWrites`).
- `hw-device-registered` (the uid) is written only after the server has *accepted* this device's
  entry (`setDoc(...).then`). Without it a missing entry means "add me", never "signed out". So a
  first write that never arrived (offline, or the rules not deployed) can't sign anyone out.
- If the doc can't be read, the listener's error handler does nothing: Profile says the list isn't
  available and everything else carries on. The app is therefore safe to ship before the rules.
- `signingOut` (a ref) is set while this device signs itself out, so removing its own entry isn't
  read as another device doing it.
- "Last active" is refreshed at most every 12h with `updateDoc` on `d.<id>.lastSeen`. If that races
  a removal it can leave a stub with no `name`; a stub counts as removed.
- Ids are 24 hex characters (`hw-device-id`, kept across sign-outs): a dot in a map key would be
  read as a path. Registering past 20 devices drops the longest idle (`pruneDevices`).
Sign-out removes this device's entry (best effort, capped at 2s); account deletion deletes the doc
in its own try/catch so it can never block the deletion. `tests/firestore.rules.test.ts` covers the
rules; the two-device flow was checked end to end against the Auth and Firestore emulators.

**Profile housekeeping.** Below the stats, the signed-in Profile has three cards: Devices (above),
Storage (`tasks.length` against `LIMITS.tasks` and `trash.length` against `LIMITS.trash`: the real
counts on the device, not the cloud counter, which started at zero and reads low for older
accounts), and This device (install the app via `requestInstall()`, reminders on or off for this
device via `toggleNotifications`, the feedback form and the privacy policy).

**Design-system constants** drive both the inline styles and the runtime stylesheet. `THEMES`
(`src/themes.ts`) went from 26 color themes down to exactly two -- `stealth` (dark) and
`stealthLight`, a literal per-channel RGB inversion of `stealth`'s achromatic grays (near-white bg
instead of near-black, pure black accent instead of pure white; `textMuted` needed a small manual
nudge afterward, since a naive hex inversion doesn't perfectly preserve WCAG contrast ratios -- sRGB
gamma correction means relative luminance isn't linear in raw channel space). `textFaint` needed the
same kind of manual correction on *both* themes, for a different reason: `scripts/check-theme-
contrast.ts` originally didn't check `textFaint` at all, so `stealth`'s own original value
(`#333333` on `#0a0a0a`, 1.57:1) had shipped with a contrast ratio close to invisible, and its
mechanical inversion (`#cccccc` on `#f5f5f5`, 1.47:1) inherited the same problem -- except low
contrast on a *dark* background reads as moody/intentional, while the same trick on a *light*
background just looks broken, which is what surfaced it. The script now checks `textFaint` too
(against the large-text/UI-component 3:1 bar, not full-text 4.5:1, since it's deliberately the
lowest-emphasis tier) and both themes' `textFaint` were nudged to actually clear that. With exactly one
theme per light/dark category, `themeName` in `App.tsx` is a plain derived `const`
(`effectiveThemeMode==="light"?"stealthLight":"stealth"`), not state -- light/dark/auto
(`themeMode`, labeled "System" in the UI) is still a real user choice (incl. following system
preference), but which of the two themes that resolves to is fully determined by it, so there's
nothing left to persist, sync, or correct; the old `themeByMode` "remember last picked theme per
category" mechanism and its Firestore/localStorage sync are gone entirely, since there's nothing
left to remember. The "Theme" picker grid and the "Custom Accent" color picker (`accentOverride`
state, `hw-accent` localStorage key) are both gone from Options -- the latter because it let
`T.accent` (`accentOverride||base.accent`) get permanently hijacked away from the active theme's
own black/white accent by a stray custom color, which is exactly what caused several places that
read `color:T.accent` directly (the header wordmark, the selected Appearance button, the Stats
numbers) to render with a leftover light/invisible color in Stealth Light regardless of which
theme was actually selected. `T.accent` is now simply `base.accent`, no override possible; a
one-time `localStorage.removeItem("hw-accent")` on mount clears any stale value already saved by
existing users' browsers rather than leaving a dead key around.
One correctness fix from this worth knowing regardless of future palette changes: 21 call sites
across the file style buttons/checkmarks as `background:T.accent, color:"#000"` (hardcoded,
`border:"none"` on most), an assumption that only holds if `accent` is always bright enough for
black text -- true for every one of the other 25 (now deleted) colorful themes, but broken by
`stealthLight`'s pure-black accent (would've rendered black-on-black with no border to even show
the button's shape). All of those now use the existing `contrastColor(T.accent)` helper
(`src/lib/format.ts` -- WCAG-luminance-based black/white text picker, already used elsewhere e.g.
the `Toggle` switch thumb) instead of a hardcoded color, so they stay correct under any accent color
a future theme might use. A few needed a conditional version since they only sometimes render on a
solid `T.accent` fill (e.g. task-done checkmarks default to a fixed green `#2ED573`, not `T.accent`,
in most layouts -- only the branches that actually use `T.accent` as the fill needed the fix).
`LAYOUTS` (6 task-list display modes, still in `App.tsx`; Compact, Minimal, Sticky, Timeline, By Subject and Calendar -- replaced by the Calendar tab -- were removed -- a saved removed layout falls back to List via the derived `layout` const). `FONTS` went the same way
as `THEMES` -- down from 16 selectable heading/body pairings to exactly one (`FONT`, still in
`App.tsx`: the original DM Serif Display/DM Mono pairing), with the Font picker grid and its
`fontName`/`setFontName` state gone entirely. `F` is now just `FONT` directly rather than a keyed
lookup. A one-time `localStorage.removeItem("hw-font")` on mount clears any stale per-user font
choice already saved by existing users' browsers, mirroring the `hw-accent` cleanup above.

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
- `timeLeft.ts`: `dueBucket` / `mostUrgent` -- behind the header's "Time left" dropdown (time
  split by due date, time worked per subject, a "no estimate" link that sets the hidden
  `filter==="noest"` view).
- `calendar.ts`: `monthGrid` (6 fixed rows of 7 local dates, honoring `weekStart`) / `monthOnlyGrid` (the same with
  other months' days as null and empty weeks dropped) / `shiftMonth` /
  `weekdayLabels` / `byDueDate` -- behind the Calendar tab.
- `download.ts`: `downloadFile` — the `Blob` + object URL + synthetic `<a download>` click pattern
  used by data export.

**Sidebar.** All navigation lives in one sidebar (`<nav className="app-sidebar">`, rendered beside
`.app-inner` inside `.app-shell`); it replaced the three-button tab bar, the title dropdown under the
DuePlanner wordmark and the Desktop Layout setting (`hw-desktoplayout`, cleared once). Top to bottom:
the profile row (picture, name, sync status; opens Profile, or reads "Sign in"), the fold button,
Search (opens `SearchOverlay`), Home (`activeTab==="tasks"`) / Calendar / Focus (shows a running
timer), the subjects (below), Inbox (unread count) / History / Import/Export / Settings, and a "DuePlanner, by due. studios" line at the foot. Rows
are `SidebarRow` (module scope, `.sb-row` in the runtime css, `aria-current="page"` on the screen
being shown). From 900px up it is fixed in place and the page is padded to make room (`--sb`, which
also re-centers the viewport-centered toasts), unless folded away (`sidebarFolded`,
`hw-sidebar-folded`, local-only, class `.sb-folded`). Below 900px it is a drawer (`drawerOpen`, class
`.sb-drawer`, backdrop `.sb-backdrop`): the header's sidebar button (`.sb-open-btn`, the `IconSidebar` icon) opens it, as does a
swipe in from the left 16px of the screen; a swipe left, the backdrop, Escape or picking a row closes
it. Closed, it is `visibility:hidden`, so it is out of the tab order with no extra code;
`openSidebar()`/`closeSidebar()` pick fold vs. drawer with `isWideScreen()`, which must match the css
breakpoint. The header always shows the screen's name (`SCREEN_TITLES`); it used to swap with a dp logo depending
on whether the sidebar was showing, which the user disliked (2026-10-10), so don't put a logo back
there. Wide and unfolded, the css hides the sidebar button, `ScreenHeader` (`.screen-header`, now
only the "‹ Home" back button) and the header's timer pill (`.timer-pill`, a running
Pomodoro/stopwatch that opens Focus), since the sidebar covers all three. The dp mark isn't in the app at
all now (also removed from the sidebar's foot at the user's request); it remains the favicon and the
launch screen. **Subjects in the sidebar** (`SidebarSubjects`, module scope; groups from `subjectGroups()` in
`src/lib/sidebarSubjects.ts`, unit-tested): every subject in the user's order, even with nothing
open, then subjects that only exist on tasks, then "No subject" (name `""`) when it has tasks. Each
is two buttons: the arrow unfolds its open tasks (`openSubjects`, `hw-sidebar-subjects-open`,
local-only), most urgent first, `SIDEBAR_TASK_CAP` (8) of them until "Show all"; the name sets
`subjectFilter`, which narrows `filteredTasks` on Home on top of the filter chips. Picking it again,
the Home row, or the subject's chip in the filter row clears it, as does a "Take me there" to the
task list. Read it through `subjectFilterOn`, which ignores a filter whose subject no longer has a
row (renamed, deleted, emptied). A nested task has no checkbox; clicking it opens the task page.

**Task page.** A task opened from the sidebar is a whole screen, not the sheet: `openTaskPage()` sets
`selectedTask` and `activeTab` to `"task"`, and the same `taskDetail` element (`TaskModal`) is
rendered inside `<main>` with `page` set instead of over the page. Everything that used to test
`selectedTask!=null` for "a sheet is covering the page" (inert, pull to reload, the drawer swipe)
tests `sheetTaskOpen` instead. In its `page` form `TaskModal` has no overlay, dialog role, focus
trap, drag or scroll lock, and no Edit, Save, Cancel or close buttons: the title is a field in the
heading and the edit form is always open. There's no draft to confirm, so `commitDraft()` saves a
field when focus leaves it (the form's `onBlur`, the title's own) and a choice (subject, repeat, the
"No due date/time" links) at once, and only when something really changed, so each save is one undo
step rather than one per keystroke. The fields are refilled from the task whenever its saved values
change (`taskSig`). Mark done and Archive keep the page open (the sheet closes); Delete goes Home. The page has no Snooze row (removed at the user's request, 2026-10-10; the sheet keeps it).
Leave the page through `navTo()`, which calls `leaveTaskPage()` to end and log a session running on
it (both declared below `endSession`, for the React Compiler's forward-reference check); a tab
change that bypasses it still clears `selectedTask` (the `lastTab` block), so the task can't
reappear as a sheet. Tasks opened anywhere else (Home, Calendar, search) still open the sheet.

**UI shape.** The sidebar's Home, Calendar (below) and Focus rows are the main screens; Focus opens the
separate full-screen Focus Mode (`focusMode` state) with its Pomodoro timer (clock-based: it counts
down to a fixed end time, as the task session timer counts up from a fixed start, because browsers
slow or pause intervals in background tabs and on locked screens; the running time shows
on the sidebar's Focus row and the header pill; finishing chimes via `playChime()`, notifies, and toasts). Settings
(`activeTab==="options"`) has its own header
with a back button (shown where the sidebar isn't). The sidebar's lower rows are Profile (a modal, the top row), then Inbox (recap
messages, What's New), History (undo/redo, Recently deleted), Import/Export (syllabus import,
backups) and Settings, each a full screen (`activeTab` "inbox"/"history"/"import"/"options") with
the shared `ScreenHeader` (the ‹ Home back button); tapping "Time left" in the header opens a
per-subject time breakdown. The sidebar's icons (`IconTasks`/`IconFocus`/
`IconImport`/`IconSettings` etc., module scope, just above `FONT`) are
small hand-built SVGs from plain primitives (line/circle/polyline) rather than Unicode glyphs or an
icon library dependency, styled with `stroke="currentColor"` so they pick up the button's active/
inactive `color` automatically; `aria-label`/`title` on each button carry the accessible name now
that there's no visible text. `TaskModal` (task detail, subtasks, session timer) is defined at module
scope, outside `HomeworkPlanner`, specifically so the session timer's once-a-second tick doesn't
redefine it as a "new" component and force React to remount the modal every second. It hand-rolls a
focus trap (Tab/Shift+Tab cycle within the panel, focus-return to whatever opened it on close,
Escape-to-close unless a session is active) since it's a custom `<div>` overlay rather than a
native `<dialog>`; the trap effect intentionally runs once (mount/unmount only) and reads
`sessionActive`/`onClose` through refs rather than including them as effect deps, so it doesn't
re-steal focus into the first element on every unrelated re-render. Dragging the sheet moves it: on touch, a downward pull anywhere on it
while its content is scrolled to the top (native touch listeners with a non-passive `touchmove`, so
the page behind can't scroll instead; the page is also scroll-locked while it's open), and with a
mouse, its top handle (pointer events, `data-sheet-handle`). It
(follows the finger, rubber-bands upward, backdrop fades) and on release it springs back or flies
off and closes, carrying the finger's velocity (`src/lib/spring.ts`, unit-tested; driven through refs
and direct style writes, not state, so a drag doesn't re-render the modal per frame; reduced motion
snaps/closes instantly). `TaskModal`'s render site in
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
- `sessions?: {mins, at}[]` — work sessions logged by `TaskModal`'s timer. Stored (and synced) on the
  task so "Sessions today" survives closing the modal, and the Inbox's "Time spent" sums these
  (real time) rather than estimates.
- `spawnedNextId?: number|null` — set on a recurring task when completing it spawns the next
  occurrence (see `setDone()`, module scope), so un-completing removes that copy instead of leaving a
  duplicate. The copy gets unchecked subtasks and keeps no due date if the original had none.
- `estMins` can be 0 (estimate step skipped); every display goes through `formatDuration()`
  (`src/lib/format.ts`), which returns "" for 0 so the label is hidden rather than showing "0m".

**Undo history.** `HistoryAction` is either `"delete"` (ties into Recently deleted) or `"change"`:
each affected task's full state before and after (`src/lib/history.ts`, `diffTasks`/
`applyTaskStates`), recorded per task rather than as a whole-list copy so undoing one change
can't roll back unrelated edits made since (e.g. synced from another device). Anything that
should be undoable goes through `changeTasks(fn, label, toast)` -- completing (incl. the spawned
repeat copy), the Edit panel (`editTask`), archive/restore, snooze, skip, and bulk actions.
Subtask ticks, tags and priority overrides are deliberately not undoable (too noisy).

**Empty fields aren't labeled.** A task with no due date or no subtasks shows nothing there -- no
"No date"/"No subtasks" text (`formatDate("")` still returns "No date" for other callers, so guard
display sites with `task.dueDate&&`). Where undated tasks are grouped (group by due
date, Time left buckets) the heading is "Anytime".

**Smart suggestion** (the ✦ card above the list): its × hides only the current suggestion
(`hiddenSuggestionFor`, `hw-suggestion-hidden`, the top task's id); it returns when a different task
becomes most urgent. `showSuggestion` (Settings → Task list) turns it off entirely.

**Settings layout.** Every Settings section is a `SettingsSection` dropdown (module scope): Looks,
Date & time, Focus timer, New task questions, Subjects, Task list (group by, smart suggestion, show
completed, auto-archive), Reminders, and Danger Zone when signed in. Bodies render only while open;
which are open is `openSettings` (plain state, not saved: they all close when `activeTab` leaves
"options"), and `goTo()` opens the section
holding a "Take me there" anchor before highlighting it -- a new section with an anchor needs an
entry in that map. Feedback, Clear completed and the version line stay outside the dropdowns.

**Settings extras.** Subjects can be renamed/recolored (`updateSubject`, carries the rename to
tasks, trash and templates). Date & time: `timeFormat` (`formatTime(t, h24)`, passed to
`TaskModal`/`MiniCard` as `h24`) and `weekStart` (`startOfWeek()` in `src/lib/dates.ts`, used by
the Inbox's weekly recap).

**Task detail actions.** `TaskModal` can edit a task's own fields (an Edit panel, via
`onUpdateTask(patch)` -> `updateTask`; its estimate hours/minutes are digit-only text fields kept as
strings, not `type="number"`, and minutes past 59 roll into hours on save; `.edit-field` gets 16px
text on touch screens so iOS doesn't zoom in on focus), snooze it (`snoozeTarget()`, module scope, since the
React Compiler's purity lint rejects `Date.now()` inside component functions; `snoozeTask` records it
in the undo history as an `"edit"` `HistoryAction` with the before/after due date and time, so it
shares the undo toast and History menu with deletes), duplicate it
(`duplicateTask`: fresh id, unchecked subtasks, no sessions, detached from any repeat chain) and
restore it from the archive. **Recently deleted** (`trash`, `hw-trash`; synced via `users/{uid}/trash`
when signed in, see the Firestore data model above): every delete also lands here for 30 days (pruned on load, capped at 200), restorable from the
History menu; undo/redo of a delete keeps it in step. **Focus Mode** targets `focusTask` (`focusTaskId`, falling back to
the first pending task); a finished Pomodoro logs a session of the configured length to it (read
through `pomodoroTaskRef`, since the finish effect is declared before `focusTask` is computed), and
an unfinished one still counts: `creditPomodoro(taskId)` logs the not-yet-logged part of the current
focus session when the timer is reset, the focus task is switched, or it's marked done from Focus
Mode (`pomCredited` tracks what's already logged, so the finish effect only adds the remainder), and a
Screen Wake Lock is held while Focus Mode is open. The Pomodoro alternates `pomodoroPhase`
work/break; lengths and auto-start-breaks are local-only settings (`hw-pomodoro-*`, Settings ->
Focus timer). When a break ends, `breakEnded` shows a suggestion (`nextSuggestion`: the task just
worked on if still open, else `mostUrgent`) as a card in Focus Mode or a toast elsewhere, with a
one-tap Start. Focus Mode also has a **stopwatch** (`swStartedAt`/`swBanked`/
`swElapsed`, clock-based, keeps running outside Focus Mode, shown on the Focus button when the
Pomodoro isn't running); "Log Xm to task" (`saveStopwatch`) adds a session to `focusTask` and resets
it. `focusShow` (`hw-focus-show`, local-only, Settings -> Focus timer -> Show in Focus; options
and helpers in `src/lib/stopwatch.ts`) decides which timers show; Settings presents it as two
switches, Pomodoro and Stopwatch (`focusShowFor()` maps them to the stored value), and hides the
Pomodoro's length settings while it's off. In Focus Mode the order is Pomodoro, task, stopwatch,
centered as a group. **JSON import** (`importBackupJSON`) merges an
export: tasks with ids already present are skipped, subjects/templates added if missing, existing
subject colors win, settings untouched.

**What's New** (`WHATS_NEW`, the Inbox's Updates list) is hand-maintained, newest first -- add an
entry whenever a user-facing change ships. Each entry has a `kind` (category: "New feature", "Bug
fix"...), a `headline` (its short title), the `description`, and a `where` -- how to get to it,
using the on-screen labels ("Sidebar (top left button) → Settings → ..."), shown as "Where to find it"
in the update's card. Give every entry a `where` unless there's genuinely nowhere to point. Also give it a
`go` when there's a screen to open: `"place"` or `"place:anchor"`, handled by `goTo()` in
`HomeworkPlanner` (places: `settings`, `tasks`, `task` -- opens a real task, a repeating one for
`task-skip` -- `history`, `import`, `menu` -- opens the sidebar; an anchor starting `tab-` (a sidebar row) opens it too -- `profile`, `focus`). The anchor is a `data-tour="..."` attribute on the thing to highlight; `flashTarget()`
(module scope) waits for it to render, scrolls it into view, focuses it if it's a control and rings
it with an inset shadow (not clipped by `overflow:hidden` parents). A new feature's control usually
needs a new `data-tour` for its entry. The card's "Take me there" button fades the card, then calls
`goTo`. It shows where things are rather than doing them (points at Select, doesn't start selecting). Tapping a row opens
`UpdateDetail` (module scope): the card grows from the row's box to a centered card over a blurred
backdrop (pinned `position:fixed` while its left/top/width/height animate, then released back to
`relative`) and shrinks back into the row on close, or fades if the row is gone. Back/Next step
through the list in place (content fades in, with no sideways slide, at the user's request; card eases to the new height; the grow-from-row
animation runs once on open, from `openedFrom`, even though `origin` follows the shown update); Dismiss dismisses after the exit animation. It carries `data-keeps-menu`, which
the title menu's outside-click/Escape handlers ignore (a leftover from when the Inbox lived in the
menu; harmless now that it's a screen). The Inbox's two parts (Messages, Updates) are
`SettingsSection` dropdowns (`openInbox`, not persisted: they start closed and close again when `activeTab` leaves the
screen, tracked by `lastTab`, like Settings; the Import/Export screen's two
sections, Import from Syllabus and Backup & export, are dropdowns in the same list). **Messages** are
recaps (`src/lib/recaps.ts`, unit-tested): when a day, week, month or year ends, an effect in
`HomeworkPlanner` writes a snapshot (finished count, logged minutes, on-time count, busiest
subject, finished titles) into `recaps` (`hw-recaps`, local-only, newest 60), skipping periods
where nothing was finished or worked on. `recapsChecked` (`hw-recaps-checked`) is the last date
it ran, so a period is written once even if its recap is dismissed; days catch up at most a week,
and only the latest week/month/year is considered. It waits for the first sync when signed in, and
sign-out clears both. `recapMessage()` turns a recap into a `WhatsNewItem` (ids start `recap-`,
`list` holds the finished titles) so it opens in the same `UpdateDetail` card; unread ones show
a dot and a count on the menu's Inbox row. These replaced the old live "Done today" and
"Personal" stats panels. Updates
has filter chips, one per `kind` still showing (`updateKinds`, ordered by `UPDATE_KIND_ORDER`);
`shownUpdates` is what the list and `UpdateDetail`'s Back/Next use, so reuse an existing `kind`
rather than inventing a near-duplicate. Only dismissed ids are persisted
(`hw-whatsnew-dismissed`), so new entries reach returning users; `LEGACY_WHATSNEW_IDS` is a frozen
list used once to migrate the old whole-feed `hw-whatsnew` key, and must not be extended.

**Subjects** are managed in Settings (not Profile), so they work signed out; they and their colors
sync via the profile doc when signed in.

**Urgency color coding** (`colorCodeUrgency` state, "Urgency Color Coding" toggle in Options ->
Looks, default on) gates every place `PRIORITY_COLORS` (red/orange/green) would otherwise show.
Rather than each call site branching on the setting itself, they all go through
`priColor(pr, colorCode)`, which returns `PRIORITY_COLORS[pr]` when on or one flat neutral gray
(`NEUTRAL_PRIORITY_COLOR`) when off -- so turning it off doesn't require touching layout, only
swapping which color resolves. This is the same "single helper, many call sites" shape as
`contrastColor()`.

**Liquid Glass** (`liquidGlass` state, `hw-liquid-glass` localStorage key, "Liquid Glass" toggle in
Options -> Looks, default off, local-only) swaps the theme's surface tokens (`card`/`cardAlt`/
`surface`/`border`/`borderAccent`) for translucent `rgba()` values when building `T`, adds a fixed
background glow (`.app-shell::before`), (the tab bar that carried its sheen and sliding "lens" pill is gone; the sidebar is plain).
Card highlights/shadows and floating-element blur are applied from the runtime stylesheet via
attribute selectors matching the glass border value in the browser-normalized inline `style`
(e.g. `border: 1px solid rgba(255, 255, 255, 0.11)`), not by editing each inline style -- so
changing those border values means the selectors follow automatically, but a new card that uses a
different border won't pick up the effect. A pointer highlight follows the mouse, or a finger while it's touching the screen (touch
events, since they keep firing during scroll; cleared 250ms after lift): an effect sets
`--glass-x`/`--glass-y` on the glass card under the point (and glass cards containing it), relative to
each card's own box, and a radial gradient keyed to `glassCardSel` draws it -- per-card rather than
one `background-attachment:fixed` layer because task cards lift with a transform on hover, which
breaks fixed backgrounds. Device tilt deliberately doesn't drive it. Since glass tokens aren't hex, never append a hex alpha
suffix to them (`T.border+"33"`); use `T.borderFaint` for a lighter divider, and `T.solidBorder`
wherever a real hex is required (e.g. `contrastColor()`).

**Animation speed** (`animSpeed`, `hw-anim-speed`, a slider in Settings -> Looks, 0.5x to 2x,
local-only) is applied globally by `src/lib/animSpeed.ts` instead of per call site: it wraps
`Element.prototype.animate` once and listens for `transitionrun`/`animationstart` on the
document, setting each animation's `playbackRate`. So a new CSS transition or `.animate()` call
follows the setting with no extra work, but a `setTimeout` that waits out an animation must use
`scaledMs()` (as the 640ms completion hold does), and rAF-driven motion multiplies its time step by
`animationRate()` (as `TaskModal`'s sheet spring does).

**Completing a task** (`toggleDone`) animates unless reduced motion is on: the id sits in
`justDone` for 640ms, during which `allSorted`/`filteredTasks` keep the card where it was while
`CheckMark` (module scope, an SVG stroke) draws in and the title's `.strike` (a background line,
not `text-decoration`, so it can animate) draws across. Then `captureTaskRects()` records every
`[data-task-id]` card's position and a `useLayoutEffect` FLIP-animates each card from its old spot
to its new one: the farthest-moving card (the completed one) lifts slightly (scale 1.025, raised
z-index) and slides the whole way down over ~1.3-1.8s at an even pace, while the others make room in
under ~1s. The same FLIP engine animates other list changes: `captureTaskRects(mode)` is called right
before the state change -- `"settle"` (completion, above), `"shift"` (filter chips,
add/duplicate, `deleteTasks`, `changeTasks` so every bulk/archive/snooze/edit, undo/redo; ~0.35-0.5s)
or `"quick"` (keyboard reorder, 320ms). Moves are 2D (grid/column layouts move sideways). Cards
with no "before" position fade/rise in; cards that left are faded out by a stand-in: capture clones
each on-screen card, and the effect pins the clone `position:fixed` over the old spot (no
`data-task-id`, `aria-hidden`, `inert`) and removes it after. Every layout's card root carries
`data-task-id` (checklist: the outer swipe wrapper). A capture older than 1s is dropped, so a
no-op state change can't make a later unrelated render animate from stale positions. Reduced
motion skips capture entirely. Not animated on purpose: pointer drag-to-reorder (the dragged card
already follows the finger, and moving the others would shift what `elementFromPoint` hits,
flip-flopping the swap), layout switches, and changes arriving from sync (cards shouldn't move
under your finger). `glideClock()` (module scope) exists for the React Compiler purity lint.

**One move, not two.** Nothing should travel to a spot, pause, and travel again. The causes found so
far, each fixed, and what to keep doing:
- *Content that changes at the tick.* While a completed task is in its hold (`justDone`), nothing
  that sets a size may change: the card keeps its badge, drag handle and due label (`live` in
  `MiniCard`, `settled(t)` in the other layouts), ranks count it as still open (`pending` in
  `renderTasks`), and the suggestion card above the list does too (`suggestionTask`/`suggestion`,
  via `heldOpen`). Otherwise the list shifts once at the tick and again at the settle.
- *The completed card's lift* comes back down during the slide, not after it (two keyframe
  segments, not three).
- *Pinned cards* (`pin`/`unpin`, used by `UpdateDetail` and `GrowCard`): `unpin` restores the inline
  styles that were there before `pin`. Clearing them dropped the card's declared width, so on a wide
  screen it grew to its spot and then snapped to the window's width.
- *The task sheet's spring* must carry its speed from frame to frame (`v=st.vel` in `releaseSheet`);
  without it the sheet stalled part of the way back after a small drag.
- *Easing curves* never go past 1 (no `cubic-bezier(...,1.05)`): that is an overshoot.
- Kanban's columns are `minmax(0,1fr)`, so a column doesn't change width with what's in it.
To check, record each element's box on every frame while the interaction plays, with
`prefers-reduced-motion` forced off (a headless or remote browser often reports it on, which makes
the app skip its animations and everything look fine).

**Motion standard.** One look everywhere, taken from the Calendar tab: 0.2s, `ease-out`, a few pixels
of travel, no bounce or overshoot (the old `cubic-bezier(.34,1.x,.64,1)` curves are gone; don't add
new ones). Entrances are one of three classes in the runtime css: `.sec-body` (settles from above:
screens, dropdowns, panels), `.pop` (rises from below: the task sheet, cards) and `.fade-in` (opacity
only, for anything positioned with its own `transform` such as toasts, since an animated transform
would override it). State changes use `transition: … .2s ease-out`. The exceptions are deliberate:
progress fills and the timer ring, the shared-element opens (`UpdateDetail`, `DayDetail`, search) and
the FLIP list moves.

**Tab entrance.** The Tasks tab's content and Focus Mode's content are wrapped in `.sec-body`, the
same short fade-and-settle the Calendar grid and Settings sections use, so every tab opens alike. The title menu, the Time
left dropdown, Profile and the four menu screens (Inbox, History, Import/Export, Settings) carry it too.

**Layouts stay consistent** through shared helpers at the top of `renderTasks`: every layout's card is a
`[data-task-id]` wrapper (relative, clipped) holding the swipe reveal and the `.tc` card, so all six
swipe; `titleClass(t)` gives the done strike (and its draw-in), `dueText(t)` the due label (a live
countdown when due today at a time), and `settled(t)` decides when a completed task moves to a
Done column or tier (not while it's in `justDone`). Use these for any new layout.

**Swipes** on task cards lock in as soon as sideways movement is the larger direction (6px), give up
to scrolling only when vertical is larger (10px), and act past `SWIPE_THRESHOLD` (64px) or on a flick (over 600px/s after 24px). The earlier,
stricter rule (1.5x flatter than tall, 90px) dropped most real thumb swipes.

**Pull to reload** (`src/hooks/usePullToReload.ts`): in the installed app only (`isStandalone()`;
browser tabs have their own), pulling down 90px from the top of the page reloads it. Off while a
task, search, an Inbox message or Profile is open; ignores pulls that start on something scrollable,
a dialog, a field or the reorder handle.

**Search** is a floating panel, not an inline filter: the Tasks tab's "Search tasks..." field is
a button (`searchTriggerRef`, hidden while open) that opens `SearchOverlay` (module scope, like
`TaskModal`, so the `now` tick doesn't remount it and lose the query). The bar flies out of the
field (WAAPI translate + height) into the upper middle of the *visible* viewport
(`visualViewport`, so it stays above a phone keyboard) over a blurred backdrop (fixed to the
whole screen, not to that viewport box, and the page is scroll-locked while it's open), and flies back on
close (Cancel, Escape, backdrop tap). Results (title/subject/tag match, archived excluded,
pending first, max 50) are keyed by id with a `.search-pop` CSS animation, so each newly matching
task pops in while ones that still match stay put. Enter opens the first result, arrows walk the
list; `.app-inner` is `inert` while it's open, and focus returns to the field on close. The task
list itself is no longer filtered by search.

**Calendar tab** (`CalendarView`, module scope so the `now` tick doesn't reset the month): a month
grid (only that month's days by default; `calendarMonthOnly`, `hw-calendar-month-only`, local-only,
Settings -> Date & time -> Calendar shows, switches back to six full weeks with neighbouring days) where each day shows up to 3 subject-colored dots for its open tasks (the workload heatmap
shading was removed at the user's request; don't bring it back), and the selected day's tasks below
(check off, tap to open). Tapping a day also opens `DayDetail` (module scope), built on
`GrowCard`: a floating card that grows out of whatever was tapped and shrinks back on close (the same
pin/animate approach as `UpdateDetail`), locking page scroll in a layout effect *before* it measures
where to land. `GrowCard` takes a render function `(close, closeRef)`; `CardTaskRow` is the shared task
row. `DayDetail` is rendered inside `CalendarView` (so inside `.app-inner`, no focus trap). The Time
left dropdown's rows open `TimeDetail` the same way (`openTime`, rendered beside `UpdateDetail`, with
`.app-inner` inert): totals plus the open tasks of one due-date group or subject. Undated tasks aren't shown. Arrow keys move the selection (and focus) across
months; swiping the grid or ‹ › change month without changing the selected day (nothing is auto-selected
in the new month; `tabStop` keeps one day reachable by Tab), Today jumps back. "+ Add homework due <day>" calls
`addHomeworkOn()`: switches to Tasks and starts the usual add flow with the date pre-picked
(`pendingDueDate`, so the date question opens on "what time?"; if that question is off the date is
set directly). It replaced the old Calendar *layout* (a rolling week list). The tab has a Month/Deck switch
(`calendarView`, `hw-calendar-view`, local-only). **Deck** (`DueDeck`, module scope) is one card per
date that still has an open task or is today or later: a large date, that day's tasks (check off, tap
to open). It has no add button and no jump-to-today button (both removed at the user's request). Up to four cards are drawn: the ones behind sit lower and narrower (scaled from the bottom edge), so
their rims show under the top card as a visible stack; swiping the top
one left flies it off and the next rises, swiping right (or ‹, ArrowLeft) brings the earlier date
back in from the left. The top card is tracked by its date (`picked`), not its index, and defaults
to the first date from today on. Drag is direct style writes on the top card, like the task sheet.

**Accessibility conventions** (from the screen-reader/keyboard pass, checked with axe-core and the
Chrome accessibility tree):
- Task titles are `<span role="button" tabIndex={0} className="title-btn">` (looks like text,
  `all:unset`), and the reorder handle is a `div role="button"` -- not real `<button>`s, since those
  sit in the path of swipe/drag gestures and a `<button>` there can swallow the touch on iOS Safari.
  `activateOnKey` (module scope) gives them Enter/Space; they have no click handler of their own: Enter/click bubbles to the card's existing onClick, so swipe guards still apply.
  Per-task buttons carry the task's name (`Mark X done`, `Delete X`, `Reorder X`).
- On the drag handle, ArrowUp/Down call `moveTaskBy`, which announces the new position
  through the `srMessage` live region (`.sr-only`, next to the task modal).
- `.app-inner` is `inert` while `TaskModal` is open. `TaskModal` records its opener in a layout
  effect (inert blurs it before a normal effect runs) so focus returns there on close.
- Landmarks: `<header>` (with a visually hidden `<h1>`), `<nav className="app-sidebar">`,
  `<main className="app-main">`; Focus Mode's root is `<main>`. Selected-option buttons use
  `aria-pressed`, disclosures `aria-expanded`. The sidebar's opener is a disclosure button (`aria-expanded`), not
  an ARIA menu.
- Keyboard focus ring: a global `:focus-visible` rule with `!important` (beats inline
  `outline:none`).
- Colored text goes through `ink(color, T.light)` (module scope, wraps `readableOn()` in
  `src/lib/format.ts`), which darkens or lightens it just enough for 4.5:1. Calling it (or other
  helpers) inside a function declared *above* the `css` useMemo in `HomeworkPlanner` trips the
  React Compiler's `preserve-manual-memoization` check, like the forward-reference note above; the
  swipe-reveal label keeps plain hex for that reason.

**Bulk edit / multi-select is currently unreachable.** The "Select" button in the filter row was
removed at the user's request (2026-10-04), and nothing else turns `selectionMode` on, so the code
below is dormant; give it a different way in rather than restoring that button. As built
(`selectionMode`/`selectedIds` state, with "Select all" for the visible tasks) it works in every layout. `MiniCard` takes
`selectionMode`/`isSelected`/`onToggleSelect` and repurposes its done-toggle into a selection check
(gating swipe/drag off); the other 5 layouts do the same through `openOrSelect(t)` (row tap selects
instead of opening), `chk(t)` (the done-check shows selection, in the accent color) and
`data-selected` (outline from the runtime css), with their delete buttons and swipe hidden while
selecting. The bulk bar (two rows: Done/Archive/Delete, then Subject/Due date/Priority menus) calls
`bulkMarkDone`/`bulkArchive`/`bulkDelete`/`bulkSetSubject`/`bulkSetDue`/`bulkSetPriority`, all
through `changeTasks` so each is one undo step. Due date keeps each task's own time (clearing the
date clears it); "Pick a date..." applies on Set, not on change. Priority "Automatic" clears
`priorityOverride`.

**New task questions** (Settings; `hw-add-questions`, local-only like the Focus timer settings): which
of the add-task questions after the title (`QUESTIONS`: subject, due date, estimate, repeat) are asked,
and in what order. Stored as `{key,on}[]`, cleaned by `normalizeQuestionPrefs()` (`src/lib/addQuestions.ts`,
unit-tested: unknown/duplicate keys dropped, missing ones appended on). The wizard indexes
`askQuestions` (the enabled ones, in order), never `QUESTIONS`, so `step` means "position in the
user's list". `askQuestions` is `useMemo`'d over the module-scope `askedQuestions()` -- computed
plainly in the component body, the React Compiler treated it as possibly mutated and bailed out on
the whole component (reported, confusingly, on the `css` memo's `F.google`/`F.body` deps). With the
estimate question off a new task gets `estMins:0` (not the picker's 30-minute start); with every
question off, submitting the title adds the task.

**Task templates** (`TaskTemplate`, `templates` state; shown as deletable chips under the add
button) are local-only — `localStorage`, not synced
to Firestore. Deliberate scope call: a personal convenience, not core data, not worth a second
synced subcollection right now. Starting a task from a template (`startFromTemplate`) skips the
normal step-by-step add-task wizard straight to the due-date question (wherever the user put it; if
it's turned off, the task is added immediately) via `usingTemplate`/
`templateSubtasks` state, since the template already answered the other questions.

**Reminders** (`REMINDER_OFFSETS`, `enabledOffsets` state) support multiple independently-toggleable
lead times (1 day / 3 hours / 1 hour before, or at due time) for tasks with a specific due *time*;
tasks with only a due date fall back to the original once-daily due/overdue summary. Only the
closest due offset is actually sent (earlier, now-stale ones are just marked sent), and "at due
time" has a 15-minute grace window -- without it, its window would be empty and it could never fire. Sent-reminder
tracking is keyed by `(taskId, offsetKey, dueDate+dueTime)` in `localStorage`, so editing a task's
due date/time naturally resets what's still owed. A 1-minute `setInterval` re-checks while the tab
is open, since offset reminders need to fire close to a specific time, not just on tab-focus.

**Data export** (`exportAllDataJSON`/`exportTasksCSV`) uses a shared `downloadFile()` helper
(`Blob` + object URL + a synthetic `<a download>` click) — the standard client-side download
pattern, no server involved.

## Planning (Notion)

Planning docs live in Notion, not just the repo. Before adding a feature, check the Notion page
**DuePlanner — Roadmap** and its **Roadmap items** database. If the feature is listed, build it
to that item's Notes. When it ships, update the item: set Status to **Done**, and put the commit
hash in Notes along with anything that differs from the plan. New ideas go in **DuePlanner —
Feature ideas**; accepted ones get added as Roadmap items.

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
