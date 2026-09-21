# Changelog

All notable changes to DuePlanner are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This file starts
tracking as of `0.1.0` — earlier history is in `git log`, not backfilled here.

## [Unreleased]

### Changed
- **Rebrand** to the DuePlanner brand guide (v1.0, Sep 2026): replaced the 26-theme/16-font
  personalization system with a single strict monochrome palette (light + dark/"Inverse", nine
  named grays, no accent colors) and Inter as the only typeface. Removed the theme grid, custom
  accent color picker, and font picker from Options accordingly. Flattened all drop shadows. Swept
  UI copy for the guide's voice rules (no emoji, no exclamation marks, sentence case). New "dp"
  monogram logo/favicon.
- Swapped the brand guide's Inter for Sora, weighted toward the bolder end (500-800, no regular
  400 loaded).

### Added
- Unit tests (Vitest) for the pure date/priority/syllabus-parsing functions.
- `usePersistedState` hook, replacing repeated `useState` + localStorage
  `useEffect` boilerplate for most simple persisted settings.
- Error boundary around the task detail modal, so a malformed task only closes
  the modal instead of taking down the whole app.
- Fix for a flash of the default background before the saved theme loads.
- Account deletion (Options tab), removing both the Firestore profile/tasks
  data and the Firebase Auth account itself.
- Firestore emulator + rules-unit tests, verifying `firestore.rules` actually
  rejects malformed writes and cross-user access.
- Focus trap + focus-return on the task detail modal for keyboard users.
- CI: Dependabot for automated dependency updates; a pre-commit hook
  (husky + lint-staged) running ESLint on staged files.

### Removed
- Streak tracking, the 7-day activity dots, and streak-gated theme unlocks.
  The three previously-gated themes (matrix, dracula, rosepine) are now
  available to everyone.

## [0.1.0] — 2026-09-21
Baseline tag for the start of changelog tracking. Recent work before this
point (see `git log` for full detail): tags, manual priority override, and
bulk edit; task templates; multi-offset due date reminders; JSON/CSV data
export; Open Graph/Twitter meta tags; the DuePlanner rebrand; security
response headers and CI (build + lint); Firebase Analytics, Performance
Monitoring, and App Check (reCAPTCHA Enterprise).
