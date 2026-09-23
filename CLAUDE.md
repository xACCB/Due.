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
styled-components, or Tailwind. A tiny inline script in `index.html` reads a `hw-bg` localStorage
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
  `syncStatus` ("Synced 2m ago" / "Saving..." / "Offline ...") under Profile in the title menu, plus
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
  doesn't wipe local starter tasks before they've had a chance to sync up.
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
  the cloud copy (except the task counter doc, which rules keep undeletable). Gated behind a
  type-`DELETE`-to-confirm panel rather than a plain `window.confirm`, given it's irreversible.
  Deletes in chunks of 450 (Firestore's batch limit is 500; an account can hold ~5,500 docs), with
  the profile doc last so an interrupted run can be retried.

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
`LAYOUTS` (7 task-list display modes, still in `App.tsx`; Compact, Minimal, Sticky, Timeline and By Subject were removed -- a saved removed layout falls back to List via the derived `layout` const). `FONTS` went the same way
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
  `filter==="noest"` view, and a Start button that opens Focus on the most urgent task in the
  subject with the most time left).
- `download.ts`: `downloadFile` — the `Blob` + object URL + synthetic `<a download>` click pattern
  used by data export.

**UI shape.** `HomeworkPlanner` renders a two-button tab bar -- Tasks, and Focus, which opens the
separate full-screen Focus Mode (`focusMode` state) with its Pomodoro timer (clock-based: it counts
down to a fixed end time, as the task session timer counts up from a fixed start, because browsers
slow or pause intervals in background tabs and on locked screens; the running time shows
on the Focus button; finishing chimes via `playChime()`, notifies, and toasts). Settings
(`activeTab==="options"`) is opened from the title menu, not the tab bar, so it has its own header
with a back button. The title menu (the DuePlanner wordmark) holds Inbox (stats + What's New),
History (undo/redo), Import/Export, Profile, and Settings; tapping "Time left" in the header opens a
per-subject time breakdown. The tab bar icons and menu icons (`IconTasks`/`IconFocus`/
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
re-steal focus into the first element on every unrelated re-render. Dragging its top handle moves the sheet
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

**Settings extras.** Subjects can be renamed/recolored (`updateSubject`, carries the rename to
tasks, trash and templates). Date & time: `timeFormat` (`formatTime(t, h24)`, passed to
`TaskModal`/`MiniCard` as `h24`) and `weekStart` (`startOfWeek()` in `src/lib/dates.ts`, used by
the Inbox's week stats). The Inbox starts with a "Done today" list (`doneToday`).

**Task detail actions.** `TaskModal` can edit a task's own fields (an Edit panel, via
`onUpdateTask(patch)` -> `updateTask`), snooze it (`snoozeTarget()`, module scope, since the
React Compiler's purity lint rejects `Date.now()` inside component functions; `snoozeTask` records it
in the undo history as an `"edit"` `HistoryAction` with the before/after due date and time, so it
shares the undo toast and History menu with deletes), duplicate it
(`duplicateTask`: fresh id, unchecked subtasks, no sessions, detached from any repeat chain) and
restore it from the archive. **Recently deleted** (`trash`, `hw-trash`; synced via `users/{uid}/trash`
when signed in, see the Firestore data model above): every delete also lands here for 30 days (pruned on load, capped at 200), restorable from the
History menu; undo/redo of a delete keeps it in step. **Focus Mode** targets `focusTask` (`focusTaskId`, falling back to
the first pending task); a finished Pomodoro logs a session of the configured length to it (read
through `pomodoroTaskRef`, since the finish effect is declared before `focusTask` is computed), and a
Screen Wake Lock is held while Focus Mode is open. The Pomodoro alternates `pomodoroPhase`
work/break; lengths and auto-start-breaks are local-only settings (`hw-pomodoro-*`, Settings ->
Focus timer). When a break ends, `breakEnded` shows a suggestion (`nextSuggestion`: the task just
worked on if still open, else `mostUrgent`) as a card in Focus Mode or a toast elsewhere, with a
one-tap Start. **JSON import** (`importBackupJSON`) merges an
export: tasks with ids already present are skipped, subjects/templates added if missing, existing
subject colors win, settings untouched.

**What's New** (`WHATS_NEW`, the Inbox's Updates list) is hand-maintained, newest first -- add an
entry whenever a user-facing change ships. Only dismissed ids are persisted
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
background glow (`.app-shell::before`), and gives the tab bar a sheen plus a sliding "lens" pill.
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

**Completing a task** (`toggleDone`) animates unless reduced motion is on: the id sits in
`justDone` for 750ms, during which `allSorted`/`filteredTasks` keep the card where it was while
`CheckMark` (module scope, an SVG stroke) draws in and the title's `.strike` (a background line,
not `text-decoration`, so it can animate) draws across. Then `captureTaskRects()` records every
`[data-task-id]` card's position and a `useLayoutEffect` FLIP-animates each card from its old spot
to its new one: the farthest-moving card (the completed one) lifts slightly (scale 1.025, raised
z-index) and slides the whole way down over ~1.5-2s at an even pace, while the others make room in
~1s; keyboard reordering passes `quick` for a plain 320ms version. Only `MiniCard` has `data-task-id`, so only the list layouts glide; the others
get the check and strike but jump into place.

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
  `aria-pressed`, disclosures `aria-expanded`. The title menu is a disclosure (`role="group"`), not
  an ARIA menu.
- Keyboard focus ring: a global `:focus-visible` rule with `!important` (beats inline
  `outline:none`).
- Colored text goes through `ink(color, T.light)` (module scope, wraps `readableOn()` in
  `src/lib/format.ts`), which darkens or lightens it just enough for 4.5:1. Calling it (or other
  helpers) inside a function declared *above* the `css` useMemo in `HomeworkPlanner` trips the
  React Compiler's `preserve-manual-memoization` check, like the forward-reference note above; the
  swipe-reveal label keeps plain hex for that reason.

**Bulk edit / multi-select** (`selectionMode`/`selectedIds` state, "Select" in the filter row, with
"Select all" for the visible tasks) works in every layout. `MiniCard` takes
`selectionMode`/`isSelected`/`onToggleSelect` and repurposes its done-toggle into a selection check
(gating swipe/drag off); the other 6 layouts do the same through `openOrSelect(t)` (row tap selects
instead of opening), `chk(t)` (the done-check shows selection, in the accent color) and
`data-selected` (outline from the runtime css), with their delete buttons and swipe hidden while
selecting. The bulk bar (two rows: Done/Archive/Delete, then Subject/Due date/Priority menus) calls
`bulkMarkDone`/`bulkArchive`/`bulkDelete`/`bulkSetSubject`/`bulkSetDue`/`bulkSetPriority`, all
through `changeTasks` so each is one undo step. Due date keeps each task's own time (clearing the
date clears it); "Pick a date..." applies on Set, not on change. Priority "Automatic" clears
`priorityOverride`.

**Task templates** (`TaskTemplate`, `templates` state; shown as deletable chips under the add
button) are local-only — `localStorage`, not synced
to Firestore. Deliberate scope call: a personal convenience, not core data, not worth a second
synced subcollection right now. Starting a task from a template (`startFromTemplate`) skips the
normal step-by-step add-task wizard straight to the due-date question via `usingTemplate`/
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
