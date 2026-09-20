# DuePlanner

A homework/task planner by Due Studios — built as a fast, highly personalizable alternative to
juggling assignments across notes apps and spreadsheets — due dates, subjects, recurring tasks,
subtasks, a Pomodoro timer, streaks, and a full theming system, all in one place.

**Live at [dueplanner.vercel.app](https://dueplanner.vercel.app)**

## Features

- Add tasks with a subject, due date/time, time estimate, and recurrence (daily/weekly/monthly)
- 12 different layouts to view your task list (list, board, kanban, calendar, timeline, and more)
- 26 built-in color themes (some unlocked by completion streaks), plus custom accent colors
- 16 font pairings
- Focus Mode with a built-in Pomodoro timer
- Import assignments straight from pasted syllabus text
- Works fully offline with no account; sign in with Google to sync across your devices
- A quick scratchpad, completion streaks, and stats on your workload

## Tech stack

- [Vite](https://vitejs.dev/) + [React](https://react.dev/) + TypeScript
- [Firebase](https://firebase.google.com/) (Authentication + Firestore) for optional cloud sync
- Deployed on [Vercel](https://vercel.com/)

## Getting started

```bash
npm install
npm run dev    # start the dev server at localhost:5173
npm run build  # type-check and production-build
npm run lint   # run ESLint
```

See [`CLAUDE.md`](./CLAUDE.md) for a deeper architecture overview.

## Privacy

See the [privacy policy](https://dueplanner.vercel.app/privacy.html) for details on what data is
collected and how it's used.
