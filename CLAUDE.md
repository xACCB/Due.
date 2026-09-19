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

Deployed on Vercel as a static Vite build, auto-deploying on push to `main`. There's no
`vercel.json` — build/output is auto-detected via Vercel's Vite preset.
