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
| Run the Firestore rules tests in CI (emulator in GitHub Actions) | ⬜ | S | Currently local-only |
| Scheduled Firestore backups (exports to Cloud Storage) | ⬜ | S | |
| Crash and error monitoring (e.g. Sentry) | ⬜ | S | Include sync errors, not just crashes |
| Split `App.tsx` (about 3,100 lines) into layout, page and wizard components | ⬜ | L | Makes every item below safer to build |
| Shared UI components (Card, Chip, IconButton, SectionLabel) instead of repeated inline styles | ⬜ | L | Makes Liquid Glass and future themes much simpler |

---

## 1. Task & scheduling core
| Item | Status | Tier | Size | Notes |
|---|---|---|---|---|
| Bulk edit (multi-select, change fields at once) | 🟡 | F | M | Exists for the List layout (Done, Archive, Subject, Delete). Missing: other layouts, and editing the due date and priority |
| Snooze / "later today" quick action | ⬜ | F | S | Swipe action or modal button: later today / tomorrow / next week |
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
| Multi-offset reminders | 🟡 | F | S | 1 day / 3 hours / 1 hour / at due time exist. Add "1 week before" |
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
| JSON import (restore an export) | ⬜ | F | S | Export exists, but there's no way back in |
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
| JSON import | ⬜ | F | S | Same item as in section 6 |
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

---

## Suggested order

1. **Groundwork (weeks 1–3):** safer sync, rules tests in CI, error monitoring, splitting `App.tsx` and adding shared components. Nothing user-visible, but it makes everything else safer.
2. **Cheap, high-value free features (weeks 3–6):** natural-language quick add and the command palette, snooze, JSON import, Today/Upcoming/Someday, the workload heatmap, pinning and P1–P4, "1 week before" reminders, and the animation pass.
3. **Freemium launch (weeks 6–9):** Stripe, server-side entitlements, the upgrade screen, and the first Pro features that are cheap to run and clearly valuable: saved filters (unlimited), My Day and Evening review, the Eisenhower matrix, the habit tracker, and reflection logs.
4. **Server-side reminders and email (weeks 9–12):** push notifications with the app closed, the inactivity nudge, and the email digest. These make the app feel "real" and support Pro.
5. **Integrations (ongoing):** the .ics feeds first (both directions), then Google Calendar, then Google Classroom and Canvas.
6. **Social and collaboration (later):** after a privacy and safety review. Start with read-only share links.
