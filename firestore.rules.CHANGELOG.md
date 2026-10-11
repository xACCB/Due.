# firestore.rules changelog

Every change to the security rules, newest first: what changed, why, and when it went live. The rules are the only thing between the public internet and users' data, so each change gets a line here even when the commit message already explains it.

**When you change `firestore.rules`:**

1. Run `npm run test:rules` (and `npm run test:e2e` if the change touches tasks, trash, the counter or the device list).
2. Add an entry at the top of this file.
3. Deploy with `npx firebase-tools deploy --only firestore:rules`, then fill in the "Live" date.
4. If it goes wrong for real users: `npm run rules:rollback` shows the previous version, and `npm run rules:rollback -- --yes` restores and deploys it.

"Live" is the date the change was deployed to production where that is known. Entries before this file existed (2026-10-10) were reconstructed from the git history, so their dates are commit dates.

| Date | Commit | Change | Why | Live |
|---|---|---|---|---|
| 2026-10-11 | (this commit) | Tags and subject names must be text: a tag list or subject list holding a number, `true`, `null` or a map is refused, and so is an item with a line break in it (how the check works: `allText()`). A device id in the device list must be 24 hex characters. A new counter's `last` is at most 30 characters. Each applies to what a write adds or changes: tags left as they were, a subject list left exactly as it was, and a device list the write adds no id to are accepted as stored. | A scripted client (or a hand-edited import, before the app cleaned those) could store a number where every device expects text, and the counter, which can never be deleted, could be created holding a megabyte of text. | 2026-10-11 |
| 2026-10-10 | `70982bb` | Stricter task checks. New task and trash documents: the `id` must equal the document name; `dueDate` must be `YYYY-MM-DD` or empty and `dueTime` `HH:MM` or empty; `estMins` must be a whole number; tag text at most 3,000 characters in total; `updatedAt`, `completedAt` and `deletedAt` at most two days ahead of the server's clock. Updates: the `id` can't change, and each of those checks applies only to a field the write changes, so documents stored before this stay editable. Also: total text bounded for `subjects`, `subjectColors` and device ids; the counter's `last` must look like a task id. | A scripted client could store a task under another's id, garbage dates, or a far-future timestamp that wins every sync conflict. Two days of slack so a device with a wrong clock or time zone still syncs. Not checkable in rules: that every tag or subject is text (`join()` accepts numbers). Known edge: a task imported from a hand-edited backup before this change with over 3,000 characters of tags can be edited, but moving it to or from Recently deleted is refused. | not yet deployed |
| 2026-10-10 | `f9fce37` | New `users/{uid}/meta/devices` doc: one map of signed-in devices, capped at 20. Owner-only. | The Devices list in Profile and "sign out other devices". Additive: no existing rule changed. | 2026-10-10 |
| 2026-09-22 | `5e3bd5b` | `enforceTaskCap()` set to `true` (phase B): creating a task or trash doc must bump the counter in the same batch. | Enforces the 5,000 task and 500 trash cap per account. Setting it back to `false` is the escape hatch. | 2026-09-22 |
| 2026-09-22 | `70d3e6b` | New `users/{uid}/meta/counts` doc and the counter checks (`isValidCountChange`, `isCountedCreate`), shipped with `enforceTaskCap()` off (phase A). | Rules can't count a collection, so a counter doc does; phase A let open copies of older app versions keep working during rollout. | commit date |
| 2026-09-22 | `908bca9` | Size caps on every string, list and map a client can grow (titles, subjects, subtasks, tags, sessions, field counts). | A scripted client could otherwise inflate documents toward the 1 MiB limit. Matched by `src/lib/limits.ts`. | commit date |
| 2026-09-22 | `f3c60ba` | Profile accepts `timeFormat` (`12h`/`24h`) and `weekStart` (`0`/`1`). | New Date & time settings sync across devices. | commit date |
| 2026-09-22 | `e606681` | Tasks accept `updatedAt`; new `users/{uid}/trash/{taskId}` collection (a task plus `deletedAt`). | Field-level sync merging and a synced Recently deleted. | commit date |
| 2026-09-22 | `6bb2920` | Profile accepts `subjects` (a list of at most 200) and `subjectColors` (a map). | Subjects and their colours sync through the profile doc. | commit date |
| 2026-09-22 | `7d2eb0c` | Profile accepts `colorCodeUrgency`. | The Urgency Color Coding setting syncs. | commit date |
| 2026-09-22 | `0f91ccf` | Profile no longer validates `scratchpad`. | The Tools tab, which held the scratchpad, was removed. | commit date |
| 2026-09-21 | `4534135` | Profile no longer validates `themeName`. | Reduced to two themes; the theme is derived, not stored. | commit date |
| 2026-09-21 | `b4efeab` | Profile no longer validates `completionLog` and `unlockedThemesEver`. | Streak tracking and streak-unlocked themes were removed. | commit date |
| 2026-09-19 | `44be85d` | Shape validation for profile and task writes (`isValidProfile`, `isValidTask`: required fields and types), with tasks matched explicitly at `users/{uid}/tasks/{taskId}`. | A second layer beyond ownership, since the web key is public. | commit date |
| 2026-09-19 | `06dafe3` | First rules file: a user can read and write only their own `users/{uid}` doc and what is under it; everything else is denied. | Access was previously not restricted by a rules file in the repo. | commit date |
