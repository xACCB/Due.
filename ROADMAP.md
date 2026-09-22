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

## 16. Product basics
Things most people expect from an app like this that are missing today.
| Item | Status | Tier | Size | Notes |
|---|---|---|---|---|
| First-run onboarding (a short tour, or 3 questions: school level, subjects, reminders) | ⬜ | F | M | New users currently land on sample tasks with no explanation |
| Edit every task field in the detail view (title, subject, due date/time, estimate, recurrence) | ⬜ | F | M | Today most fields can only be set while adding a task |
| Rename subjects and change their colors (not just add/delete) | ⬜ | F | S | |
| Undo for more than deletes (completing, editing, archiving) | 🟡 | F | M | History is delete-only |
| "Restore" button in the Archived view | 🟡 | F | S | Archived tasks can be viewed, but there's no explicit restore |
| Keyboard shortcuts (n = new task, / = search, j/k to move, x = complete) | ⬜ | F | S | Pairs with the command palette |
| Full accessibility pass (screen reader, keyboard-only use, contrast, focus rings) | 🟡 | F | M | Button labels were added in the audit; needs a real screen-reader pass |
| Other languages (start with Spanish) | ⬜ | F | L | Move all text into one strings file first |
| Date/time settings: 12h/24h, week starts Monday or Sunday | ⬜ | F | S | The week currently always starts Sunday |
| Help / FAQ page and in-app "What's this?" hints | ⬜ | F | M | |
| In-app feedback form (replaces the Google Form link) | ⬜ | F | S | |

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
