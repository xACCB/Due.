# Changelog

All notable changes to DuePlanner are documented here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This file starts
tracking as of `0.1.0` — earlier history is in `git log`, not backfilled here.

## [Unreleased]

### Added
- "Stealth Light" theme -- a literal per-channel RGB inversion of the existing dark "Stealth"
  theme's achromatic grays (near-white bg instead of near-black, pure black accent instead of pure
  white), with `textMuted` nudged slightly to restore WCAG AA contrast that the naive inversion
  narrowly missed.
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

### Changed
- Down to just two themes: "Stealth" (dark) and "Stealth Light", removing the other 24. With
  exactly one theme per light/dark category, `themeName` is now a derived value (determined by
  Light/Dark/System) rather than an independent, persisted, per-user choice -- the "Theme" picker
  grid and the old "remember last theme per category" mechanism are both gone as a result. Fixed 21
  buttons/checkmarks that hardcoded black text on a `T.accent` fill (safe when accent was always a
  bright color; broken by Stealth Light's pure-black accent) to use the existing `contrastColor()`
  helper instead.
- Fixed `textFaint` contrast in both Stealth and Stealth Light -- `scripts/check-theme-contrast.ts`
  never actually checked this field, so Stealth's own original value (1.57:1, close to invisible)
  had shipped unnoticed, and its mirror in Stealth Light (1.47:1) was the same problem made obvious
  (low contrast reads as moody on a dark background, broken on a light one). The script now checks
  `textFaint` against the large-text/UI-component bar, and both themes were nudged to actually pass.
- Renamed the "Auto" appearance mode to "System" (label only, same behavior).
- Main tab bar (Tasks/Tools/Import/Settings) redesigned as an icon-only "liquid glass" pill: a
  translucent, blurred (`backdrop-filter: blur`) rounded container with individual buttons that no
  longer show text labels, just a small stroke SVG icon each (`aria-label`/`title` cover
  accessibility and hover tooltips), with the active tab getting its own raised glass-pill highlight
  in the theme's accent color. The four icons (list, sliders, inbox-tray, gear) are hand-built from
  SVG primitives rather than Unicode glyphs, so they render identically everywhere instead of
  depending on font/OS glyph support.
- Removed every colored/pictographic emoji from the UI (button labels, tab labels, layout and
  group-by icons, appearance mode icons, toasts, empty states). Functional icon slots that had no
  plain-text fallback (layout picker, group-by picker, Light/Dark/System toggle, the AI-suggestion
  sparkle) were swapped for monochrome Unicode glyphs consistent with the icon set already in use
  elsewhere in the app (☰ ⊟ ⊞ ▓ △); purely decorative emoji (🎉 💪 🎒 etc.) were just removed.
  `THEMES`' own unused `emoji` field (🕶️, never actually rendered) was deleted along with it.
- Down to just one font: the original DM Serif Display/DM Mono pairing, removing the other 15. Same
  treatment as the theme reduction above -- the Font picker grid and its per-user `fontName` state
  are gone; `F` is now the fixed `FONT` constant instead of a keyed lookup. Any existing stale font
  choice in a user's browser is cleared automatically on next load.

### Fixed
- The header wordmark, the selected Appearance button, and the Stats numbers could render in a
  leftover custom accent color instead of the active theme's own black/white accent, making them
  effectively invisible in Stealth Light if a custom accent had ever been set (from before the app
  was down to just two themes). Root cause and fix below.

### Removed
- Streak tracking, the 7-day activity dots, and streak-gated theme unlocks.
  The three previously-gated themes (matrix, dracula, rosepine) are now
  available to everyone.
- The "BOW" theme (added, then removed again shortly after) from the light theme menu.
- The "Custom Accent" color picker (Options tab). It let `T.accent` get permanently overridden by
  an arbitrary color regardless of which theme was active, which is exactly what caused the
  invisible-text bug above -- a stray override doesn't make sense anymore now that there are only
  two themes and the accent is meant to always be exactly black or white. Any existing stale
  override in a user's browser is cleared automatically on next load.

## [0.1.0] — 2026-09-21
Baseline tag for the start of changelog tracking. Recent work before this
point (see `git log` for full detail): tags, manual priority override, and
bulk edit; task templates; multi-offset due date reminders; JSON/CSV data
export; Open Graph/Twitter meta tags; the DuePlanner rebrand; security
response headers and CI (build + lint); Firebase Analytics, Performance
Monitoring, and App Check (reCAPTCHA Enterprise).
