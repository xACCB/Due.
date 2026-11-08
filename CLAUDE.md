# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Working with the user

Standing preferences, copied here from Claude's per-machine memory (2026-11-08) so every computer
gets them. The user works on a Windows PC and a Mac, kept in step through GitHub.
- **Keep this file current, as you go.** It is the only context a new session gets (sessions don't
  carry over between conversations or machines, and per-machine memory doesn't sync). Whenever
  something changes that the next session would need (a decision and its reason, a new screen,
  file, setting, key, command or convention, a gotcha that cost time, a change of plan, a user
  preference), update the relevant section here in the same commit as the change. Update
  "Where things stand" whenever the next step changes. When the user states a preference or
  corrects you, add it to this list rather than (or as well as) memory. Prefer editing an existing
  section to appending a new one, delete what's no longer true, and keep the existing tone: say
  what and why, with file and function names a reader can search for.
- **Commit and push** finished work to `origin/main` without asking each time, once build, lint and
  tests pass. Hold off only if told to, or for something unusually risky or destructive.
- **End every task with a summary**: what changed, anything that differs from the plan or roadmap,
  what was verified and what wasn't (e.g. not run in a browser or on a phone), and what was updated
  elsewhere (commit hash, Notion, What's New, this file).
- **What's New for every user-facing change**, even a small fix to something shipped yesterday, in
  the same commit, with a `where` using the exact on-screen labels (see What's New below). The
  phone app isn't released yet, so its changes don't get entries until it ships.
- **No dash-joined phrasing in user-facing text** ("--", "—", " - "): the user finds it looks AI
  written. Use two sentences, a comma, a colon, or "so"/"because". Keep the same restraint in chat
  summaries and commit message titles.
- **Notion is the roadmap** (see Planning below). New ideas go on "DuePlanner — Feature ideas" as
  unchecked to-dos (`- [ ]`); checked means the user wants it on the roadmap. On review, move
  checked ideas into Roadmap items and delete unchecked ones. The page "Dueplanner Ideas" is the
  user's own notes: read it, don't restructure it. Keep Notion copies of repo planning docs current.
  The connector can't delete pages, so point out stale ones for the user to remove.
- **Aim: a mainstream product**, not a hobby project. Treat security, scalability, monitoring and
  reliability as real priorities, but default to free options. Anything that costs money (a
  domain, Firebase Blaze, store accounts) is the user's call, so flag it rather than proceed.
- **The phone app is React Native with Expo, never Capacitor** or another web-view wrapper: the user
  wants a real app, not "a website". Plan: `docs/mobile-plan.md`; code: `apps/mobile`.
- **Branding**: the company is Due Studios ("due. studios" in in-app credits), the product is
  DuePlanner. Never bare "Due" (see Branding below).
- **React Compiler forward references**: in `apps/web/src/App.tsx`'s `HomeworkPlanner`, a function
  that reads a `const` declared further down makes the compiler bail out on an unrelated `useMemo`
  (`preserve-manual-memoization`, often reported on the `css` memo). Read the value's source
  directly, or declare things in order. Suspect this first when that lint error appears somewhere
  unrelated to your change.
- **Windows only**: the folder's real name is `Projects\Dueplanner` (lowercase p). npm links made
  from the `DuePlanner` spelling make Metro fail with `Unable to resolve "@dueplanner/core/..."`.
  Run Expo from the `Dueplanner` path; if it already broke, delete `node_modules\@dueplanner`
  and run `npm install`. The Mac clone doesn't have this problem.
- **Explain plainly, give exact steps.** The user is new to Mac, Xcode and native app tooling. Say
  what a term means the first time (e.g. "scaffolding"), give commands to paste as code blocks in
  the order to run them, say what output to expect and what to do if it fails, and keep a short
  checklist for anything they do by hand. While a long download or build runs, carry on with work
  that doesn't need it and say what you're doing.
- **Two machines.** Windows: `C:\Users\aaron\OneDrive\Desktop\Me\Projects\Dueplanner` (the web app
  and most work so far). Mac: `~/dev/DuePlanner` (needed for every iOS build and the Simulator).
  Start each session with `git pull`; only one machine should have unpushed work at a time. The
  Mac has Xcode, Homebrew, `node@22`, watchman, cocoapods, ccache, `gh` and openjdk. Homebrew's openjdk
  isn't on PATH, so before `npm run test:rules` or `test:e2e` there, run
  `export PATH="$(brew --prefix openjdk)/bin:$PATH"`.
- **The Mac's npm is 10.9.9**, which drops the `libc` lines from `package-lock.json` on every
  install. Don't commit that: there, run installs as `npx -y npm@11 install` (as Windows' npm does),
  or `git checkout -- package-lock.json` after a plain `npm install` that added nothing.
- **The Mac is a MacBook Air (M1, 8 GB).** Memory is the limit: one Simulator at a time, and a
  native build (`npx expo run:ios`) only when a package with native code changed; otherwise
  `npx expo start` and reload. ccache is on (`expo-build-properties`, `ios.ccacheEnabled` in
  `app.json`) but saves little here (Objective-C/Swift); the big saving is Xcode's DerivedData
  (first build over 10 minutes, the next 290s). Keep `apps/mobile/ios/` and DerivedData unless
  something is broken; `npx expo prebuild --clean` forces a full rebuild.

## Where things stand (update this when it changes)

- **2026-11-08 (evening):** the phone app (`apps/mobile`) runs on the Mac's iPhone 18 Pro
  Simulator and now follows the web screen by screen: Home (Time left, suggestion, search, chips,
  the six layouts, drag to reorder, templates, the completion hold and glide, the timer pill),
  the menu (the web's sidebar), Search, Time left, Inbox (recap Messages only: the web's Updates
  describe the website), History, Import/Export, Calendar (Month and Deck), Focus (ring, task
  card, Break's over), the task page (session timer, Save as template) and Settings (the web's
  dropdown sections, subject rename/recolour). Not tried by hand, since this Mac can't tap the
  Simulator: swipes, drag to reorder, the Deck swipe, the file picker and the share sheet; try
  them on the Simulator or a phone. Not ported on purpose: the web's Snooze (gone from its task
  page too) and Calendar's DayDetail card (the day panel shows the same).
  **Next:** M3, sign-in and sync (`docs/mobile-plan.md`), after the items below.
- **Checking screens without tapping (dev only):** with Metro running (`npx expo start
  --dev-client`, never with `CI=1`, which turns off file watching), the app reads
  `http://localhost:8099/cmd.json` every second (`src/lib/devRemote.ts`): serve a folder with
  `python3 -m http.server 8099`, write `{"n":<next>,"go":"/calendar"}` (or `"seed":true` for the
  sample tasks in `src/lib/devSample.ts`, `"set":["hw-key",value]`, `"back":true`), then
  `xcrun simctl io booted screenshot`. `simctl openurl` shows an "Open in DuePlanner?" prompt
  that can't be dismissed without tapping, so avoid it.
- **Before M3, flag these to the user:** the iOS app has to be registered in the Firebase console
  (which gives a `GoogleService-Info.plist`); App Check needs App Attest for iOS and debug tokens
  for the Simulator, since App Check is enforced; and Sign in with Apple (which Apple requires when
  Google sign-in is offered) needs the paid Apple Developer Program ($99 a year), the user's call.

## Commands

- `npm run dev` — start the Vite dev server (default port 5173).
- `npm run build` — type-check (`tsc -b`) then production-build (`vite build`) into `dist/`.
- `npm run lint` — run ESLint over the whole project.
- Phone app (`apps/mobile`): `npm run mobile` (Expo dev server; the app must already be built),
  `npm run typecheck:mobile`, and on the Mac `cd apps/mobile && npx expo run:ios` (builds the native
  app and opens it in the Simulator; run it again after adding a package with native code). Without
  a Mac, `cd apps/mobile && npx expo export --platform ios --output-dir <tmp>` proves the
  JavaScript bundles, and `npx expo-doctor` checks the dependencies. Add packages with
  `npx expo install`.
- `npm run preview` — serve the built `dist/` output locally.
- `npm test` — Vitest, unit tests for the pure functions in `packages/core/src/lib/` (dates, priority/format
  helpers, syllabus parsing), plus the `web` and `mobile` projects (`apps/mobile/src/state/*.test.ts`:
  the task store, settings and Focus timer). Fast, no external services; this is what CI runs.
- `npm run test:rules` — Firestore emulator + `@firebase/rules-unit-testing`, verifying
  `firestore.rules` actually rejects malformed writes and cross-user access. Needs Java (a JRE) for
  the emulator; CI installs one and runs it. Run it locally before changing `firestore.rules`
  (no installed Java needed: unzip a Temurin JRE anywhere and put its `bin` first on `PATH` for the command).
- `npm run test:rules` also runs `tests/firestore.contract.test.ts` (everything the app writes at
  its `LIMITS` is accepted, one step over is refused) and `tests/firestore.fuzz.test.ts` (450 seeded
  random tasks: valid ones accepted, broken ones refused), and afterwards writes
  `coverage/rules/summary.txt`: which lines of `firestore.rules` no test evaluated
  (`tests/rulesCoverage.ts`; the emulator's own HTML report runs to hundreds of MB, so only hit or
  miss per line is kept). `packages/core/src/lib/limits.rules.test.ts` (in plain `npm test`) reads the numbers
  out of `firestore.rules` and checks them against `LIMITS`.
- `npm run test:e2e` -- two headless Chromes as two devices on one account, against the Auth and
  Firestore emulators and the dev server in emulator mode (`tests/e2e/`, no extra dependency: it
  drives Chrome over the DevTools protocol; set `CHROME_PATH` if Chrome isn't found). Covers real
  sign-in, sync between devices, an edit conflict, a delete, and the device list. Needs Java.
- `npm run test:stress` -- one account filled to the 5,000 task cap on the emulator with the app's
  own write builder; timings go to `coverage/stress.txt`. Slow, not in CI. `STRESS_TASKS=300` for a
  quick run.
- `npm run rules:rollback` -- shows the previous version of `firestore.rules`; with `-- --yes` it
  restores and deploys it. Every rules change gets a row in `firestore.rules.CHANGELOG.md`.
- A pre-push hook (`.husky/pre-push`) runs `npm test`.
- Emulator mode: `npx firebase-tools emulators:start --only auth,firestore` (needs Java), then
  `VITE_FIREBASE_EMULATORS=1 npm run dev` -- the app talks to the local Auth/Firestore emulators
  (fake Google sign-in, throwaway data) instead of production. Dev server only; never in a build.
- `npm run audit:contrast` — diagnostic script (`scripts/check-theme-contrast.ts`, run via `node
  --experimental-strip-types`) that checks every theme in `packages/core/src/themes.ts` against WCAG AA contrast
  ratios and prints failures. Reports only; doesn't fix anything, since adjusting a theme's hex
  values is a design call on a live, user-facing palette.
- A pre-commit hook (husky + lint-staged, `.husky/pre-commit`) runs `eslint --fix` on staged
  `.ts`/`.tsx` files. Dependabot (`.github/dependabot.yml`) opens weekly npm dependency-update PRs.
- `.github/workflows/ci.yml` runs on every push/PR to `main` and weekly (Monday cron). The
  workflow token is read-only (`permissions: contents: read`), actions are pinned to commit SHAs
  (Dependabot's `github-actions` entry moves them), and installs use `npm ci --ignore-scripts`. Job
  `build-and-lint` (Node 22): `npm run build`, `npm run typecheck:mobile`, `npm run lint`, `npm test`,
  `npm run test:rules` (uploading the rules coverage summary as an artifact). Job `e2e`:
  `npm run test:e2e`, not yet required to pass (`continue-on-error`; remove that once it has proved
  steady). Job `security`: `npm audit --audit-level=high` (blocking, dev dependencies included;
  Dependabot's PRs are the usual fix), `npm ci` then `npm audit signatures` (each retried up to 3
  times: one dropped registry request among ~970 packages failed the job at random, the same
  lockfile passing and failing on 2026-11-08), and a gitleaks secret scan of the full git history
  (pinned binary, config in `.gitleaks.toml`, which allowlists only the public Firebase web API key
  by exact value). Vercel's own build would catch a broken build, but not these. GitHub's own secret
  scanning and push protection are repo settings (Settings -> Advanced Security), not files in the
  repo. To see CI results without `gh` or a login (the repo is public):
  `curl -s "https://api.github.com/repos/xACCB/Due./actions/runs?per_page=10"` lists runs with their
  `conclusion`, and `.../actions/runs/<id>/jobs` shows each job's steps. Full logs need a login
  (`gh run view <id> --log-failed`, e.g. on the Mac).

## Architecture

**Monorepo (since 2026-10-18).** npm workspaces, so one `npm install` at the root sets up everything
and every command above still runs from the root:
- `packages/core` (`@dueplanner/core`): the shared plain TypeScript, imported as
  `@dueplanner/core/lib/sync`, `@dueplanner/core/types` etc. (its `exports` map points at the `.ts`
  sources; there is no build step, the web app's Vite and later the phone app's Metro compile it). Its
  `tsconfig.json` has **no DOM lib and no ambient types**, and ESLint gives it no browser globals, so
  `window`/`document`/`localStorage` there fail the build: anything browser-specific belongs in
  `apps/web`. The one platform API it uses, `crypto.getRandomValues`, is declared in `src/globals.d.ts`
  of core. No Firebase import either: `lib/taskWrites.ts` is `makeTaskWrites({deleteField, increment})`,
  and `apps/web/src/lib/taskWrites.ts` binds it to the JS SDK (the rules tests in `tests/` import that
  binding, so they still test the app's real writes).
- `apps/web` (`@dueplanner/web`): the Vite app. `vercel.json` stays at the repo root and tells Vercel
  to build from the root (`npm run build`) and serve `apps/web/dist`, so the Vercel project's settings
  didn't change.
- `apps/mobile` (`@dueplanner/mobile`): the Expo app (SDK 58, expo-router, `src/app/` routes; plan in
  `docs/mobile-plan.md`, how to run it in `apps/mobile/README.md`). Native builds need a Mac
  (`npx expo run:ios`); on Windows, `npm run typecheck:mobile` and `npx expo export --platform ios`
  (in `apps/mobile`) still check it. Its plain-TypeScript state (`src/state/*.ts`) is unit-tested
  in `npm test` (the `mobile` vitest project). One React for both apps: pinned in the root `overrides` and
  `apps/web`, moved together with Expo SDK upgrades. RN/Expo need Node 22.13+. Full detail: the
  "Phone app" section below.
- At the root: `firestore.rules`, `firebase.json`, `tests/` (rules, contract, fuzz, e2e, stress),
  `scripts/`, the ESLint config and `vitest.config.ts` (runs both workspaces' unit tests as projects).
- `npm run build` type-checks core on its own (`tsc -p packages/core`), then builds the web app.
New shared logic goes in core; when moving more, prove it the same way M1 was: build `main` and the
branch, serve both, and compare each screen's text and the saved data (identical on 2026-10-18).

**Mostly-single-file app.** The bulk of the app (component tree, all state, all Firebase wiring)
still lives in `apps/web/src/App.tsx`, exported as `HomeworkPlanner` and rendered into `#root` by
`apps/web/src/main.tsx`. Pure, dependency-free pieces have been split out so they're independently testable
and reusable outside React: `packages/core/src/types.ts` (`Priority`/`Recurrence`), `packages/core/src/themes.ts` (the `THEMES`
palette data, importable by non-React scripts like the contrast auditor), `packages/core/src/lib/` (`dates.ts`,
`format.ts`, `syllabus.ts`, `id.ts` — the module-level functions with unit tests in
`npm test`), `apps/web/src/hooks/usePersistedState.ts` (see below), and `apps/web/src/components/ErrorBoundary.tsx`.
The components that were already at module scope (`TaskModal`, `ProfileModal`, `CalendarView`...) each
have a file in `apps/web/src/components/` now (see "Where things live" below), so where this file says a
component is "module scope" it means its own file. `HomeworkPlanner` itself (state, effects, sync,
the tab bodies, `renderTasks`) is still all of `App.tsx`.
`apps/web/src/App.css` is intentionally empty (leftover from the Vite template, unused) and `apps/web/src/index.css`
is just a minimal box-sizing reset — all real styling comes from inline style objects plus one
runtime-generated stylesheet string (`css`, built from the active theme/font inside the component)
injected via `<style>{css}</style>` in both the main view and Focus Mode. There's no CSS modules,
styled-components, or Tailwind. The fonts are loaded by non-blocking `<link>`s in `apps/web/index.html`, never by an `@import`
in that runtime stylesheet: an `@import` holds back the whole stylesheet until it loads, which showed
the app unstyled for a moment on slow connections (the visually hidden `<h1>` appearing as a second
title, the layout stretched). `apps/web/index.html` also holds the launch screen (`#splash`: the dp mark on black, plain HTML
plus a small script that fades it out once `#root` has content, after at least 600ms, with a 4s
safety timeout). A tiny inline script in `apps/web/index.html` reads a `hw-bg` localStorage
key (kept in sync with the active theme's background by `App.tsx`) and paints it on `<html>`
before React mounts, to avoid a flash of the default background for returning dark-theme users.

**State & persistence.** All app state (tasks, theme, layout, subjects, notification
prefs, etc.) lives in `HomeworkPlanner`, persisted to `localStorage` under `hw-*` keys.
`localStorage` is the source of truth for signed-out/offline use; Firestore (when signed in with
Google via Firebase Auth) is a sync layer on top of it. Most simple fields (no extra
validation/merge logic on read) use `usePersistedState(key, initial)` — a small hook
(`apps/web/src/hooks/usePersistedState.ts`) replacing the repeated `useState` + localStorage `useEffect`
pair. It JSON-serializes on write, and on read falls back to the raw string if `JSON.parse` throws
— several fields predate the hook and stored plain unquoted strings (e.g. `"list"`, not
`'"list"'`), and this keeps those intact on the first load after adopting the hook rather than
silently resetting them to the default. Fields with real extra logic on read (`tasks` — order
backfill; `subjectColors` — merges with defaults; `accentOverride` — `removeItem` instead of
writing `null`; `dismissedWhatsNew` — one-time migration from the old whole-feed `hw-whatsnew`
key, see What's New below) are deliberately left as hand-written
`useState`/`useEffect` pairs rather than forced into the generic hook.

**Firebase.** The `firebaseConfig` (project `ai-homework-planner-92260`) is hardcoded in
`apps/web/src/firebase.ts` (with the rest of the Firebase setup; it exports `auth`, `db`, `googleProvider`) — this is a public client web API key, not a secret; access is enforced by Firestore
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
throwing -- `isSupported()` checks that explicitly instead of half-initializing. `apps/web/public/privacy.html`
discloses this; keep that page in sync if what's collected here changes.

**Error reports (Sentry).** `apps/web/src/lib/report.ts`: `reportError(err, where)` (`where` a short fixed
label such as `"sync-tasks-save"`) is called from the render `ErrorBoundary`, global error/rejection
handlers, every place that sets `syncError`, device list writes and account deletion. Inert unless
Vercel's `VITE_SENTRY_DSN` is set, never in emulator mode; the SDK (`@sentry/browser`) is
dynamically imported when the app is idle, so it is its own chunk. Sends only the error, the label,
the app version and the browser: default integrations off (no breadcrumbs, no global handlers of its
own), `dataCollection` all off but the User-Agent header, and `scrubEvent()` (unit-tested) strips
user/extra/breadcrumbs/request data whatever the SDK attaches. Never pass task text as `where`.
`apps/web/public/privacy.html` describes this; keep it in step. CSP `connect-src` allows `*.ingest.sentry.io`
(plus the `us`/`de` regions).

**Feature flags (Remote Config).** `apps/web/src/lib/flags.ts`: `FLAG_DEFAULTS` in code is what every load
starts from (and all it ever uses offline, in emulator mode, or until a parameter exists in the
console); `startFlags()` (from `apps/web/src/firebase.ts`) fetches when idle, at most hourly, and only values
whose source is `"remote"` override a default. Read with `useFlags()` (`apps/web/src/hooks/useFlags.ts`,
`useSyncExternalStore`) or `getFlags()`. To add one: a default here, then optionally a parameter of
the same name in Firebase console -> Remote Config. `devicesAutoSignOut` (default true) gates only
the Devices effect's "my entry is gone, sign out" branch: setting it to false in the console stops
that without a deploy.

**Data versions (`schemaVersion`).** `packages/core/src/lib/migrations.ts`: `SCHEMA_VERSION` and one step per
version for tasks (`TASK_STEPS`) and the profile (`PROFILE_STEPS`). `schemaVersion` is sync
metadata like `updatedAt`, never a `Task` field: `taskWrites.ts` stamps it on every task/trash doc
written (`stamp()`), the profile save writes it, and `cloudRecord()` splits it off and runs
`migrateTask` on the way in. This device's `hw-tasks` has its version in `hw-schema`; a JSON export
records `schemaVersion` and `readBackup` migrates from it. A step must be safe to run again on
current data (an older app can rewrite a doc without the field, which then reads as version 0). A doc
from a newer app (`isFromNewerApp`) is read but never written back (`newerIdsRef`/`newerProfileRef`
in `HomeworkPlanner`), and the sync note asks for a reload (`shownSyncError`). **Changing a task or
profile shape:** bump `SCHEMA_VERSION`, add the step, and still follow "Known fields only" below for
any new field. The rules accept `schemaVersion` as a whole number 0..1000 (`validVersion()`,
`LIMITS.schemaVersion`), never required.

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
- **Conflict handling** (`packages/core/src/lib/sync.ts`, unit-tested): `baseRef` holds what we last knew the cloud
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
  them. The size limits live in `packages/core/src/lib/limits.ts` (`LIMITS`, unit-tested) and the app stays inside
  them -- subtask/tag/subject inputs stop at the cap, `addSession()` drops the oldest session past
  1000, and JSON import runs `sanitizeTask()` -- because a write over a rules cap saves locally but is
  silently refused by the cloud. Change a limit in both places; `tests/firestore.rules.test.ts`
  checks the rules side.
- **Stricter task checks** (`isTightTask` / `keepsOrTightens` in `firestore.rules`, 2026-10-10): a
  new task or trash doc must have `id` equal to the doc name, real `dueDate`/`dueTime` formats, a
  whole-number `estMins`, at most 3,000 characters of tag text, and no `updatedAt`/`completedAt`/
  `deletedAt` more than two days ahead of the server (two days, not minutes, so a device with a wrong
  clock or time zone still syncs). On an update each check applies only to a field the write
  changes, and the `id` can't change: tightening must never make an existing doc uneditable, so
  follow that create-strict / update-lenient split for any future check. Moving a task between
  tasks/ and trash/ is a create, so it gets the strict checks. `tests/firestore.tight.test.ts`
  covers both halves, seeding old-style docs with the rules off.
- **Text lists and device ids** (2026-10-11): tags and subject names must be text. Rules can't loop
  over a list, so `allText()` joins the items with a line break and splits again; only a list of
  text comes back equal. That also refuses an item containing a line break, so anything that brings
  text in from outside goes through `oneLine()` (`packages/core/src/lib/limits.ts`; `sanitizeTask` and
  `withImportedSubjects` do). Device ids must be 24 hex characters. Both are lenient the same way
  as above (unchanged tags, an unchanged subject list, a device write that adds no id).
- **Known fields only** (2026-10-12): a new task, trash entry or profile may hold only the fields
  the app writes, and an update may add or change only those (`addsOnly()` with `taskFields()` /
  `trashFields()` / `profileFields()` in `firestore.rules`); a field an older version stored (a
  task's `notes`, a profile's `scratchpad`) may stay or be removed. The same lists are `TASK_FIELDS` /
  `TRASH_FIELDS` / `PROFILE_FIELDS` in `packages/core/src/lib/limits.ts` (`limits.rules.test.ts` compares them;
  `TASK_FIELD_MAP` won't compile if `Task` gains a key it doesn't list), and `addTaskWrite` sends
  tasks through `syncedTask()` so a task holding an old field on a device still syncs. **A new synced
  field goes in both lists, and the rules are deployed before the app that writes it**, or its saves
  are refused. A new task's `id` and `order` must also be ordinary numbers (`finite()`). Still open:
  what each subtask or session holds (rules can't look inside a list of maps), so one task doc can
  still be large; closing that means storing them differently.
- **Rules have a budget.** One request may evaluate 1,000 rule expressions, and a check "by
  position" (`list[0]`, `list[1]`...) costs about ten each even when the position is empty: 30 of
  them for tags left less than half the budget, and checking 20 device entries didn't fit at all
  (which is why an entry's contents still aren't checked). Prefer one whole-list expression. The
  "fullest task goes through every move" test in `tests/firestore.counter.test.ts` is the heaviest
  write the app makes; it failing with "maximum of 1000 expressions" means a new check is too dear.
- **Task counter / per-account cap.** Rules can't count a collection, so `users/{uid}/meta/counts`
  (`n` = docs in tasks/, `t` = docs in trash/, `last` = the task id the latest change was about)
  does. Every batch that creates, deletes or moves a task bumps it (`countDelta()` in
  `packages/core/src/lib/sync.ts`; batches are built by `addTaskWrite()` in `packages/core/src/lib/taskWrites.ts`, shared with
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
The logic is `deviceAction()` in `packages/core/src/lib/devices.ts` (unit-tested), driven by the Devices effect in
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
(`packages/core/src/themes.ts`) went from 26 color themes down to exactly two -- `stealth` (dark) and
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
(`packages/core/src/lib/format.ts` -- WCAG-luminance-based black/white text picker, already used elsewhere e.g.
the `Toggle` switch thumb) instead of a hardcoded color, so they stay correct under any accent color
a future theme might use. A few needed a conditional version since they only sometimes render on a
solid `T.accent` fill (e.g. task-done checkmarks default to a fixed green `#2ED573`, not `T.accent`,
in most layouts -- only the branches that actually use `T.accent` as the fill needed the fix).
`LAYOUTS` (6 task-list display modes, in `packages/core/src/constants.ts`; Compact, Minimal, Sticky, Timeline, By Subject and Calendar -- replaced by the Calendar tab -- were removed -- a saved removed layout falls back to List via the derived `layout` const). `FONTS` went the same way
as `THEMES` -- down from 16 selectable heading/body pairings to exactly one (`FONT`, in
`packages/core/src/fonts.ts`: the original DM Serif Display/DM Mono pairing), with the Font picker grid and its
`fontName`/`setFontName` state gone entirely. `F` is now just `FONT` directly rather than a keyed
lookup. A one-time `localStorage.removeItem("hw-font")` on mount clears any stale per-user font
choice already saved by existing users' browsers, mirroring the `hw-accent` cleanup above.

**Where things live outside `App.tsx`** (moved out 2026-10-10, ahead of a React Native phone app
that will reuse them; keep adding logic here, not in the component):
- `packages/core/src/types.ts`: `Task`, `Subtask`, `TaskTemplate`, `HistoryAction`, `Priority`, `Recurrence`.
- `packages/core/src/constants.ts`: `LAYOUTS`, `GROUP_BY`, the default subjects and colours, `PRIORITY_COLORS`/
  `priColor`, `REMINDER_OFFSETS`, `QUESTIONS`/`askedQuestions`.
- `packages/core/src/whatsNew.ts`: `WHATS_NEW` (add new entries here), `UPDATE_KIND_ORDER`, `LEGACY_WHATSNEW_IDS`.
- `packages/core/src/lib/tasks.ts`: `setDone` (completing, the repeat copy, un-completing), `nextOrder`,
  `buildSuggestion`, `snoozeTarget`, `dateInDays`, `isUntouchedExample`.
- `packages/core/src/lib/trash.ts`: `TrashEntry`, `trashEntries`, `pruneTrash`, `localRecords`.
- `packages/core/src/lib/taskActions.ts`: what each task action does to the data, as plain `list in, list out`
  functions (`patchTask`, `patchTasks`, `duplicateOf`, `withNewTask`, `withTrashed`,
  `restoredInto`, `movedOrder`, the subject add/rename helpers, templates). The functions in
  `HomeworkPlanner` (`editTask`, `duplicateTask`, `moveTaskBy`...) are thin wrappers that add what
  belongs to the screen: the undo entry, the toast, `captureTaskRects`.
- `packages/core/src/lib/taskViews.ts`: which tasks a screen shows and in what order or groups: `sortTasks`,
  `filterTasks`, `groupTasks`, `prioritySplit` (Kanban/Pyramid), `timeLeft`, `searchTasks`,
  `completionStats`, and `heldOpen`/`isSettled` (the `justDone` hold).
- `packages/core/src/lib/reminders.ts`: `dailySummary` and `offsetReminders` decide what is owed; the effect in
  `HomeworkPlanner` only shows the notifications and stores what was sent.
  `upcomingReminders` is the same reminders worked out ahead of time, for the phone app to schedule
  (`apps/mobile/src/lib/notifications.ts`); `dueIn` is the shared "in 3h" wording.
- `packages/core/src/lib/addFlow.ts`: the add-task questions as a state machine (title, then
  `askedQuestions`, the date's "what time?" step, skip/back). The phone's add sheet uses it; the web
  wizard in `HomeworkPlanner` still has its own copy of the same rules, so change both together.
- `packages/core/src/lib/backup.ts`: `tasksCsv`, `readBackup` and the `withImported...` merges, `withSyllabusTasks`.
- `packages/core/src/lib/timers.ts`: the timers' arithmetic (`secondsLeft`, `stopwatchTotal`,
  `pomodoroFinishMinutes`, `pomodoroCreditMinutes`, `sessionMinutes`, `withSession`). The state,
  refs and effects that run the Pomodoro, stopwatch and task session are still in the component.
- Moved out 2026-10-11, verbatim (the web app only; the phone app will have its own screens):
  `apps/web/src/firebase.ts` (setup), `packages/core/src/fonts.ts` (`FONT`), `apps/web/src/styles.ts` (`buildCss`, the runtime
  stylesheet; the `css` memo passes it the theme values it depends on one by one, so its deps stay
  exact), `apps/web/src/lib/dom.ts` (`activateOnKey`, `isWideScreen`, `flashTarget`, `pin`/`unpin`/
  `freezeBox`, `notify`, `playChime`), `apps/web/src/lib/thisDevice.ts` (`thisDeviceId`, `requestInstall`,
  `isStandalone`), `ink`/`longDate` in `packages/core/src/lib/format.ts`, `SCREEN_TITLES` in `packages/core/src/constants.ts`,
  and in `apps/web/src/components/`: `icons.tsx` (the icons, `CheckMark`), `TaskModal.tsx`, `Sidebar.tsx`
  (`SidebarRow`, `SidebarSubjects`, `ScreenHeader`), `SettingsSection.tsx` (and `Toggle`),
  `SearchOverlay.tsx`, `UpdateDetail.tsx`, `GrowCard.tsx` (and `CardTaskRow`, `DayDetail`,
  `TimeDetail`), `CalendarView.tsx` (and `DueDeck`), `MiniCard.tsx`, `ProfileModal.tsx`. A component
  file exports only components (the react-refresh lint rule); helpers and constants go in `packages/core/src/lib/`
  or `packages/core/src/constants.ts`.
Still inside `HomeworkPlanner`, to move later, each a change of structure rather than a move: the
timers as state machines (or a `useFocusTimer` hook), one wrapper for the storage calls, and the
sync engine.
When moving more, prove it the same way: build `main` and the branch side by side and compare what
each shows (the page text per view, the saved data after each action) for identical output.

**Domain logic as plain functions** (not hooks), all in `packages/core/src/lib/` and unit-tested via `npm test`:
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
`packages/core/src/lib/sidebarSubjects.ts`, unit-tested): every subject in the user's order, even with nothing
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
`IconImport`/`IconSettings` etc., in `apps/web/src/components/icons.tsx`) are
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
off and closes, carrying the finger's velocity (`packages/core/src/lib/spring.ts`, unit-tested; driven through refs
and direct style writes, not state, so a drag doesn't re-render the modal per frame; reduced motion
snaps/closes instantly). `TaskModal`'s render site in
`HomeworkPlanner` is wrapped in `<ErrorBoundary>` (`apps/web/src/components/ErrorBoundary.tsx`, also reused
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
  occurrence (see `setDone()` in `packages/core/src/lib/tasks.ts`), so un-completing removes that copy instead of leaving a
  duplicate. The copy gets unchecked subtasks and keeps no due date if the original had none.
- `estMins` can be 0 (estimate step skipped); every display goes through `formatDuration()`
  (`packages/core/src/lib/format.ts`), which returns "" for 0 so the label is hidden rather than showing "0m".

**Undo history.** `HistoryAction` is either `"delete"` (ties into Recently deleted) or `"change"`:
each affected task's full state before and after (`packages/core/src/lib/history.ts`, `diffTasks`/
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
`TaskModal`/`MiniCard` as `h24`) and `weekStart` (`startOfWeek()` in `packages/core/src/lib/dates.ts`, used by
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
and helpers in `packages/core/src/lib/stopwatch.ts`) decides which timers show; Settings presents it as two
switches, Pomodoro and Stopwatch (`focusShowFor()` maps them to the stored value), and hides the
Pomodoro's length settings while it's off. In Focus Mode the order is Pomodoro, task, stopwatch,
centered as a group. **JSON import** (`importBackupJSON`) merges an
export: tasks with ids already present are skipped, subjects/templates added if missing, existing
subject colors win, settings untouched.

**What's New** (`WHATS_NEW` in `packages/core/src/whatsNew.ts`, the Inbox's Updates list) is hand-maintained, newest first -- add an
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
recaps (`packages/core/src/lib/recaps.ts`, unit-tested): when a day, week, month or year ends, an effect in
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

**Liquid Glass is gone.** The optional translucent look (`liquidGlass`, `hw-liquid-glass`, with its
glow layer, attribute-selector card effects and pointer highlight) was removed at the user's request
on 2026-10-10; the saved choice is cleared once on mount. Don't bring it back. Two tokens it
introduced remain and are still the right ones to use: `T.solidBorder` wherever a real hex is
required (e.g. `contrastColor()`), and `T.borderFaint` for a lighter divider (`T.border+"33"`).

**Text size** (`textSize`, `hw-text-size`, three buttons in Settings -> Looks, local-only): Small
(the sizes the app had until 2026-10-12), Default (small text about 15% larger) and Large (about
30%). Every font size goes through `fz(px)` (`apps/web/src/lib/textSize.ts`, unit-tested), in inline styles
(`fontSize:fz(11)`) and in the runtime css (`font-size:${fz(12)}`): it returns
`calc(11px + 11px * var(--ts, 0.15))`, and a layout effect sets `--ts` on `<html>`. Text of 12px
and under takes the whole increase, larger text less, and from 20px up none (`fz` then returns the
plain number), so labels grow and headings and the timers stay put. **Write `fz(n)` for any new
font size under 20px**, never a bare number, or that text won't follow the setting. The sample
"Aa" on the three buttons is deliberately fixed. Check a change at all three sizes at 360px wide:
nothing cut off, and the tap areas (below) still clear of each other.

**Animation speed** (`animSpeed`, `hw-anim-speed`, a slider in Settings -> Looks, 0.5x to 2x,
local-only) is applied globally by `apps/web/src/lib/animSpeed.ts` instead of per call site: it wraps
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
- *The completed card's lift* is a separate animation on `scale` laid over a single eased slide. As a
  first keyframe segment of the slide it made the card rise, hesitate, then set off.
- *Cards that grow from a row* freeze their contents at the final size first (`freezeBox`), so the
  text is revealed in place instead of re-wrapping while the box grows.
- *Scrollbars.* `html{scrollbar-gutter:stable}` and `body{overflow-x:clip}` (`apps/web/src/index.css`): with
  `overflow-x:hidden`, body was its own scroll container and grew a second scrollbar while cards
  were mid-animation below its edge, shifting the page sideways for a moment.
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

**Layouts animate alike.** Checked 2026-10-10; keep it that way. In every layout: the done-check has
`transition:all .2s ease-out` and pops (`chkPop(t)`, the List's `check-pop`), the title uses
`titleClass(t)` with `transition:color .2s ease-out`, anything that sets the card's size waits for
`settled(t)` (the "Done" label in Progress included), the card gets `swipeContentStyle` (whose
transition is `all`, so the `.tc` hover eases everywhere), and an empty list renders nothing (Kanban
used to draw four empty columns). What still differs on purpose: only the List can be reordered and
grouped (Settings says so when Group by is set in another layout), Kanban and Pyramid sort by
priority into columns or tiers and show no due label, and check marks are different shapes.

**Layouts stay consistent** through shared helpers at the top of `renderTasks`: every layout's card is a
`[data-task-id]` wrapper (relative, clipped) holding the swipe reveal and the `.tc` card, so all six
swipe; `titleClass(t)` gives the done strike (and its draw-in), `dueText(t)` the due label (a live
countdown when due today at a time), and `settled(t)` decides when a completed task moves to a
Done column or tier (not while it's in `justDone`). Use these for any new layout.

**Swipes** on task cards lock in as soon as sideways movement is the larger direction (6px), give up
to scrolling only when vertical is larger (10px), and act past `SWIPE_THRESHOLD` (64px) or on a flick (over 600px/s after 24px). The earlier,
stricter rule (1.5x flatter than tall, 90px) dropped most real thumb swipes.

**Pull to reload** (`apps/web/src/hooks/usePullToReload.ts`): in the installed app only (`isStandalone()`;
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
- **Tap areas** (2026-10-12): a small control (a check, a ×, the sidebar buttons, a subject's
  arrow, a `Toggle`, the reorder handle) carries the `.hit` class, which adds an invisible `::after`
  margin that also counts as pressing it (`--hit`, an inset, 10px by default), without changing its
  size or look. Give any new small control `.hit`. Where a neighbour is close, add the narrower
  `.hit-sm` / `.hit-row` / `.hit-tog` / `.hit-arrow` / `.hit-grip`: the margin must never cover part
  of another control (in a stacked list, at most half the gap between rows; the subtask rows were
  spaced out to 10px for this). The template chips' × is deliberately left alone, since its
  neighbour is the template itself and deleting one can't be undone. Check a change by sampling
  points on every other control with `elementFromPoint` and seeing none resolve to a `.hit`.
- Keyboard focus ring: a global `:focus-visible` rule with `!important` (beats inline
  `outline:none`).
- Colored text goes through `ink(color, T.light)` (module scope, wraps `readableOn()` in
  `packages/core/src/lib/format.ts`), which darkens or lightens it just enough for 4.5:1. Calling it (or other
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
and in what order. Stored as `{key,on}[]`, cleaned by `normalizeQuestionPrefs()` (`packages/core/src/lib/addQuestions.ts`,
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

## Phone app (`apps/mobile`)

A natively built iPhone (later Android) app in React Native with Expo, sharing `packages/core` with
the website. Plan and milestones: `docs/mobile-plan.md`. File map and run steps:
`apps/mobile/README.md`. **Status:** see "Where things stand" above. Everything below was written
and unit-tested on Windows and has not yet run on a simulator or phone, so expect first-run fixes,
and correct this section when real behaviour differs.

**Stack (versions matter; Expo changes APIs every SDK).** Expo SDK 58, React Native 0.88.1, React
19.3.0, TypeScript 6, expo-router 58 (file routes under `src/app/`, `NativeTabs` from
`expo-router/native-tabs`), `expo-dev-client` (no Expo Go), `react-native-mmkv` 4 (needs
`react-native-nitro-modules` as a direct dependency so autolinking picks it up),
`@react-native-community/datetimepicker` 9 (`onValueChange`/`onDismiss`; `onChange` is deprecated),
`expo-notifications`, `expo-keep-awake`, `expo-haptics`, `expo-font` with
`@expo-google-fonts/dm-serif-display` and `dm-mono`, `expo-splash-screen`, `expo-symbols` (the
tab bar's Android icons), `react-native-reanimated`
4 and `react-native-gesture-handler` 3 (installed, not used yet: they're for the swipe gestures).
`app.json` turns on `experiments.reactCompiler` and `typedRoutes`. Expo and React Native need Node
22.13+, which is why CI uses Node 22. Before using an Expo or React Native API, read the installed
package's `.d.ts` (or the versioned docs at `docs.expo.dev/versions/v58.0.0/`) rather than relying
on memory: that's how `NativeTabs.Trigger.Icon sf=...`, the notifications trigger shape
(`{ type: SchedulableTriggerInputTypes.DATE, date }`) and the `NotificationBehavior` fields
(`shouldShowBanner`/`shouldShowList`) were confirmed.

**One React in the repo.** npm hoists one copy, and two copies break at runtime. `react` and
`react-dom` are pinned to the same exact version in the root `package.json` `overrides` and in
`apps/web/package.json` (the web app moved from 19.2.6 to 19.3.0 for this). On an Expo SDK upgrade,
move all three to the version Expo's template uses, then check `npm ls react react-dom --all` shows
a single version. If the lockfile clings to an old copy, remove the `node_modules/react*` entries
from `package-lock.json` and reinstall: that's what fixed it the first time.

**State.** One `AppProvider` (`src/state/AppState.tsx`) holds everything the screens share, built by
`useAppValue()` (`src/state/useAppValue.ts`) and read anywhere with `useApp()`
(`src/state/appContext.ts`). It's three files because the react-refresh lint rule allows a
component file to export only components. `useApp()` gives:
- `tasks`, `trash`, `canUndo`/`canRedo`, and actions: `add` (a title or an `AddDraft`), `toggle`,
  `edit(id, patch, label?)` (undoable), `quiet(id, patch)` (not undoable), `duplicate`, `logSession`,
  `remove` (to Recently deleted), `restore`, `undo`, `redo`;
- `T` (the active theme object: `THEMES.stealth` or `stealthLight`, from the Appearance setting and
  the phone's light/dark mode), `h24`, and `questions` (`askedQuestions(addQuestions)`);
- `settings`: every setting's value and setter (below).
The task logic is `src/state/taskStore.ts`: plain `(store, ...) => store` functions over core
(`withNewTask`, `setDone` including repeat copies, `patchTask`, `duplicateOf`, `withTrashed`,
`restoredInto`, `withSession`, `diffTasks`/`applyTaskStates`), unit-tested in
`taskStore.test.ts`. What's undoable matches the web's `changeTasks`: add, complete, edit, archive,
duplicate and delete are; subtask ticks, tags, the priority override and logged sessions
(`quietPatch`/`logSession`) aren't. An `editTask` that changes nothing adds no undo step. The undo
history holds 50 steps in memory and isn't saved. A restore from Recently deleted isn't undoable.

**Saved data.** MMKV (`src/lib/storage.ts`, instance id `dueplanner`) under the **web's key names and
shapes**, so M3 can feed it to core's sync code unchanged: `hw-tasks` (migrated on load with
`migrateTasks` from `hw-schema`, and `hw-schema` rewritten as `SCHEMA_VERSION` on save), `hw-trash`
(30-day `pruneTrash` on load; bad entries dropped). Settings use `usePersisted(key, initial,
clean)` (`src/lib/usePersisted.ts`), with each key, default and cleaner in `src/state/settings.ts`
(`SETTINGS`, unit-tested, defaults copied from the web): `hw-thememode` (auto), `hw-colorcode-urgency`
(true), `hw-timeformat` (12h), `hw-weekstart` (0), `hw-calendar-month-only` (true), `hw-showdone`
(true), `hw-notifications` (false), `hw-reminder-offsets` (["0"]), `hw-pomodoro-work` (25),
`hw-pomodoro-break` (5), `hw-pomodoro-autobreak` (true), `hw-focus-show` (all), `hw-add-questions`
(null), `hw-subjects` (the default six), `hw-subjectcolors` (merged over the defaults, like the web).
`hw-focus-state` (the running timers) is phone-only. A new setting: add it to `SETTINGS` with a
cleaner and a test, then to `useAppValue`'s `settings`. Watch `as const`: defaults like `true` or
`25` need `as boolean`/`as number`, or the setter only accepts that exact value.
Not on the phone yet: text size, animation speed, layouts, group by, smart suggestion,
auto-archive, templates, recaps, Inbox.

**Screens** (`src/app/`; the Stack in `_layout.tsx` holds `(tabs)` and `task/[id]`):
- `_layout.tsx`: keeps the launch screen up (`SplashScreen.preventAutoHideAsync`) until the fonts
  load (or fail: a font error must not keep the app hidden), then `AppProvider`, the status bar and
  the Stack, themed from `T`. The task page has a native header ("Task", back button).
- `(tabs)/_layout.tsx`: `NativeTabs` (iOS draws the real tab bar, so iOS 26 gets Liquid Glass):
  Home (`house`), Calendar (`calendar`), Focus (`timer`), Settings (`gearshape`), as SF Symbols
  (`sf`, iOS), with Material Symbols for Android (`md`: `home`, `calendar_month`, `timer`,
  `settings`), tinted `T.accent`. `md` needs the `expo-symbols` package: without it the names
  aren't type-checked (the type silently becomes `any`) and the icons don't draw. With it, a wrong
  name fails `npm run typecheck:mobile`.
- `(tabs)/index.tsx` **Home**: header with the open count and Undo/Redo, the filter chips (All,
  Pending, Done, Archived: core's `filterTasks` over `sortTasks`, honouring Show completed), a
  "+ Add homework" button as the list header (opens `AddSheet`), `TaskRow`s (tap opens the task page,
  the circle completes with a success haptic, × deletes), and `UndoToast` ("Completed" / "Deleted"
  with Undo, 4s, placed above the tab bar).
- `components/AddSheet.tsx` **adding a task**: a native page sheet (`Modal presentationStyle=
  "pageSheet"`, swipe down to cancel) driven by core's `lib/addFlow.ts` (see "Where things live").
  Steps: "What's the assignment?", then each question the user turned on, in their order. Subject:
  subject chips. Due date: Today / Tomorrow / 3 days / Next week, or an inline calendar, then
  "What time?": Any time / 9:00 AM / 3:00 PM / 11:59 PM, or a spinner. Estimate: 15 min to 2 hrs, or
  hours and minutes steppers. Repeats: none, daily, weekly, monthly. Skip and Back on every step
  (Skip on the estimate means no estimate; Skip on "what time?" keeps the date). A progress-dot row
  and an "Adding" preview card. `busy` stops a quick second tap adding the task twice. The sheet's
  content is remounted per opening, so each add starts fresh. `presetDate` (from Calendar) opens
  the date question on "what time?".
- `task/[id].tsx` **task page** (the web's `TaskModal` in its `page` form): title (multiline, saved
  on blur or Return; can't be emptied), Mark done, Archive/Unarchive, subject chips (tap again to
  clear; a subject not in the list still shows), due date and time (system pickers, "Add a due
  date", "Add a time", "Any time", "No due date"), estimate (digit-only hours and minutes, saved
  on blur; minutes past 59 roll into hours), Repeats and Priority (Auto/High/Medium/Low) as
  segmented controls, subtasks (tick is quiet, add and delete are undoable, capped at
  `LIMITS.subtasks`), tags (quiet, capped at `LIMITS.tags`/`LIMITS.tag`), time worked, Duplicate and
  Delete (both go back). Each field saves on its own, so each change is one undo step. The typed
  title and estimate follow the saved values when those change underneath (undo, another screen)
  through React's "adjust state while rendering" pattern (`seen`), not an effect. A deleted task
  shows "This task isn't here any more" with Back.
- `(tabs)/calendar.tsx` **Calendar** (the web's Month view): `monthOnlyGrid`/`monthGrid` by the
  Calendar setting, `weekdayLabels(weekStart)`, ‹ › and Today, each day with up to 3 subject-coloured
  dots for open tasks (`byDueDate`), today ringed, the picked day filled with the accent. Below:
  that day's tasks (non-archived, done ones included) and "+ Add homework due ...", which opens
  `AddSheet` with `presetDate`. No swipe between months and no Deck view yet.
- `(tabs)/focus.tsx` **Focus** (the web's Focus Mode): Pomodoro card (FOCUS/BREAK, big clock,
  progress bar, Start/Resume/Pause, Reset, Break/Skip), a "Working on" card (the task's title and
  time so far, plus chips to switch task; defaults to `mostUrgent` of the open tasks), and the
  stopwatch (Start/Pause, Reset, "Log Xm to task"). Which cards show follows `hw-focus-show`. The
  logic is `src/state/focusTimer.ts` (plain functions over core's `lib/timers.ts`, unit-tested):
  **clock-based** like the web (a running Pomodoro is its `endAt`, the stopwatch its `swStartedAt`),
  and saved in `hw-focus-state`, so it stays right through a locked phone or the app being closed.
  Finishing work logs `pomodoroFinishMinutes` (less what was already credited) and moves to the
  break, which starts at once, from the moment work ended, when auto-start breaks is on. Reset,
  Break and switching task credit the work done so far (`pomodoroCreditMinutes`, under a minute
  logs nothing). A changed length moves only an untouched timer (`applyLengths`, applied while
  rendering). The screen ticks every 500ms while a timer runs and catches up when the app comes
  back to the foreground (`AppState` "active"). After a finish, `live.current.state` is updated at
  once so two ticks before the next render can't log a session twice. The screen stays awake
  (`useKeepAwake`) only while a timer runs and the Focus tab is showing. Start asks for
  notification permission once, and the phase's end is scheduled as a notification
  (`scheduleFocusEnd`, id `focus-end`), rescheduled after permission is granted and cancelled
  while paused.
- `(tabs)/settings.tsx` **Settings**: Looks (Appearance System/Light/Dark, Urgency color coding),
  Date & time (12h/24h, week starts Sun/Mon, Calendar shows only this month), Task list (Show
  completed), New task questions (▲ ▼ to reorder with core's `moveQuestion`, a switch each), Subjects
  (colour swatch, × asks before removing; tasks keep their subject; new ones get the next palette
  colour via `subjectToAdd`; no rename or recolour yet), Focus timer (Pomodoro and Stopwatch switches
  via `focusShowFor`, lengths, auto-start breaks), Reminders (asks iOS for permission when turned
  on; if refused, an alert offers Open Settings), Recently deleted (newest first, Restore), and a
  "DuePlanner 0.1.0, by due. studios" line.

**Reminders (local notifications).** `src/lib/notifications.ts`. `syncReminders()` cancels every
scheduled notification whose id starts `rem-` and schedules core's `upcomingReminders()` again (at
most 62: iOS keeps 64 pending per app, and Focus needs one). `useAppValue` calls it 0.8s after any
change to the tasks, the Reminders switch, the offsets or the time format, and calls run one at a
time (a promise queue), because two overlapping runs could leave a reminder behind. It does nothing
without permission. What gets scheduled: for a task with a due time, one notification per enabled
offset, worded as the web would word it at that moment; for date-only tasks (and timed ones when
every offset is off), one summary per due date at 8 AM. Only future ones: unlike the web, the phone
doesn't announce tasks that are already overdue. The handler shows banners even while the app is
open.

**Conventions for this app** (the lint and the React Compiler enforce some of these):
- A component file exports only components; hooks, helpers and constants go in `.ts` files.
- No `Date.now()` in a component (the compiler's purity lint): call `clock()` from `src/lib/clock.ts`.
- Don't call `setState` synchronously in an effect. For state that follows a prop or setting,
  adjust it while rendering (compare with a stored previous value), as the task page and Focus do.
- Define components at module scope, never inside another component.
- Style from `useApp().T` (type `Theme` from `src/theme/types.ts`) and `F` from
  `src/theme/fonts.ts`: `F.heading` (DM Serif Display), `F.body` (DM Mono), `F.bodyMedium`. With a
  custom font iOS ignores `fontWeight`, so use `F.bodyMedium` instead. Only the three weights used
  are bundled, imported per weight (`@expo-google-fonts/dm-mono/400Regular`), because the package
  root bundles all eight.
- Text on an accent fill uses `contrastColor(T.accent)`, and coloured text (subjects, the danger
  button) goes through `ink(color, T.light)`, as on the web.
- Dates and times are picked with `src/components/DateTimeField.tsx`, which stores the web's text
  (`YYYY-MM-DD`, `HH:MM`, "" for none). iOS draws the system picker in place (`compact` on the task
  page, `inline` and `spinner` in the add sheet); Android opens its dialog on a tap. Only the time
  picker follows 12h/24h (its locale); dates keep the phone's own order.
- Shared building blocks are in `src/components/ui.tsx`: `Chip`, `Button` (primary, plain or
  danger), `Section`/`Row`/`ToggleRow` (settings rows), `Segmented`, `Stepper`. Use them rather than
  restyling.
- Every control has an `accessibilityRole` and `accessibilityLabel` (naming the task where there
  is one, e.g. "Mark Essay done"), state where it applies (`checked`, `selected`, `disabled`), and
  `hitSlop` when it's small (the phone's version of the web's `.hit`).
- User-facing text follows the same rules as the web (no dash-joined phrasing, "DuePlanner").
- Text from outside (typing, pasting) goes through `oneLine()` and the `LIMITS` caps before it's
  stored, as on the web, so M3's sync won't be refused by the rules.
- New native packages: `npx expo install <name>` in `apps/mobile`, then a rebuild
  (`npx expo run:ios`). Never edit `ios/` or `android/` (generated, gitignored): change
  `app.json` or add a config plugin.
- New logic the web could share goes in `packages/core` with tests (as `addFlow` and
  `upcomingReminders` did); phone-only plain logic goes in `apps/mobile/src/state` with a
  `*.test.ts` beside it (the `mobile` vitest project, `apps/mobile/vitest.config.mts`).

**Checking a change.** Without a Mac: `npm test`, `npm run lint`, `npm run typecheck:mobile`, then in
`apps/mobile` `npx expo export --platform ios --output-dir <a temp folder>` (it must end with
"Exported"; "Unable to resolve" means an import path is wrong) and `npx expo-doctor` (20/20). On
the Mac, `npx expo run:ios`, then in the Simulator: press r in Terminal to reload, Cmd+D for the
dev menu, Cmd+Shift+A to switch light and dark, Cmd+Shift+H for the home screen, Cmd+S for a
screenshot. A run-through: add a task through every question, complete and undo, delete and undo,
the filters, edit every field on the task page, Calendar dots and adding from a day, a Pomodoro
start/pause/reset and a stopwatch log, each setting taking effect, a reminder arriving with the
app in the background, and data still there after quitting the app.

**First-build troubleshooting (Mac).** `xcrun: error` / "unable to find utility": run `sudo
xcode-select -s /Applications/Xcode.app`. No simulator or runtime: Xcode → Settings → Components →
iOS. CocoaPods repo or CDN errors: `pod repo update`, then build again. A red screen naming a file
in `src/`: our bug, so fix it here. "Unable to resolve @dueplanner/core": the workspace link is
missing, so run `npm install` at the repo root (on Windows, see the folder-casing note). Yellow
warnings in the build log are normal.

**Decisions so far, and why.**
- Expo with native tabs and system pickers, not a web view: the user wants a real app (see
  "Working with the user").
- Data in the web's `hw-*` shape, so sync (M3) reuses `packages/core/src/lib/sync.ts` and the same
  `firestore.rules`.
- Local notifications scheduled ahead (no server, free), instead of the web's check-while-open.
- The bundle id is `com.duestudios.dueplanner` (`app.json`; also the Android package). It can
  change freely until the first TestFlight upload, then never.
- The app icon (`apps/mobile/assets/icon.png`) is 1024x1024 with no transparency (the App Store
  requires both): the website's shadowed "dp" (`apps/web/public/favicon-512.png`, the same design as
  `apple-touch-icon.png`) scaled up 2x with high-quality bicubic and flattened onto black, because
  no larger original exists in the repo. A crisper export from the original design file would
  be better if the user has one. Don't render `favicon.svg` instead: it's a different, flat design
  used only as the browser-tab icon. The launch screen is the 512px image on `#000000`, matching
  its own black background and the web's `#splash`.

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
A `Content-Security-Policy-Report-Only` header is set (2026-10-12): it blocks nothing, the browser
only logs what an enforced policy would have refused (DevTools console, "[Report Only]"). It is
report-only because a wrong policy would silently break Google Sign-In/reCAPTCHA/Google Fonts; rename
it to `Content-Security-Policy` only after signing in, syncing and loading every screen on the live
site shows no such lines. The inline scripts in `apps/web/index.html` (and the font link's `onload`, via
`'unsafe-hashes'`) are allowed by hash, and `apps/web/src/lib/csp.test.ts` (in `npm test`) recomputes those
hashes, so editing one of them fails the test with the hash to paste in. Styles need
`'unsafe-inline'` (the app styles inline). A new outside script, font, image host or API needs
adding to the policy.
