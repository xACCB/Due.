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

## Rules

- **No Expo Go.** Native Firebase (M3) needs a development build, so this app uses
  `expo-dev-client` from day one.
- `ios/` and `android/` are generated from `app.json` and gitignored. Never edit them by hand;
  change `app.json` or a config plugin instead.
- Add packages with `npx expo install <name>` (inside `apps/mobile`), so the version matches the SDK.
- One React for the whole repo: `react`/`react-dom` are pinned in the root `overrides` and in
  `apps/web`. When an Expo SDK upgrade moves React, move all three together (duplicate Reacts
  break at runtime).
- Bundle id `com.duestudios.dueplanner` (`app.json`). It can change freely until the first
  TestFlight upload, then never.
