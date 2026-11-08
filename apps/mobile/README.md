# DuePlanner for iPhone (and later Android)

The Expo app. Plan and milestones: `docs/mobile-plan.md`. Shared logic comes from
`@dueplanner/core` (`packages/core`); keep new non-UI logic there, not here.

## Run it on a Mac

One-time setup: Xcode (App Store, open it once, then Settings -> Components -> an iOS Simulator),
then `brew install node@22 git watchman cocoapods`, and clone the repo into a folder that iCloud
doesn't sync (e.g. `~/dev`).

```
npm install            # at the repo root: installs the web app, core and this app together
cd apps/mobile
npx expo run:ios       # first run builds the native app (a few minutes) and opens the Simulator
```

After the first build, `npx expo start` (or `npm run mobile` at the root) is enough for JS
changes; re-run `npx expo run:ios` after adding a package with native code.

Native builds go through ccache (`brew install ccache`; turned on by `expo-build-properties` in
`app.json`), which helps a little with plain C/C++ (on 2026-11-08 it cached only about 1 MB: the
Objective-C and Swift here mostly can't be cached). The real saving is Xcode's own build folder
(DerivedData): the first build took well over 10 minutes on the M1 Air, the next one 290 seconds.
Without ccache installed the build still works.

## What's where

- `src/app/` (expo-router: every file is a screen)
  - `_layout.tsx`: fonts, the launch screen, `AppProvider`, the gesture root, and the stack: the
    tabs, then the pushed screens (task page, Inbox, History, Import/Export, back reads "Home")
    and the sheets (menu, Time left, Search).
  - `(tabs)/_layout.tsx`: the native tab bar (iOS draws it; SF Symbol icons).
  - `(tabs)/index.tsx` Home (the web's Home: Time left, suggestion, search, chips, the six layouts,
    drag to reorder, templates), `calendar.tsx` (Month and Deck), `focus.tsx` (the web's Focus
    Mode), `settings.tsx` (the web's dropdown sections).
  - `task/[id].tsx` the task page (the web's TaskModal page: fields, session timer, template).
  - `menu.tsx` (the web's sidebar), `search.tsx`, `time-left.tsx`, `inbox.tsx` (recaps),
    `history.tsx`, `import.tsx`.
- `src/state/`
  - `taskStore.ts`: what each task action does, plus undo/redo (plain functions, unit-tested).
  - `focusTimer.ts`: the Pomodoro and stopwatch (plain functions, unit-tested).
  - `settings.ts`: every setting's `hw-*` key, default and cleaner (the web's keys and defaults).
  - `useAppValue.ts` (the state, incl. the Focus timers and Home's filters), `appContext.ts`
    (`useApp()`, which also gives `fz()` for Text size), `AppState.tsx` (`AppProvider`).
- `src/lib/`: `storage.ts` (MMKV), `usePersisted.ts`, `notifications.ts` (local notifications),
  `clock.ts`, `useNow.ts`, `day.ts` (Calendar helpers), `reorder.ts` (drag arithmetic, tested),
  and, development only, `devRemote.ts` + `devSample.ts` (see "Checking screens" below).
- `src/components/`: `TaskCard` (the web's MiniCard), `TaskLayouts` (Board, Checklist, Kanban,
  Progress, Pyramid), `Swipe` (every card's swipe), `MiniTaskRow`, `DayTaskRow`, `DueDeck`, `Ring`
  (the Pomodoro ring), `TimerPill`, `Dropdown`, `ScreenTitle`, `AddSheet` (the add questions),
  `DateTimeField` (system pickers), `UndoToast`, `ui.tsx` (chips, buttons, settings sections/rows).

## Checking screens without tapping (development only)

With Metro running (`npx expo start --dev-client`; never `CI=1`, which turns off file watching),
the app reads `http://localhost:8099/cmd.json` every second (`src/lib/devRemote.ts`). Serve a
folder with `python3 -m http.server 8099 --bind 127.0.0.1`, write e.g.
`{"n":2,"go":"/calendar"}` (`"seed":true` loads sample tasks, `"set":["hw-key",value]` writes a
setting and reloads, `"set":["dev-open-section","Subjects"]` opens that Settings section,
`"back":true`, `"push":"/task/1002"`), raising `n` each time, then
`xcrun simctl io booted screenshot shot.png`. Avoid `xcrun simctl openurl`: it shows an "Open in
DuePlanner?" prompt that only a tap dismisses.

Data uses the web app's keys (`hw-tasks`, `hw-trash`, `hw-schema`, `hw-subjects`...) and shapes,
so the account sync in M3 can reuse core's sync code unchanged. `hw-focus-state` (the running
timers) is phone-only.

## Rules

- **No Expo Go.** Native modules (MMKV now, Firebase in M3) need a development build, so this app
  uses `expo-dev-client`.
- `ios/` and `android/` are generated from `app.json` and gitignored. Never edit them by hand;
  change `app.json` or a config plugin instead.
- Add packages with `npx expo install <name>` (inside `apps/mobile`), so the version matches the SDK.
- One React for the whole repo: `react`/`react-dom` are pinned in the root `overrides` and in
  `apps/web`. When an Expo SDK upgrade moves React, move all three together (duplicate Reacts
  break at runtime).
- A component file exports only components (the react-refresh lint rule); hooks and helpers go in
  `.ts` files. `Date.now()` inside a component trips the React Compiler's purity lint: use `clock()`.
- Reminders are local notifications from core's `upcomingReminders()`, rescheduled (all at once,
  one pass at a time) 0.8s after any task or setting change. iOS keeps at most 64 pending; we use
  62 plus one for the Focus timer.
- Bundle id `com.duestudios.dueplanner` (`app.json`). It can change freely until the first
  TestFlight upload, then never.
- On Windows, run Expo from `...\Projects\Dueplanner` (the folder's real casing): links made from
  `DuePlanner` make Metro fail to find `@dueplanner/core`.
