# DuePlanner master roadmap

Everything we might build, in one place. Each item has a status, a suggested
tier, and a rough size.

**Status:** ✅ already shipped · 🟡 partly there · ⬜ not started
**Tier:** **F** = Free · **P** = Pro (paid) · **F/P** = free with a limit, Pro removes it
**Size:** S = under a day · M = a few days · L = about a week · XL = multiple weeks, usually needs backend work

---

## 0. Foundations (do these first; much of the rest depends on them)

### 0.1 Freemium setup
| Item | Status | Size | Notes |
|---|---|---|---|
| Decide the Free vs. Pro split (use the tiers in this doc as a starting point) | ⬜ | S | Rule of thumb: core planning stays free forever; Pro covers things that cost us money to run (servers, SMS, storage, AI) or that power users want |
| Payments via Stripe (Firebase "Run Payments with Stripe" extension) | ⬜ | L | Requires the Firebase Blaze (pay-as-you-go) plan. Monthly and yearly prices; a student-priced tier is worth considering |
| Entitlements stored server-side (e.g. `customers/{uid}/subscriptions`, written only by the Stripe webhook) | ⬜ | M | The client should never decide whether someone is Pro |
| Firestore rules enforce Pro limits and features, not just the UI | ⬜ | M | e.g. cap free users' template or attachment counts in the rules |
| `isPro` in the client, plus a single upgrade screen and gentle "Pro" badges on locked features | ⬜ | M | Locked features should still be visible, with a way to preview them |
| Free trial (e.g. 14 days) and a restore-purchase flow | ⬜ | M | |
| Billing page: manage, cancel, receipts (Stripe customer portal) | ⬜ | S | |
| Pricing page and FAQ (public, linked from the sign-in screen) | ⬜ | S | Also update `privacy.html` to add Stripe as a service |

### 0.2 Backend hardening
| Item | Status | Size | Notes |
|---|---|---|---|
| Safer sync: per-field updates plus an `updatedAt` on each task, newest change wins | ⬜ | L | Fixes the known issue where another device's change arriving within the 400ms write delay can overwrite an edit |
| Server-side reminders: Cloud Functions plus web push | ⬜ | XL | Reminders arrive even with the app closed. Many notification items below need this |
| Turn on App Check enforcement | 🟡 | S | Code is in place; set the site key, watch traffic, then enforce |
| Rate limits and size caps in `firestore.rules` (max tasks, subtasks, tags, string lengths) | 🟡 | M | String lengths are already capped |
| Run the Firestore rules tests in CI (emulator in GitHub Actions) | ✅ | S | Runs on every push; tests updated to the current rules |
| Scheduled Firestore backups (exports to Cloud Storage) | ⬜ | S | |
| Crash and error monitoring (e.g. Sentry) | ⬜ | S | Include sync errors, not just crashes |
| Split `App.tsx` (about 3,100 lines) into layout, page and wizard components | ⬜ | L | Makes every item below safer to build |
| Shared UI components (Card, Chip, IconButton, SectionLabel) instead of repeated inline styles | ⬜ | L | Makes Liquid Glass and future themes much simpler |
| Separate dev/staging and production Firebase projects | ⬜ | S | Today there is one project, so every test hits real user data and real rules. Use the emulators locally and a staging project for previews |
| Budget alerts and hard spending caps in Google Cloud | ⬜ | S | Must exist before switching to the Blaze plan, so a bug or abuse can't run up a surprise bill |
| Cloud Functions for anything that must be trusted (entitlements, deleting accounts, sending email/push) | ⬜ | L | The client is public; anything security-sensitive belongs on the server |
| Versioned data migrations (a `schemaVersion` on tasks and the profile) | ⬜ | M | Today, shape changes rely on ad-hoc backfills; this makes future changes safe |
| End-to-end tests (Playwright) for the main flows: add task, complete, sync, sign in/out | ⬜ | M | Catches the kind of bugs the audit found before users do |
| Content-Security-Policy header, tested on a preview deploy first | ⬜ | M | Deliberately skipped so far (risk of breaking Google Sign-In/reCAPTCHA); worth doing carefully before launch |
| HSTS and other security headers on the custom domain | ⬜ | S | See L3 |
| Dependency and secret scanning (Dependabot is on; add GitHub secret scanning, and make `npm audit` fail on high severity) | 🟡 | S | |
| Feature flags (Firebase Remote Config) | ⬜ | S | Turn features on gradually, or off quickly if something breaks |
| Admin tooling: look up a user, grant Pro manually, see sync errors | ⬜ | M | Needed as soon as there are paying users asking for help |
| Uptime monitor and public status page | ⬜ | S | |
| Data-retention policy: what happens to deleted and inactive accounts, and when | ⬜ | S | Also belongs in the privacy policy |

---

## 1. Task & scheduling core
| Item | Status | Tier | Size | Notes |
|---|---|---|---|---|
| Bulk edit (multi-select, change fields at once) | 🟡 | F | M | Exists for the List layout (Done, Archive, Subject, Delete). Missing: other layouts, and editing the due date and priority |
| Snooze / "later today" quick action | ✅ | F | S | In the task detail: later today / tomorrow / next week. A swipe action could come with #128 |
| Task dependencies / prerequisites | ⬜ | P | L | "Blocked by"; blocked tasks greyed out until the prerequisite is done |
| Multi-day / duration tasks (a date range, not one date) | ⬜ | F | M | Affects Calendar, the heatmap, and conflict detection |
| Conflict detection (two heavy tasks on the same day) | ⬜ | F | M | Best built after the workload heatmap |
| Class schedule / timetable (recurring weekly periods, rooms) | ⬜ | F | L | Foundation for A/B days and exam overrides |
| Rotating A/B-day or block-schedule support | ⬜ | F | M | Depends on the timetable |
| Finals / exam-week schedule override | ⬜ | P | M | Depends on the timetable |
| Absence tracker (flag makeup work) | ⬜ | F | M | |
| Late-work penalty tracking | ⬜ | P | M | Pairs with grade-weighted priority |

## 2. Views & planning
| Item | Status | Tier | Size | Notes |
|---|---|---|---|---|
| Kanban board view | ✅ | F | — | "Kanban" layout (by urgency) |
| Timeline view | ✅ | F | — | Sorted by due date |
| Gantt view for projects | ⬜ | P | L | Needs multi-day tasks and relations |
| Calendar view | 🟡 | F | — | Week list with Overdue, Later and No date sections. Missing: a month grid |
| Calendar time-blocking (drag tasks into time slots) | ⬜ | P | L | |
| Multiple views of the same list | 🟡 | F | M | There are 12 layouts, but one is chosen globally. Idea: saved views (list, board, calendar, gallery) per filter |
| Trim the layouts to the strongest 5 or 6 | ⬜ | — | S | Tension with the item above: fewer, better views vs. more choice. Decide before building saved views |
| Saved custom filters (named quick filters) | ⬜ | F/P | M | Free: 3; Pro: unlimited |
| Today / Upcoming / Someday buckets | ⬜ | F | M | |
| Workload heatmap (days shaded by minutes due) | ⬜ | F | M | "Time left" per subject already exists; this adds the per-day view |
| Eisenhower matrix (urgent vs. important) | ⬜ | P | M | Needs an "important" signal (P1–P4 or grade weight) |
| "My Day" morning planning ritual | ⬜ | P | M | |
| Evening review mode (preview tomorrow) | ⬜ | P | M | |
| Graph / map view of links between subjects and tasks | ⬜ | P | L | Needs relations and backlinks |

## 3. Priority & organization
| Item | Status | Tier | Size | Notes |
|---|---|---|---|---|
| Tags (separate from subjects) | ✅ | F | — | Includes suggestions and now search |
| Manual priority | 🟡 | F | S | Auto / Low / Medium / High exists. Upgrade to P1–P4, independent of due date |
| Pinning / starring tasks | ⬜ | F | S | |
| Rollup fields ("2 subtasks left", "3 days overdue") | 🟡 | F | S | Subtask counts and "Overdue!" exist. Missing: days overdue and a general rollup display |
| Grade / weight-aware prioritization | ⬜ | P | M | Manual weights first; LMS grade sync later |
| Relations (link a task to a parent project or exam) | ⬜ | P | M | |
| Backlinks between notes and tasks | ⬜ | P | M | Needs rich notes |

## 4. Reminders & notifications
| Item | Status | Tier | Size | Notes |
|---|---|---|---|---|
| Multi-offset reminders | ✅ | F | S | 1 week / 1 day / 3 hours / 1 hour / at due time |
| Reminders with the app closed (push) | ⬜ | F | XL | See 0.2; needs server-side reminders |
| Smart rescheduling nudge when a task goes overdue | ⬜ | F | M | "Move to tomorrow?" with one tap |
| Inactivity nudge ("haven't opened the app in 3 days") | ⬜ | F | S | Needs push |
| Email digest (daily or weekly "what's due") | ⬜ | F/P | M | Free: weekly; Pro: daily. Needs Cloud Functions and an email provider |
| Location-based reminders ("at school") | ⬜ | P | L | Web geofencing is limited; realistically needs the installed app or a native wrapper |

## 5. Content, notes & resources
| Item | Status | Tier | Size | Notes |
|---|---|---|---|---|
| Rich per-task notes (checklists, toggles, headings) | ⬜ | F | L | Tasks currently have subtasks and tags only |
| Slash-command block editor for those notes | ⬜ | P | L | |
| Attachments / links per task | ⬜ | F/P | L | Links free; file uploads count against a Pro storage limit (Cloud Storage costs money) |
| Per-subject resource library (syllabus, formula sheet, teacher contact) | ⬜ | P | M | |
| Page icons / covers per subject | ⬜ | F | S | |
| Color-coded sticky notes (Keep-style, separate from tasks) | ⬜ | F | M | The old scratchpad was removed with the Tools tab; this could replace it |
| Syllabus re-import diffing (detect changed due dates, no duplicates) | ⬜ | F | M | Import exists; it currently always adds new tasks |
| Full-text search across notes | 🟡 | F | S | Search covers titles, subjects and tags; extend it to notes once they exist |

## 6. Quick capture & input
| Item | Status | Tier | Size | Notes |
|---|---|---|---|---|
| Natural-language quick add ("Essay Friday 5pm #English p1") | ⬜ | F | M | High value; pairs with the command palette |
| Command palette (Cmd/Ctrl+K: add, search, jump to anywhere) | ⬜ | F | M | |
| Global quick-capture hotkey | ⬜ | F | S | In-app shortcut; a system-wide hotkey needs the browser extension or desktop app |
| Bulk CSV / spreadsheet import | ⬜ | F | M | Export exists |
| JSON import (restore an export) | ✅ | F | S | Menu → Backup & export → Import backup (JSON); merges, skipping tasks already present |
| Voice-to-task | ⬜ | P | M | Web Speech API; parse the result with natural-language quick add |
| Camera syllabus scan (OCR) | ⬜ | P | L | Server OCR costs money, so Pro |
| Browser / email-to-task | ⬜ | P | L | Email-in address needs a backend; the browser side is covered in section 13 |

## 7. Gamification & motivation
| Item | Status | Tier | Size | Notes |
|---|---|---|---|---|
| Time spent vs. estimated | 🟡 | F | S | Work sessions are now logged on tasks; add a comparison ("you usually take 1.4× your estimate") |
| Weekly / monthly recap card | 🟡 | F | M | Inbox shows week/month/year stats; make it a shareable, designed card |
| Standalone habit tracker (GitHub-style heatmap) | ⬜ | P | M | |
| Completion celebration (check-draw animation, confetti on "Nothing left") | ⬜ | F | S | See Animations |

## 8. Focus & wellbeing
| Item | Status | Tier | Size | Notes |
|---|---|---|---|---|
| Focus Mode with Pomodoro | ✅ | F | — | Now chimes and notifies when done, and shows its time on the Focus tab |
| Configurable Pomodoro (work/break lengths, auto-start breaks) | ⬜ | F | S | Currently fixed at 25 minutes |
| Post-session reflection log | ⬜ | P | S | Prompt after ending a work session |
| Site / app blocker during Focus Mode | ⬜ | P | L | Only possible through the browser extension |

## 9. Collaboration & social
| Item | Status | Tier | Size | Notes |
|---|---|---|---|---|
| Read-only share link | ⬜ | F | M | New Firestore path plus public read rules; careful privacy review needed |
| Shared / collaborative task lists | ⬜ | P | XL | Needs a real data-model change (list membership, per-list rules) |
| Comments / @mentions on tasks | ⬜ | P | L | Depends on shared lists |
| Shared / public class page | ⬜ | P | L | |
| Accountability-partner check-ins | ⬜ | P | M | |
| Opt-in friend streak leaderboard | ⬜ | F | M | |
| Study-group matching | ⬜ | P | XL | Moderation and safety needed, especially for under-18s |
| Parent / guardian view or digest email | ⬜ | P | M | Needs email digest; consent flow required |

> Anything social or student-facing needs a careful look at child-safety and privacy law (COPPA and similar) before launch. The privacy policy currently says the app isn't directed at under-13s.

## 10. School & LMS integrations
| Item | Status | Tier | Size | Notes |
|---|---|---|---|---|
| .ics feed subscription (import a school calendar) | ⬜ | F | M | Easiest integration; good first one |
| Google Classroom sync | ⬜ | P | XL | OAuth plus Google's app verification process |
| Canvas LMS integration | ⬜ | P | XL | |
| Schoology / PowerSchool / Blackboard | ⬜ | P | XL | One at a time, driven by demand |
| Grade sync from the LMS (feeds weighted priority) | ⬜ | P | L | Depends on an LMS integration |

## 11. Calendar & communication integrations
| Item | Status | Tier | Size | Notes |
|---|---|---|---|---|
| .ics export feed (subscribe to DuePlanner from any calendar) | ⬜ | F | M | One-way; much easier than two-way sync |
| Two-way Google Calendar sync | ⬜ | P | XL | |
| Outlook / Microsoft 365 sync | ⬜ | P | XL | |
| Slack / Discord webhook notifications | ⬜ | P | M | |
| SMS reminders (Twilio) | ⬜ | P | M | Costs money per message, so Pro only |

## 12. Other productivity-tool integrations
| Item | Status | Tier | Size | Notes |
|---|---|---|---|---|
| Zapier / Make / IFTTT (webhooks in and out) | ⬜ | P | L | Builds on the public API (section 14) |
| Notion export / sync | ⬜ | P | L | |
| Zotero / citation manager link | ⬜ | P | M | |
| Anki / Quizlet flashcard linking | ⬜ | P | M | |

## 13. Hardware & OS integrations
| Item | Status | Tier | Size | Notes |
|---|---|---|---|---|
| Installable app | ✅ | F | — | Add to Home Screen now uses the browser's install prompt |
| Home-screen widget (next tasks at a glance) | ⬜ | P | XL | Not possible for a web app; needs a native wrapper (e.g. Capacitor) |
| Browser extension ("add to planner" button) | ⬜ | F | L | Also enables the site blocker and a global hotkey |

## 14. Data & portability
| Item | Status | Tier | Size | Notes |
|---|---|---|---|---|
| CSV / JSON export | ✅ | F | — | JSON now includes settings |
| "Download all my data" | ✅ | F | — | JSON export covers it; could be labelled as such in the Danger Zone |
| JSON import | ✅ | F | S | Same item as in section 6 |
| Print-friendly weekly agenda / PDF | ⬜ | F | M | A print stylesheet gets most of the way |
| Public API / webhooks out | ⬜ | P | XL | Needs API keys, per-user limits and docs |
| Remappable keyboard shortcuts | ⬜ | P | M | Needs a shortcuts system first (command palette) |

---

## 15. Design & polish
| Item | Status | Size | Notes |
|---|---|---|---|
| Liquid Glass look (optional) | ✅ | — | Settings → Looks |
| Cards slide into place when completed, reordered or filtered (view transitions per card) | ⬜ | M | |
| Completing a task: check draws in, text strikes through, card settles to the bottom | ⬜ | S | |
| Task detail follows your finger while dragging and springs back or away on release | 🟡 | S | Drag-to-dismiss exists; add spring physics |
| Menus scale out from where you tapped | ⬜ | S | |
| Focus Mode timer ring "breathes" in the last minute | ⬜ | S | |
| Liquid Glass extras: highlight that follows the cursor or tilts with the phone | ⬜ | S | |
| Respect reduced motion (`prefers-reduced-motion`) for all of the above | ⬜ | S | Do this alongside the animations, not after |

## 16. Product basics
Things most people expect from an app like this that are missing today.
| Item | Status | Tier | Size | Notes |
|---|---|---|---|---|
| First-run onboarding (a short tour, or 3 questions: school level, subjects, reminders) | ⬜ | F | M | New users currently land on sample tasks with no explanation |
| Edit every task field in the detail view (title, subject, due date/time, estimate, recurrence) | ✅ | F | M | Today most fields can only be set while adding a task |
| Rename subjects and change their colors (not just add/delete) | ⬜ | F | S | |
| Undo for more than deletes (completing, editing, archiving) | 🟡 | F | M | History is delete-only |
| "Restore" button in the Archived view | ✅ | F | S | Restore button in an archived task's detail view |
| Keyboard shortcuts (n = new task, / = search, j/k to move, x = complete) | ⬜ | F | S | Pairs with the command palette |
| Full accessibility pass (screen reader, keyboard-only use, contrast, focus rings) | 🟡 | F | M | Button labels were added in the audit; needs a real screen-reader pass |
| Other languages (start with Spanish) | ⬜ | F | L | Move all text into one strings file first |
| Date/time settings: 12h/24h, week starts Monday or Sunday | ⬜ | F | S | The week currently always starts Sunday |
| Help / FAQ page and in-app "What's this?" hints | ⬜ | F | M | |
| In-app feedback form (replaces the Google Form link) | ⬜ | F | S | |

## 17. Accepted ideas (from `IDEAS.md`)
Picked from the ideas list in two review batches (#1–112, then #113–162); `#` is the item's number in `IDEAS.md`. Every
feature is free for now, so these have no tier.

**Label:** **Yes** = accepted as written · **With tweaks** = accepted, but the details need deciding before building · **Maybe** = still undecided

### Smart planning
| # | Item | Label | Size | Notes |
|---|---|---|---|---|
| 1 | Auto-scheduler: split a big task into daily chunks before its due date, based on free time | Yes | XL | Works best once the timetable (section 1) and the workload heatmap (section 2) exist |
| 6 | "I have 20 minutes": pick the best task that fits the time available | Yes | S | |
| 8 | Overload forecast ("Thursday is packed — start the lab report Monday") | Yes | M | Builds on the workload heatmap and conflict detection |
| 11 | Per-subject defaults (e.g. Math always due 8:00 AM, 30 minutes) | With tweaks | S | |
| 12 | Energy-based scheduling (morning person / night owl) | Maybe | L | Only useful together with the auto-scheduler |
| 161 | Ask DuePlanner: type a question ("what's due Thursday?", "how much Math is left?") and get an answer | Yes | L | Common questions can be answered with simple rules first; a full AI version needs a server, since an AI API key can't live in the app |
| 162 | Tidy titles: fix capitalization and typos in task titles | Yes | S | Capitalization is simple rules; typo fixing needs a dictionary or AI |

### Task details
| # | Item | Label | Size | Notes |
|---|---|---|---|---|
| 13 | Difficulty rating (easy / medium / hard), separate from time | Yes | S | Could feed the auto-scheduler and priority |
| 14 | Progress slider (% done) for tasks without subtasks | Yes | S | Would also give the Progress layout something to show for tasks without subtasks |
| 16 | Custom repeat patterns (Mon/Wed/Fri, every 2 weeks, last day of the month) | Yes | M | |
| 17 | Repeat end date or count | With tweaks | S | Pairs with #16 |
| 18 | Duplicate task | Yes | S | ✅ Done: in the task detail view |
| 19 | Task history (created, edited, completed) | Maybe | M | |
| 20 | "Waiting on" status (e.g. waiting for teacher feedback) | With tweaks | S | |
| 21 | Submission checklist ("Submitted on Canvas ✓", optional screenshot) | With tweaks | M | A screenshot needs file storage (see Attachments, section 5) |
| 22 | Assignment types (homework, quiz, test, project, lab) with icons and default estimates | With tweaks | M | Overlaps with per-subject defaults (#11); worth designing together |
| 24 | Group project notes (teammates, who's doing what) | Maybe | S | |

### Grades & academics
| # | Item | Label | Size | Notes |
|---|---|---|---|---|
| 25 | Grade received on finished tasks | Yes | S | First step toward grade-weighted priority (section 3) |
| 29 | Terms / semesters: archive a term and start a new one | With tweaks | M | |
| 30 | Report-card view per term | Maybe | M | Depends on #25 and #29 |
| 32 | Reading tracker (pages per day to finish by the due date) | Yes | M | |
| 37 | Extracurricular layer (clubs, sports, practices on the calendar) | Maybe | M | Shares plumbing with the class timetable (section 1) |
| 153 | Free-period suggestions: during a free period on your timetable, suggest a task that fits | With tweaks | M | Needs the class timetable (section 1) |

### Focus & wellbeing
| # | Item | Label | Size | Notes |
|---|---|---|---|---|
| 40 | Daily focus goal (e.g. 90 minutes) with a streak | With tweaks | S | Work sessions are already logged |
| 43 | Quiet hours for notifications | Maybe | S | |
| 47 | Session goal ("finish the intro"), checked at the end | Yes | S | Pairs with the post-session reflection log (section 8) |
| 132 | Pick which task Focus Mode is about, not only the first one | Yes | S | ✅ Done: "Change task" in Focus Mode |
| 133 | Pomodoro time counts as a work session on that task | Yes | S | ✅ Done: a finished Pomodoro logs 25 minutes to the focus task |
| 135 | Keep the screen awake during Focus Mode | Yes | S | ✅ Done (Screen Wake Lock API; not every browser supports it) |
| 136 | Next-task suggestion when a break ends | Yes | S | The Pomodoro has no break phase yet; build with configurable Pomodoro (section 8) |
| 137 | End-of-day shutdown: review what you finished, roll leftovers to tomorrow | Yes | M | Close to Evening review (section 2); design them together |
| 138 | Flow mode: hide clocks and counts while focusing | Yes | S | |

### Motivation & fun
| # | Item | Label | Size | Notes |
|---|---|---|---|---|
| 49 | XP and levels for finishing on time | Maybe | M | |
| 54 | Semester "Wrapped" recap | Yes | M | Partly exists: the Inbox's week/month/year stats. Build it together with the recap card in section 7 |
| 55 | Daily challenge ("finish 3 tasks before 6 PM") | Maybe | S | |
| 56 | Sound effect on completing a task (toggle) | Yes | S | Can reuse the Pomodoro chime's Web Audio approach |
| 139 | "Done today" list: everything finished today in one place | With tweaks | S | |
| 140 | Weekly progress bar in the header ("7 of 12 done this week") | With tweaks | S | |
| 142 | Subject cleared: a small celebration when a subject has nothing left | With tweaks | S | Pairs with the completion celebration (section 7) |
| 143 | Personal greeting ("Good evening — 3 things left today") | Yes | M | **As a greeting screen when the app opens** (your note). Overlaps with the morning briefing (#91) and My Day (section 2) |

### Look & layout
| # | Item | Label | Size | Notes |
|---|---|---|---|---|
| 60 | Desktop split view (list left, task detail right) | Yes | M | |
| 62 | Alternate app icons | Maybe | M | Needs the native app (L1) on iOS |
| 63 | Customizable home dashboard | With tweaks | L | |
| 64 | Text size and density settings | Yes | S | |
| 67 | Haptic feedback on mobile | Yes | S | Limited on iOS Safari; full support needs the native app (L1) |
| 68 | Mac menu-bar app / desktop widget with the next task | Yes | L | Needs a desktop wrapper (e.g. Tauri or Electron) |
| 69 | Chrome new-tab page with today's tasks | Maybe | M | Could ship as part of the browser extension (section 13) |

### Quick capture
| # | Item | Label | Size | Notes |
|---|---|---|---|---|
| 72 | Siri Shortcuts / Google Assistant actions | Yes | L | Needs the native app (L1) |
| 74 | Paste a list → one task per line | With tweaks | S | Could run each line through natural-language quick add (section 6) |
| 76 | Complete or snooze from the notification itself | Yes | M | Needs service-worker notification actions; best alongside push (section 0.2) |

### Notifications
| # | Item | Label | Size | Notes |
|---|---|---|---|---|
| 91 | Morning briefing notification with today's plan | Yes | M | Reliable delivery needs push (section 0.2) |
| 92 | Escalating urgency (gentle first, firmer near the deadline) | With tweaks | S | Extends the existing multi-offset reminders |
| 155 | Choose when the daily summary arrives (e.g. 7 AM or 6 PM) | Yes | S | Arriving at a set time with the app closed needs push (section 0.2) |
| 156 | Good-news notification: "Nothing due tomorrow" | Yes | S | Needs push to arrive with the app closed |
| 157 | Reminder sound and vibration choice | Yes | M | Web notifications give little control over sound; full choice needs the native app (L1) |

### Insights
| # | Item | Label | Size | Notes |
|---|---|---|---|---|
| 95 | Productivity insights (best hours, slowest subject) | Yes | M | Uses the logged work sessions |
| 97 | On-time rate over time chart | Yes | S | The Inbox already computes the on-time % |
| 99 | Year-over-year history of past terms | Maybe | M | Depends on terms (#29) |

### Accounts & privacy
| # | Item | Label | Size | Notes |
|---|---|---|---|---|
| 100 | "Last synced" time and offline indicator | Yes | S | |
| 101 | Multiple spaces (school, personal, work) | With tweaks | L | Data-model change: each task belongs to a space |
| 102 | More sign-in options (email link / passkey, Apple, Microsoft) | Yes | M | Sign in with Apple is required anyway for the iOS app (L1) |
| 103 | Switch between accounts without signing out | Yes | M | |
| 158 | Recently deleted: a 30-day trash for restoring tasks after the undo toast is gone | Yes | M | Deleted tasks become "soft deleted" (hidden, still synced) and are purged after 30 days |

### Planning & deadlines
| # | Item | Label | Size | Notes |
|---|---|---|---|---|
| 113 | Soft deadlines: your own "done by" date before the real due date; reminders and urgency use it | With tweaks | M | Still show the real due date alongside it |
| 116 | "Start by" date, worked out from the estimate and due date | With tweaks | S | Needs an estimate; pairs with #113 |
| 118 | Skip one occurrence of a repeating task ("no quiz this week") | Yes | S | Builds on how repeating tasks spawn their next copy |
| 119 | Snow day button: push everything due today to tomorrow in one tap | With tweaks | S | Should be undoable |
| 120 | "Fix my overdue": one screen to reschedule, finish or drop every overdue task | With tweaks | M | Close to the smart rescheduling nudge (section 4) |
| 122 | Live countdown on tasks due today with a time ("due in 2h 15m") | Yes | S | |
| 123 | Task age ("added 12 days ago") to spot tasks that keep sitting there | With tweaks | S | Tasks don't store a creation time yet; needs a `createdAt` field |
| 124 | Custom reminder time on a single task ("remind me at 7 PM") | Maybe | M | Extends the existing reminder system |

### Adding & editing
| # | Item | Label | Size | Notes |
|---|---|---|---|---|
| 125 | Quick add option: a one-line add instead of the wizard (setting: Wizard / Quick) | With tweaks | M | Pairs with natural-language quick add (section 6) |
| 127 | Long-press / right-click menu on a task: done, snooze, duplicate, change date, delete | With tweaks | M | |
| 128 | Choose what swiping left and right does | Yes | S | |
| 129 | Inline editing: tap a task's title or date in the list to change it | Yes | M | Overlaps with editing every field in the detail view (section 16) |
| 131 | Pinned note to yourself at the top of the list | With tweaks | S | |

### Integrations
| # | Item | Label | Size | Notes |
|---|---|---|---|---|
| 106 | Import from Todoist / TickTick | Maybe | M | |

## 18. Teachers & schools
A possible second market: teachers publish assignments, students receive
them. All of this section was accepted from `IDEAS.md` (#78–82).

| # | Item | Size | Notes |
|---|---|---|---|
| 78 | Teacher accounts that publish assignments to their students | XL | Needs a new data model (classes, memberships, published assignments) and account roles |
| 79 | Class codes: students join a teacher's feed with a code | L | Published assignments appear as tasks the student owns and can edit |
| 80 | Teacher insights: how many students have started an assignment | L | Needs a clear privacy model: students should know what teachers can see |
| 81 | School / district licensing | XL | Contracts, invoicing, admin dashboards; schools often require data agreements |
| 82 | Tutor view: a tutor sees a student's upcoming work, with permission | M | Shares the permission system with the parent/guardian view (section 9) |

Things to decide before building this section:
- **Privacy and law.** Student data in schools falls under FERPA (US), COPPA for under-13s, and state student-privacy laws. Districts usually require a signed data-privacy agreement.
- **Integrations overlap.** Google Classroom and Canvas (section 10) cover some of the same ground. This section is for teachers who don't use an LMS, or who want DuePlanner-specific features.
- **Who signs up first.** Teacher-first (teachers invite classes) or student-first (students ask teachers to join). This changes onboarding and marketing.
- **Moderation.** Teacher accounts need verification so strangers can't create a "class" to contact students.

---

## Launch & infrastructure

### L1. Mobile app
| Item | Status | Size | Notes |
|---|---|---|---|
| Decide the approach | ⬜ | S | **Recommended: Capacitor.** It wraps the existing web app as a real iOS/Android app with little rewriting and adds native plugins (push, widgets, haptics). React Native/Expo feels more native but is close to a rewrite. The installable web app already exists and costs nothing |
| Apple Developer account ($99/year) and Google Play account ($25 once) | ⬜ | S | |
| Native Google Sign-In (plugin) | ⬜ | M | The web popup flow doesn't work inside a native app |
| **Sign in with Apple** | ⬜ | M | Apple requires it on iOS when an app offers another third-party login such as Google |
| Native push notifications (APNs/FCM) | ⬜ | L | Uses the same server-side reminder system as web push |
| In-app purchases for Pro on iOS/Android | ⬜ | L | Apple and Google require their own billing for digital subscriptions bought inside apps (15–30% cut). RevenueCat can unify this with Stripe on the web |
| Home-screen widgets (next tasks) | ⬜ | XL | Needs native Swift (iOS) and Kotlin (Android) code, even with Capacitor |
| Store listings: screenshots, description, privacy labels, age rating | ⬜ | M | |
| Beta testing (TestFlight on iOS, internal testing on Android) | ⬜ | S | |
| App review preparation (demo account, notes on background features) | ⬜ | S | |

### L2. Firebase optimization (and whether to switch)
| Item | Status | Size | Notes |
|---|---|---|---|
| Lazy-load Firebase after the first paint | ⬜ | M | The Firebase SDK is most of the bundle; the app can render from local storage first and connect just after |
| Load Analytics and Performance Monitoring only once the app is idle | ⬜ | S | They don't need to block startup |
| Stop re-reading archived tasks on every load (separate collection, or a query that skips them) | ⬜ | M | Long-time users will build up hundreds of archived tasks, each one a read |
| Check read/write counts against the free tier (50k reads / 20k writes per day) | ⬜ | S | Firebase console → Usage. Estimate the cost per 1,000 users before setting Pro prices |
| Fewer settings writes (one per change burst, not one per toggle) | ⬜ | S | |
| **Decision: stay on Firebase or switch?** | ⬜ | S | **Recommendation: stay for now.** Firebase's offline cache, real-time sync and sign-in do a lot of work for free, and migrating means weeks of risk. Revisit only if cost or limits become a real problem. If switching, **Supabase** (Postgres, row-level security, real-time, SQL for analytics, open source) is the most likely pick; Convex, Appwrite and PocketBase are alternatives. Decide **before** building Stripe entitlements and Cloud Functions, since those deepen the lock-in |

### L3. Custom domain
| Item | Status | Size | Notes |
|---|---|---|---|
| Buy a domain (e.g. `dueplanner.app` or `dueplanner.com`), plus one for Due Studios | ⬜ | S | `.app` domains force HTTPS, which is good |
| Point it at Vercel, and redirect `dueplanner.vercel.app` to it | ⬜ | S | |
| **Update sign-in for the new domain** | ⬜ | S | `authDomain` in `App.tsx` is `dueplanner.vercel.app` (through the `/__/auth` proxy in `vercel.json`). Change it, and add the new domain to Firebase → Authentication → Authorized domains and to the Google OAuth client's redirect URIs, or sign-in breaks |
| Decide the split: marketing site at the root, app on an `app.` subdomain (or at `/app`) | ⬜ | S | Lets the landing page change without touching the app |
| Update links: `privacy.html`, the install manifest, social preview tags, `CLAUDE.md` | ⬜ | S | |

### L4. Business email
| Item | Status | Size | Notes |
|---|---|---|---|
| Choose a provider | ⬜ | S | **Google Workspace** (about $7/user/month, works like Gmail) or **Zoho Mail** (has a free tier). Cheapest start: Cloudflare Email Routing (free forwarding to your Gmail) |
| Addresses: `hello@`, `support@`, `privacy@`, `billing@` | ⬜ | S | Aliases of one inbox are enough at first |
| Replace the personal Gmail address in `privacy.html` with `privacy@` | ⬜ | S | |
| SPF, DKIM and DMARC records | ⬜ | S | Without these, emails land in spam |
| A sending service for digests and receipts (e.g. Resend or Postmark) | ⬜ | M | Separate from your inbox; needed for the email digest |

### L5. Landing page
| Item | Status | Size | Notes |
|---|---|---|---|
| Hero: one sentence on what DuePlanner is, a screenshot or short video, and an "Open the app" button | ⬜ | M | |
| Feature sections with real screenshots, pricing, FAQ, and a footer with privacy/terms | ⬜ | M | |
| Waitlist / email signup before launch | ⬜ | S | |
| A designed social preview image | ⬜ | S | Links currently preview with the app icon |
| SEO basics: titles, descriptions, sitemap, fast load | ⬜ | S | |
| Tech: a static site (e.g. Astro) or a separate page in this repo | ⬜ | S | Static keeps it fast and independent of the app |
| Blog or study-tips pages for search traffic | ⬜ | L | Later |
| Testimonials from beta users | ⬜ | S | After the beta |

### L6. Pre-launch checklist
| Item | Status | Size | Notes |
|---|---|---|---|
| **Legal:** Terms of Service; privacy policy updated for Stripe, Sentry, the email provider and data retention | ⬜ | M | Consider a lawyer's review before charging money |
| **Age:** decide on under-13 users (COPPA) and add an age question at sign-up if needed | ⬜ | M | The privacy page says the app isn't for under-13s, but nothing enforces it |
| **Privacy laws:** GDPR/CCPA basics, analytics consent for visitors from the EU | ⬜ | M | |
| **Trademark check** for "DuePlanner" and "Due Studios" | ⬜ | S | There's already an app called "Due" in the same category |
| Claim social handles (Instagram, TikTok, X, YouTube) | ⬜ | S | |
| Test on real devices: iPhone Safari, Android Chrome, desktop Chrome/Firefox/Safari/Edge, Arc | ⬜ | M | |
| Performance: Lighthouse score; test on a slow phone and a slow network | ⬜ | S | |
| Accessibility check (see section 16) | ⬜ | M | |
| Security review: rules, headers, dependencies, App Check enforced | ⬜ | M | |
| Test the backups by actually restoring one | ⬜ | S | |
| Stripe: switch from test mode to live; test refunds and failed payments | ⬜ | S | |
| Support: `support@` inbox, help page, a response-time goal | ⬜ | S | |
| Analytics: choose the key numbers (sign-ups, day-7 retention, tasks created, upgrades) | ⬜ | S | |
| Closed beta with 20–50 students, and fix what they run into | ⬜ | L | |
| Launch plan: Product Hunt, Reddit (e.g. r/GetStudying), school clubs, TikTok study content | ⬜ | M | |
| Rollback plan: revert a bad deploy fast (Vercel instant rollback, feature flags) | ⬜ | S | |

---

## Suggested order

1. **Groundwork (weeks 1–3):** safer sync, rules tests in CI, error monitoring, a separate dev/staging Firebase project, splitting `App.tsx` and adding shared components. Nothing user-visible, but it makes everything else safer. Also make the Firebase-or-switch decision now (L2), before anything deepens the lock-in. Cheap side tasks that can start any time: buy the domain and set up business email (L3, L4).
2. **Cheap, high-value free features (weeks 3–6):** natural-language quick add and the command palette, snooze, JSON import, Today/Upcoming/Someday, the workload heatmap, pinning and P1–P4, "1 week before" reminders, and the animation pass.
3. **Freemium launch (weeks 6–9):** budget alerts first, then Stripe, server-side entitlements, the upgrade screen, and the first Pro features that are cheap to run and clearly valuable: saved filters (unlimited), My Day and Evening review, the Eisenhower matrix, the habit tracker, and reflection logs.
4. **Server-side reminders and email (weeks 9–12):** push notifications with the app closed, the inactivity nudge, and the email digest. These make the app feel "real" and support Pro.
5. **Integrations (ongoing):** the .ics feeds first (both directions), then Google Calendar, then Google Classroom and Canvas.
6. **Social and collaboration (later):** after a privacy and safety review. Start with read-only share links.

**Alongside phases 2–4:** the landing page and waitlist (L5), then the pre-launch checklist (L6) before the public launch. **Once the web launch is stable:** the mobile app (L1).

---

## Phase details

### Phase 1: Groundwork

Under-the-hood work with no new user-facing features. It goes first because
almost everything later touches `App.tsx`, and Pro features will depend on
sync and the security rules being solid.

| # | Item | What it involves | Why | Risk / cost |
|---|---|---|---|---|
| 1 | Safer sync | An `updatedAt` on each task so the newer edit wins when two devices conflict; write only the changed fields instead of the whole task | Fixes the known issue where another device's change arriving within the 400ms write delay can overwrite a local edit | Low risk, high value: protects user data |
| 2 | Rules tests in CI | Run `npm run test:rules` (Firestore emulator) in GitHub Actions on every push | A rules change that would break sync gets caught before it's deployed, not after | Needs Java in the CI image; otherwise low risk |
| 3 | Error monitoring | Add Sentry (the free tier is enough) for crashes and sync errors | You see real users' problems, not only the ones you hit yourself | Needs a Sentry account; add Sentry to `privacy.html` |
| 4 | Split `App.tsx` | Move the layouts, Settings, the add-task wizard and the task detail into their own files | Smaller, safer changes; fewer unrelated breakages | Big refactor with no visible payoff; small risk of visual regressions, so move carefully and check screenshots as you go |
| 5 | Shared components | A few reusable pieces (Card, Chip, IconButton, SectionLabel) replacing repeated inline styles | Visual changes (themes, Liquid Glass) happen in one place instead of dozens | Same as #4 |

**Suggested order within the phase:** 1 → 2 → 3 → 4 → 5. Items 1–2 are the
most valuable and can ship on their own. If visible progress is wanted sooner,
4–5 can be deferred, at the cost of slower and riskier feature work until
they're done.
