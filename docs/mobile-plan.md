# DuePlanner mobile app: plan

Status: M1 (the monorepo) done 2026-10-18; M2 onward not started. Decided so far:

- **React Native with Expo**, a natively built app. Not Capacitor or any other web-view wrapper.
- **One repo (monorepo):** the web app and the phone app share one `packages/core`.

## Why a monorepo

The phone app needs the same task logic, sync merging, limits and date handling the website has
today in `src/lib`. If those were copied into a second repo, the copies would drift. The most
dangerous drift is in `LIMITS`/`TASK_FIELDS` against `firestore.rules`, and in the sync merge:
there, a mismatch means saves refused by the cloud, or tasks lost in a conflict. One shared
package means one fix and one set of tests.

```
DuePlanner/
  packages/core/     shared plain TypeScript: task logic, sync merge, limits, dates, themes
  apps/web/          today's Vite web app (deployed by Vercel)
  apps/mobile/       the Expo app
  firestore.rules    unchanged location; one set of rules for both apps
  firebase.json
  tests/             rules, contract, fuzz, e2e and stress tests (unchanged location)
```

## M1. Restructure into the monorepo (one PR, no behaviour change)

Done 2026-10-18, as below with two differences: the web app's `vercel.json` stayed at the repo
root (it builds from the root and serves `apps/web/dist`, so Vercel's Root Directory didn't need
changing), and the `animSpeed`/`textSize` splits are left for M2, where the phone app first needs
them. Side-by-side check against `main`: every screen's text and the saved data identical.

1. Root `package.json` gets `"workspaces": ["packages/*", "apps/*"]`. CI keeps running from the root
   (`npm ci`, `npm run build`, `npm test`, `npm run test:rules`, `npm run test:e2e`).
2. **Into `packages/core/src`:**
   - These files are already pure (no browser, React or Firebase): `addQuestions`, `backup`,
     `calendar`, `dates`, `devices`, `format`, `history`, `id`, `limits`, `migrations`, `recaps`,
     `reminders`, `sidebarSubjects`, `spring`, `stopwatch`, `syllabus`, `sync`, `taskActions`,
     `taskViews`, `tasks`, `timeLeft`, `timers`, `trash`.
   - Also `types.ts`, `constants.ts`, `whatsNew.ts`, `themes.ts`, `fonts.ts`.
   - Their unit tests move with them.
3. **Split before moving:**
   - `taskWrites.ts`: take `deleteField` and `increment` as a parameter (`ops`), and replace the
     Firebase types with small interfaces. Then core has no Firebase import, and
     `tests/firestore.counter.test.ts` and the stress test still exercise the one real write builder,
     with the web SDK passed in.
   - `animSpeed.ts`: the pure part (`clampSpeed`, `scaledMs`, `animationRate`) goes to core;
     `setAnimationSpeed` (patches `Element.prototype.animate`) stays in web.
   - `textSize.ts`: the scale numbers go to core; `fz()` (a CSS `calc()` string) and
     `applyTextSize` stay in web. The phone app gets its own `fz` returning a number.
4. **Stay in `apps/web`:** these use browser APIs, so they stay in the web app:
   - `dom.ts`, `download.ts`, `thisDevice.ts`, `report.ts`, `flags.ts`
   - everything in `components/`, `hooks/`, `App.tsx`, `styles.ts`, `firebase.ts`
   - `csp.test.ts` (reads `index.html` and `vercel.json`)
5. **Guard rails:**
   - `packages/core/tsconfig.json` has `"lib": ["ES2022"]` with **no DOM**, so `window`, `document`
     or `localStorage` in core fails the build.
   - An ESLint block for `packages/core/**` turns browser globals off.
   - Core is added to the root `tsconfig.json` references (`tsc -b`).
6. `limits.rules.test.ts` reads `../../../firestore.rules?raw` (or moves to `apps/web`).
   `scripts/check-theme-contrast.ts` imports themes from core.
7. **Vercel:** set the project's Root Directory to `apps/web` in the same deploy; `vercel.json` moves
   with the web app.
8. **Prove it:** build `main` and the branch side by side and compare each view's page text and the
   saved data after each action (the CLAUDE.md method). Run all four test suites.

## Stack for `apps/mobile`

| Need | Choice | Why |
|---|---|---|
| App framework | Expo SDK (current), TypeScript, expo-router | File-based screens; EAS builds |
| Tab bar | expo-router **native tabs** | iOS draws its real tab bar, so iOS 26 gets genuine Liquid Glass (roadmap item "Use Apple's real Liquid Glass tab bar") |
| Firebase | `@react-native-firebase` (app, auth, firestore, app-check, remote-config, crashlytics optional) | Native offline cache; App Check with **App Attest / Play Integrity**, required because App Check is enforced on Firestore and Auth |
| Google sign-in | `@react-native-google-signin/google-signin` | The web popup flow doesn't work in a native app |
| Apple sign-in | `expo-apple-authentication` + Firebase Apple provider | Apple requires it when Google sign-in is offered |
| Local storage | `react-native-mmkv` | Fast synchronous storage, the `hw-*` keys' equivalent |
| Random ids | `react-native-get-random-values` | `newDeviceId()` uses `crypto.getRandomValues` |
| Reminders | `expo-notifications` (local, scheduled) | See below |
| Error reports | `@sentry/react-native` | Same Sentry project as web, same "no task content" rule |
| Builds | EAS Build (free tier) or local Xcode on the Mac | Expo Go can't load native Firebase, so dev builds from day one |

App Check note: simulators and dev builds need **debug tokens** registered in the Firebase console
(App Check, Apps, Manage debug tokens), exactly like local web development against production.

## Reminders: a real advantage over web

The web app can only remind you while a tab is open (server push needs Cloud Functions, so the Blaze
plan). On the phone, `expo-notifications` schedules **local** notifications on the device. Feed it
what `offsetReminders()` and `dailySummary()` in core already compute, rescheduling whenever tasks
change. They fire with the app closed, with no server and no cost.

## Milestones

- **M1, Monorepo:** the restructure above. No user-visible change.
- **M2, Skeleton:**
  - Expo app, the two themes from `themes.ts`, Home task list
  - add, complete, delete and undo through `taskActions` and `history`
  - local only (MMKV)
- **M3, Account and sync:**
  - Google and Apple sign-in, App Check
  - Firestore listeners feeding `reconcile()` from `sync.ts`, and writes built by `addTaskWrite()`,
    with the same counter, `inFlight` and newer-app rules as web
  - the Devices list
- **M4, Screens:**
  - Calendar (`calendar.ts`), task page, Focus (Pomodoro and stopwatch from `timers.ts`, with
    `expo-keep-awake`), Inbox and recaps, History, Settings
- **M5, Reminders:** local notifications as above.
- **M6, Ship:**
  - TestFlight and Play internal testing
  - store listings, privacy labels (matching `public/privacy.html`)
  - app review notes and a demo account

## Costs (your call, needed only at M6)

- Apple Developer Program: $99 a year. It's also needed to test App Attest on a real iPhone, and to
  ship to TestFlight.
- Google Play developer account: $25 once.

Everything up to M5 can be built and run on simulators and emulators for free.

## Risks and things to watch

- **Intl dates on Hermes:** `toLocaleDateString` options in `format.ts`, `recaps.ts` and
  `sidebarSubjects.ts` work on modern Hermes, but can differ slightly from browsers. Snapshot them in
  core's tests if exact text matters.
- **One set of rules, two apps:** a new synced field still goes in `TASK_FIELDS` and
  `firestore.rules`, and the rules are deployed before **either** app ships it. Bump
  `SCHEMA_VERSION` for a shape change. An older phone app then reads newer data without writing it
  back (the same guard as web).
- **Gesture parity:** swipe to complete, drag to reorder and the sheet spring (`spring.ts`) need
  `react-native-gesture-handler` and Reanimated, not a port of the web pointer code.
- **The web app keeps working throughout:** M1 is a pure move, proven by side-by-side output.
