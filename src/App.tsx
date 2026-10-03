import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { flushSync } from "react-dom";
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, signOut as fbSignOut, onAuthStateChanged, deleteUser } from "firebase/auth";
import type { User } from "firebase/auth";
import { initializeFirestore, connectFirestoreEmulator, doc, getDoc, getDocFromServer, setDoc, updateDoc, deleteField, collection, getDocs, writeBatch, onSnapshot, persistentLocalCache, persistentMultipleTabManager } from "firebase/firestore";
import type { QueryDocumentSnapshot } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";
import { getPerformance } from "firebase/performance";
import { getAnalytics, isSupported as isAnalyticsSupported } from "firebase/analytics";
import type { Priority, Recurrence } from "./types";
import { THEMES } from "./themes";
import type { ThemeName, ThemeObj } from "./themes";
import { localDateStr, todayISO, advanceDate } from "./lib/dates";
import { nextId } from "./lib/id";
import { ANIM_SPEED, clampSpeed, setAnimationSpeed, animationRate, scaledMs } from "./lib/animSpeed";
import { newRecaps, mergeRecaps, recapMessage } from "./lib/recaps";
import type { Recap } from "./lib/recaps";
import { parseSyllabus } from "./lib/syllabus";
import { contrastColor, readableOn, getPriority, formatDate, csvField, formatTime, daysUntil, formatDuration, countdown, formatAgo } from "./lib/format";
import { DUE_BUCKETS, dueBucket, mostUrgent } from "./lib/timeLeft";
import { monthGrid, shiftMonth, weekdayLabels, heatLevel, byDueDate } from "./lib/calendar";
import { stepSpring, springSettled, rubberBand, releaseVelocity, shouldDismiss } from "./lib/spring";
import { reconcile, same } from "./lib/sync";
import { addTaskWrite, addTaskWriteFromActual } from "./lib/taskWrites";
import { diffTasks, applyTaskStates } from "./lib/history";
import type { TaskStates } from "./lib/history";
import type { SyncRecord, CloudRecord } from "./lib/sync";
import { downloadFile } from "./lib/download";
import { LIMITS, addSession, sanitizeTask } from "./lib/limits";
import { usePersistedState } from "./hooks/usePersistedState";
import { normalizeQuestionPrefs, moveQuestion } from "./lib/addQuestions";
import { ErrorBoundary } from "./components/ErrorBoundary";

// ─── FIREBASE ────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyD9W3eTvKjthiEZ_0MjeCHBIZ6BevMKgSo",
  // Deliberately this site's own domain, not Firebase's *.firebaseapp.com --
  // see vercel.json, which transparently proxies /__/auth/** on this domain
  // to Firebase's real handler. Sign-in then never crosses origins at all,
  // which is what actually eliminates (not just mitigates) the class of bug
  // where browsers with strict storage partitioning -- Firefox's Enhanced
  // Tracking Protection notably -- break signInWithRedirect when the auth
  // handler lives on a different origin than the app itself.
  authDomain: "dueplanner.vercel.app",
  projectId: "ai-homework-planner-92260",
  storageBucket: "ai-homework-planner-92260.firebasestorage.app",
  messagingSenderId: "445404835645",
  appId: "1:445404835645:web:c84c3f1bbb8cbfe171df54",
};
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
// ignoreUndefinedProperties: a stray `undefined` field anywhere in a synced
// payload would otherwise make setDoc() throw synchronously (uncaught, since
// this fires from a plain useEffect with no error boundary), crashing the
// whole app to a blank screen instead of just dropping that one field.
//
// localCache/persistentLocalCache: enables an IndexedDB-backed local cache
// instead of the default in-memory-only one, so the app can actually read
// (and queue writes to sync later) while offline, and repeat loads serve from
// the local cache instead of a fresh network round trip every time.
// persistentMultipleTabManager lets multiple open tabs share that cache
// instead of only the first tab getting persistence and the rest silently
// falling back to memory-only. Wrapped in try/catch, with a plain in-memory
// fallback, because this runs at module load time (before React even
// renders) -- if an exotic environment (locked-down IndexedDB, very old
// browser) made this throw synchronously and uncaught, the whole app would
// fail to load at all rather than just missing offline support.
let db: Firestore;
try {
  db = initializeFirestore(fbApp, {
    ignoreUndefinedProperties: true,
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (e) {
  console.error("Firestore persistent cache unavailable, falling back to in-memory cache:", e);
  db = initializeFirestore(fbApp, { ignoreUndefinedProperties: true });
}
// Local development against the Firebase emulators (`npx firebase-tools
// emulators:start --only auth,firestore`), to try sync changes without touching
// real accounts or data. Only in `npm run dev` with VITE_FIREBASE_EMULATORS=1 --
// import.meta.env.DEV is false in every production build.
if (import.meta.env.DEV && import.meta.env.VITE_FIREBASE_EMULATORS === "1") {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
}
const googleProvider = new GoogleAuthProvider();
// App Check proves requests are coming from this real app (not a script
// hitting the project directly with the public firebaseConfig above) via a
// reCAPTCHA Enterprise attestation (classic reCAPTCHA v3 is deprecated in
// favor of this as of when this key was created). Fully inert -- and safe to
// leave committed -- until VITE_RECAPTCHA_SITE_KEY is actually set, since
// without a site key there's nothing to initialize. A site key isn't a
// secret (same category as firebaseConfig: meant to be public, verified
// server-side by Google), so this doesn't need to live outside version
// control. Generating tokens here does nothing on its own -- enforcement
// (Firestore actually rejecting requests without a valid token) is a
// separate switch in the Firebase Console, off by default, and should only
// be flipped on after confirming in the console's App Check metrics that
// real traffic is producing valid tokens -- otherwise it locks out every
// real user at once.
const recaptchaSiteKey = import.meta.env.VITE_RECAPTCHA_SITE_KEY;
if (recaptchaSiteKey) {
  initializeAppCheck(fbApp, {
    provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}
// Automatically tracks real-world page load time and network request
// latency, visible in Firebase Console -> Performance. No setup/key needed
// (unlike App Check) and included on the free Spark plan. Wrapped in
// try/catch since it relies on browser Performance APIs that could be
// missing in an unsupported environment -- shouldn't be able to break the
// app over a monitoring feature.
try {
  getPerformance(fbApp);
} catch (e) {
  console.error("Firebase Performance Monitoring unavailable:", e);
}
// Basic usage analytics (page views, sessions, engagement time) -- free on
// the Spark plan, visible in Firebase Console -> Analytics. isSupported() is
// used (not just try/catch) because the underlying gtag.js script commonly
// gets blocked outright by ad/privacy blocker extensions (AdGuard, uBlock,
// etc.) rather than throwing -- isSupported() checks this explicitly instead
// of silently failing partway through initialization. If the project's never
// had Google Analytics linked at the Firebase-project level, this will just
// silently collect nothing rather than error.
isAnalyticsSupported().then(supported => {
  if (!supported) return;
  try {
    getAnalytics(fbApp);
  } catch (e) {
    console.error("Firebase Analytics unavailable:", e);
  }
}).catch(()=>{});
// Detects the signature of a browser blocking the storage handoff Firebase
// needs to complete signInWithRedirect across the round trip through its
// authDomain (a different origin from this site) -- notably Firefox's
// Enhanced Tracking Protection / Total Cookie Protection, on by default. This
// shows up two different ways depending on exactly when the browser blocks
// it: sometimes getRedirectResult() just resolves with no result and no
// error (handled separately, see the "no result" branch below), and
// sometimes it throws this specific error instead ("missing initial state" /
// web-storage-unsupported) -- both are the same underlying cause and deserve
// the same actionable message, not a generic "unknown error".
function isStorageBlockedError(e: unknown): boolean {
  const code = (e as { code?: string })?.code || "";
  const message = ((e as { message?: string })?.message || "").toLowerCase();
  return code === "auth/web-storage-unsupported"
    || message.includes("missing initial state")
    || message.includes("sessionstorage");
}
const STORAGE_BLOCKED_MESSAGE = "Sign-in was blocked by your browser's tracking protection. In Firefox: click the shield icon in the address bar and turn off Enhanced Tracking Protection for this site, then try again. Chrome and Edge don't hit this issue.";

const LAYOUTS = {
  list:      { name:"List",       emoji:"☰",  desc:"Classic cards" },
  board:     { name:"Board",      emoji:"⊞",  desc:"Grid cards" },
  checklist: { name:"Checklist",  emoji:"☑",  desc:"Simple ticks" },
  kanban:    { name:"Kanban",     emoji:"𝄘",  desc:"By urgency" },
  progress:  { name:"Progress",   emoji:"▓",  desc:"Subtask progress" },
  pyramid:   { name:"Pyramid",    emoji:"△",  desc:"By priority" },
} as const;
type LayoutName = keyof typeof LAYOUTS;

// ─── TAB BAR ICONS ─────────────────────────────────────────────────────────────
// Small stroke-based SVGs (not Unicode glyphs) for the icon-only main tab bar --
// built from plain primitives (line/circle/polyline) rather than hand-drawn path
// data, so they render identically and crisply everywhere instead of depending on
// whichever symbols a given OS/browser's font happens to ship. `stroke="currentColor"`
// picks up the parent button's `color`, so active/inactive state needs no extra prop.
function IconTasks(){
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="4" cy="6" r="1.3"/><line x1="8.5" y1="6" x2="20" y2="6"/>
    <circle cx="4" cy="12" r="1.3"/><line x1="8.5" y1="12" x2="20" y2="12"/>
    <circle cx="4" cy="18" r="1.3"/><line x1="8.5" y1="18" x2="20" y2="18"/>
  </svg>;
}
function IconImport(){
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="3" x2="12" y2="14"/><polyline points="7.5,10 12,14.5 16.5,10"/>
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>
  </svg>;
}
function IconCalendar(){
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><line x1="3.5" y1="10" x2="20.5" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>
  </svg>;
}
function IconFocus(){
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none"/>
  </svg>;
}
function IconBell(){
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 8a6 6 0 0 1 12 0c0 4 1.5 5.5 2 6H4c.5-.5 2-2 2-6Z"/>
    <path d="M10 19a2 2 0 0 0 4 0"/>
  </svg>;
}
function IconHistory(){
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="13" r="8"/><polyline points="12,9 12,13 15,15"/><polyline points="8.5,2.5 12,5.5 15.5,2.5"/>
  </svg>;
}
function IconSearch(){
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <circle cx="10.5" cy="10.5" r="6.5"/><line x1="15.5" y1="15.5" x2="21" y2="21"/>
  </svg>;
}
function IconSettings(){
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2.1"/>
    {[0,45,90,135,180,225,270,315].map(deg=>(
      <line key={deg} x1="12" y1="4.2" x2="12" y2="1.8" transform={`rotate(${deg} 12 12)`}/>
    ))}
  </svg>;
}

// ─── FONT ─────────────────────────────────────────────────────────────────────
// Down to exactly one -- the original DM Serif Display/DM Mono pairing -- with
// every other option removed, so there's no per-user Font picker/state
// anymore (same treatment THEMES got when it went down to two).
const FONT = { name:"DM Serif", heading:"'DM Serif Display', serif", body:"'DM Mono', monospace", google:"DM+Serif+Display:ital@0;1&family=DM+Mono:wght@400;500" } as const;

const GROUP_BY = { none:{name:"None",emoji:"--"}, subject:{name:"Subject",emoji:"▥"}, priority:{name:"Priority",emoji:"‼"}, dueDate:{name:"Due Date",emoji:"▦"} };
const DEFAULT_SUBJECTS = ["Math","English","Science","History","Art","PE"];
const DEFAULT_SUBJECT_COLORS: Record<string,string> = { Math:"#FF6B6B",English:"#FF9F43",Science:"#45B7D1",History:"#F7DC6F",Art:"#BB8FCE",PE:"#82E0AA" };
const SUBJECT_COLOR_PALETTE = ["#FF6B6B","#FF9F43","#45B7D1","#F7DC6F","#BB8FCE","#82E0AA","#C9E06C","#9CE06C","#6EE06C","#6CE0D2","#6C7DE0","#8D6CE0","#E06CCE","#E06C9E"];
const PRIORITY_COLORS: Record<Priority,string> = { high:"#FF4757",medium:"#FFA502",low:"#2ED573" };
// Fallback for every priority color/text when the "Urgency color coding" toggle
// (Options -> Looks) is off -- one neutral gray instead of red/orange/green, so
// urgency still reads through position/text ("Overdue!" etc.) without color.
const NEUTRAL_PRIORITY_COLOR = "#8a8a8a";
function priColor(pr:Priority,colorCode:boolean):string{ return colorCode?PRIORITY_COLORS[pr]:NEUTRAL_PRIORITY_COLOR; }
// What's New feed shown in the title menu's Inbox section -- hand-maintained,
// newest first; add an entry here whenever a user-facing change ships. Each
// entry needs a stable id: dismissing one stores just its id (see
// dismissedWhatsNew below), never a copy of this list. `kind` is the category
// ("New feature", "Bug fix"...), `headline` the short name shown as its title,
// `where` how to get to it ("Menu (tap DuePlanner) → Settings → ..."), using the
// on-screen labels -- give every entry one unless there's truly nowhere to go.
// `go` powers the card's "Take me there" button: "place" or "place:anchor"
// (see goTo in HomeworkPlanner), where the anchor is a data-tour attribute on
// the thing to highlight. Tapping an entry opens it in a floating panel
// (UpdateDetail).
// `list` is only used by recap messages (src/lib/recaps.ts): the finished tasks.
type WhatsNewItem={id:string; date:string; kind:string; headline:string; where?:string; go?:string; description:string; list?:string[]};
const WHATS_NEW: WhatsNewItem[] = [
  { id:"complete-faster", date:"2026-10-03", kind:"Improvement", headline:"Quicker completing", where:"Your task list: check off a task", go:"tasks", description:"Checking off a task is a little quicker. The checkmark, the strike through the title and the slide down to your done tasks all take about 15% less time." },
  { id:"anim-speed", date:"2026-10-03", kind:"New feature", headline:"Animation speed", where:"Menu (tap DuePlanner) → Settings → Looks → Animation speed", go:"settings:anim-speed", description:"A new slider sets how fast the app's animations play, from half speed to twice as fast. It applies everywhere: completing a task, cards sliding into place, opening messages and menus." },
  { id:"inbox-next-back", date:"2026-10-03", kind:"UI change", headline:"Next and Back", where:"Menu (tap DuePlanner) → Inbox → open a message", description:"The buttons on an open Inbox message now say Back and Next instead of Newer and Older. Next moves down the list, Back moves up." },
  { id:"inbox-recaps", date:"2026-10-03", kind:"New feature", headline:"A real Inbox", where:"Menu (tap DuePlanner) → Inbox → Messages", description:"The Inbox now gets real messages. When a day, week, month or year ends, a recap arrives with what you finished, the time you spent, how much was on time and your busiest subject. Unread ones show a dot, and the menu shows how many are waiting. These replace the old Done today and Personal panels." },
  { id:"update-close-smooth", date:"2026-10-03", kind:"Bug fix", headline:"Smoother closing updates", where:"Menu (tap DuePlanner) → Inbox → open an update, then close it", description:"Closing an update now shrinks it back into its row in one smooth move. It no longer stops partway, loses its text, or flashes when it lands." },
  { id:"profile-no-signin-flash", date:"2026-10-03", kind:"Bug fix", headline:"No sign-in flash", where:"Menu (tap DuePlanner) → Profile", go:"profile", description:"Opening Profile right after the app loads no longer shows the sign-in screen for a moment when you're already signed in." },
  { id:"inbox-dropdowns", date:"2026-10-03", kind:"UI change", headline:"A tidier Inbox", where:"Menu (tap DuePlanner) → Inbox", description:"Done today, Personal and Updates are now dropdowns. Tap a heading to open or close it. Updates also has filter buttons, so you can show only new features, bug fixes, or any other kind of update." },
  { id:"copy-no-dashes", date:"2026-10-03", kind:"UI change", headline:"Plainer wording", where:"Everywhere: suggestions, messages and these updates", description:"Messages, suggestions and update notes across the app are written as plain sentences now, without dashes splitting them in two." },
  { id:"profile-counts-archived", date:"2026-10-03", kind:"Bug fix", headline:"Profile counts fixed", where:"Menu (tap DuePlanner) → Profile", go:"profile", description:"Profile's task numbers (total, done, pending, urgent and the per-subject bars) no longer count archived tasks, so they match what's on your list." },
  { id:"calendar-layout-removed", date:"2026-09-27", kind:"UI change", headline:"One calendar", where:"The Calendar tab, the middle one in the tab bar", go:"calendar", description:"The Calendar layout is gone now that there's a Calendar tab, which shows the whole month instead of just the next week. If you were using the layout, your tasks are back in List." },
  { id:"calendar-tab", date:"2026-09-27", kind:"New feature", headline:"Calendar", where:"The Calendar tab, the middle one in the tab bar", go:"calendar", description:"A new Calendar tab: see the whole month, with busier days shaded darker and a dot for each thing due. Tap a day to see its homework, check it off, or add something due that day. Swipe or use the arrows to change month." },
  { id:"focus-no-symbols", date:"2026-09-27", kind:"UI change", headline:"Cleaner Focus Mode", where:"The Focus tab", go:"tasks:tab-focus", description:"Focus Mode's buttons are plain words now: Start, Pause, Reset, Exit and Mark done, without the ▶ ⏸ ↺ ✕ ✓ symbols." },
  { id:"time-left-no-start", date:"2026-09-27", kind:"UI change", headline:"Simpler Time left", where:"Tasks tab → Time left, top right", go:"tasks:time-left", description:"The Start button is gone from the Time left breakdown. It's just your time by due date and subject now. Start a focus session from the Focus tab." },
  { id:"menu-screens", date:"2026-09-27", kind:"UI change", headline:"Inbox, History and Import/Export get their own screens", where:"Menu (tap DuePlanner) → Inbox, History or Import/Export", go:"menu", description:"Inbox, History and Import/Export now open as full screens, like Settings, instead of dropdowns squeezed into the menu, so there's more room for your stats, updates, recently deleted tasks and syllabus imports. Tap ‹ Tasks to go back." },
  { id:"no-empty-labels", date:"2026-09-27", kind:"UI change", headline:"Cleaner task cards", where:"Your task list, and a task's details", go:"tasks", description:"Tasks without a due date or subtasks no longer say \"No date\" or \"No subtasks\". Those spots are simply left out. Where undated tasks are grouped together (the Calendar layout, grouping by due date, Time left), the heading now says \"Anytime\"." },
  { id:"profile-top", date:"2026-09-27", kind:"UI change", headline:"Profile at the top", where:"Menu (tap DuePlanner) → Profile", go:"menu", description:"Profile is now the first thing in the title menu, above Inbox." },
  { id:"suggestion-hide-fix", date:"2026-09-27", kind:"Bug fix", headline:"Hiding a suggestion", where:"Tasks tab → the ✦ suggestion above your list", go:"tasks", description:"The × on the smart suggestion now just hides that suggestion. A new one appears when a different task becomes the most urgent. It used to turn suggestions off completely (that's still in Settings → Task list)." },
  { id:"settings-dropdowns", date:"2026-09-27", kind:"UI change", headline:"Tidier Settings", where:"Menu (tap DuePlanner) → Settings", go:"settings", description:"Every Settings section is now a dropdown. Tap a heading to open or close it, and the ones you open stay open next time. The list options (grouping, showing completed tasks, auto-archive) are together under Task list, and reminders have their own section." },
  { id:"take-me-there", date:"2026-09-27", kind:"New feature", headline:"Take me there", where:"Menu (tap DuePlanner) → Inbox → tap an update → Take me there", description:"Updates can now take you straight to what's new: tap Take me there and DuePlanner opens the right screen and highlights the feature." },
  { id:"where-to-find", date:"2026-09-27", kind:"Improvement", headline:"Where to find it", where:"Menu (tap DuePlanner) → Inbox → tap any update", description:"Updates now tell you where to find what's new. Open one and look for \"Where to find it\" under the description." },
  { id:"update-browse-fix", date:"2026-09-27", kind:"Bug fix", headline:"Smoother update browsing", where:"Menu (tap DuePlanner) → Inbox → tap any update, then Newer or Older", description:"Pressing Newer or Older on an open update no longer makes it look like it reloaded. The card stays put, the next update slides in, and the card adjusts to fit." },
  { id:"update-details", date:"2026-09-26", kind:"New feature", headline:"Open an update", where:"Menu (tap DuePlanner) → Inbox → tap any update", description:"Tap any update in your Inbox and it grows into a card in the middle of the screen, with its full details. Flip through the others with Newer and Older, or dismiss it from there." },
  { id:"new-task-questions", date:"2026-09-26", kind:"New feature", headline:"Choose your new task questions", where:"Menu (tap DuePlanner) → Settings → New task questions", go:"settings:new-task-questions", description:"Choose which questions you get when adding a task, and in what order: Settings -> New task questions. Turn off the ones you don't need. You can still fill them in later with Edit." },
  { id:"edit-estimate-fix", date:"2026-09-26", kind:"Bug fix", headline:"Estimate editing fixed", where:"Tap a task → Edit → Estimate", go:"task:task-edit", description:"Editing a task's estimate works properly: you can clear the hours and minutes and type new ones, any number of minutes saves (90 minutes becomes 1h 30m), and phones no longer zoom in when you tap a field." },
  { id:"floating-search", date:"2026-09-26", kind:"New feature", headline:"Floating search", where:"Tasks tab → Search tasks, above your list", go:"tasks:search", description:"Search floats: tap Search tasks and the bar lifts into the middle of a blurred screen, with matching tasks popping in underneath as you type. Tap one to open it." },
  { id:"cards-glide", date:"2026-09-26", kind:"Improvement", headline:"Tasks glide into place", where:"Your task list, in any layout", description:"Tasks slide smoothly into place in every layout when you filter, search, add, delete, undo, or change several at once. New ones fade in and removed ones fade out." },
  { id:"fixes-sep23", date:"2026-09-23", kind:"Bug fix", headline:"Timer and account fixes", where:"Focus tab (the Pomodoro), and the timer in a task's details", go:"tasks:tab-focus", description:"The Pomodoro and work-session timers keep time correctly when you switch tabs or lock your phone (they used to nearly stop); deleting an account with lots of tasks no longer fails; and a few smaller fixes." },
  { id:"trash-sync-fix", date:"2026-09-22", kind:"Bug fix", headline:"Recently deleted stays put", where:"Menu (tap DuePlanner) → History → Recently deleted", go:"history:trash", description:"Tasks you delete while signed in now reliably stay in Recently deleted. A sync timing issue could make them vanish from it." },
  { id:"bulk-everywhere", date:"2026-09-22", kind:"New feature", headline:"Select in every layout", where:"Tasks tab → Select, next to the filters", go:"tasks:select", description:"Select works in every layout now, with Select all, and you can change the due date or priority of many tasks at once." },
  { id:"a11y-pass", date:"2026-09-22", kind:"Improvement", headline:"Keyboard and screen reader support", where:"Everywhere. Try Tab, Enter and the arrow keys", description:"Better for keyboard and screen reader users: open tasks from the keyboard, reorder with arrow keys, visible focus rings, clearer button names, and higher-contrast labels." },
  { id:"complete-anim", date:"2026-09-22", kind:"Improvement", headline:"A more satisfying check-off", where:"Tap the circle next to any task", description:"Completing a task feels better: the check draws in, the title strikes through, and the card settles down to your done tasks." },
  { id:"sheet-spring", date:"2026-09-22", kind:"Improvement", headline:"Springy task details", where:"Tap a task, then drag the handle at the top", go:"task", description:"Task details now follow your finger when you drag the handle, spring back when you let go, and fly away when you flick them down to close." },
  { id:"glass-cursor", date:"2026-09-22", kind:"Improvement", headline:"Liquid Glass catches the light", where:"Menu (tap DuePlanner) → Settings → Looks → Liquid Glass", go:"settings:liquid-glass", description:"Liquid Glass now catches the light: cards glow softly under your mouse, or under your finger on a phone." },
  { id:"pomodoro-breaks", date:"2026-09-22", kind:"New feature", headline:"Pomodoro breaks", where:"Menu (tap DuePlanner) → Settings → Focus timer; the timer is in the Focus tab", go:"settings:focus-timer", description:"The Pomodoro now has breaks. Set focus and break lengths in Settings → Focus timer, and when a break ends you get a suggestion for what to work on next, with one tap to start." },
  { id:"fixes-sep22", date:"2026-09-22", kind:"Bug fix", headline:"A batch of fixes", description:"Un-completing an archived task no longer makes it disappear; long titles and subject names are capped instead of failing to sync; swiping a finished task now says \"Mark not done\"; Empty in Recently deleted asks to confirm; 24-hour time now applies everywhere; and a few labels say what they actually do (\"In 3 hours\", \"Next 7 days\")." },
  { id:"settings-batch", date:"2026-09-22", kind:"New feature", headline:"Subject colors, Done today and more undo", where:"Menu (tap DuePlanner) → Settings → Subjects, and Settings → Date & time; Done today is in the Inbox", go:"settings:subjects", description:"Rename subjects and change their colors (✎ in Settings -> Subjects); a \"Done today\" list in the Inbox; 24-hour time and a Monday week start in Settings -> Date & time; and completing, editing, archiving and bulk changes can now be undone." },
  { id:"safer-sync", date:"2026-09-22", kind:"Improvement", headline:"Safer syncing", where:"Menu (tap DuePlanner) → Profile shows when you last synced", go:"profile", description:"Syncing between devices is safer: edits made at the same time on two devices are merged field by field instead of one overwriting the other, Recently deleted now syncs too, and the title menu shows when you last synced (or that you're offline)." },
  { id:"time-left-more", date:"2026-09-22", kind:"New feature", headline:"A smarter Time left", where:"Tap Time left, top right", go:"tasks:time-left", description:"The \"Time left\" dropdown now splits time by due date, shows time worked per subject, flags tasks with no estimate, and can start Focus on the most urgent task in your biggest subject." },
  { id:"fewer-layouts", date:"2026-09-22", kind:"UI change", headline:"Seven layouts", where:"Menu (tap DuePlanner) → Settings → Looks → Layout", go:"settings:layout", description:"Trimmed the layouts to seven: Compact, Minimal, Sticky, Timeline and By Subject are gone. If you were using one, you're back on List." },
  { id:"recently-deleted", date:"2026-09-22", kind:"New feature", headline:"Recently deleted", where:"Menu (tap DuePlanner) → History → Recently deleted", go:"history:trash", description:"Recently deleted: deleted tasks stay for 30 days and can be restored from History in the title menu." },
  { id:"skip-occurrence", date:"2026-09-22", kind:"New feature", headline:"Skip a repeat", where:"Tap a repeating task → Skip this one", go:"task:task-skip", description:"Repeating tasks have \"Skip this one\" in their detail view. It moves to the next occurrence without completing it. Undoable." },
  { id:"countdown", date:"2026-09-22", kind:"New feature", headline:"Live countdowns", where:"Your task list, on tasks due today at a set time", description:"Tasks due today at a set time show a live countdown, like \"Due in 2h 15m\"." },
  { id:"profile-in-menu", date:"2026-09-22", kind:"UI change", headline:"Profile moved to the menu", where:"Menu (tap DuePlanner) → Profile", go:"profile", description:"Profile now lives only in the title menu, which also shows when there's a sync issue." },
  { id:"edit-tasks", date:"2026-09-22", kind:"New feature", headline:"Edit tasks", where:"Tap a task → Edit", go:"task:task-edit", description:"Edit a task's title, subject, due date and time, estimate, and repeat from its detail view. Just tap Edit." },
  { id:"snooze", date:"2026-09-22", kind:"New feature", headline:"Snooze", where:"Tap a task → Snooze", go:"task:task-snooze", description:"Snooze a task to later today, tomorrow, or next week from its detail view, and undo it if you change your mind." },
  { id:"duplicate-restore", date:"2026-09-22", kind:"New feature", headline:"Duplicate and restore", where:"Tap a task → Duplicate, or Restore on an archived task", go:"task:task-duplicate", description:"Duplicate any task, and restore archived tasks, from the task's detail view." },
  { id:"json-import", date:"2026-09-22", kind:"New feature", headline:"Import a backup", where:"Menu (tap DuePlanner) → Import/Export → Import backup (JSON)", go:"import:import-backup", description:"Import backup (JSON) in the menu's Backup & export section restores an export. Tasks you already have are kept." },
  { id:"week-reminder", date:"2026-09-22", kind:"New feature", headline:"1-week reminders", where:"Menu (tap DuePlanner) → Settings → Reminders → Remind me", go:"settings:reminders", description:"New \"1 week before\" reminder option in Settings." },
  { id:"focus-picker", date:"2026-09-22", kind:"New feature", headline:"Pick your focus task", where:"Focus tab → Change task", go:"focus:change-task", description:"Choose which task Focus Mode is about. Finished Pomodoros now count as work sessions, and the screen stays awake while you focus." },
  { id:"liquid-glass", date:"2026-09-22", kind:"New feature", headline:"Liquid Glass", where:"Menu (tap DuePlanner) → Settings → Looks → Liquid Glass", go:"settings:liquid-glass", description:"Liquid Glass: an optional translucent look for cards and the tab bar. Turn it on in Settings → Looks." },
  { id:"time-left-breakdown", date:"2026-09-22", kind:"New feature", headline:"Time left by subject", where:"Tap Time left, top right", go:"tasks:time-left", description:"Tap \"Time left\" in the header to see how much time each subject needs." },
  { id:"sync-more", date:"2026-09-22", kind:"New feature", headline:"More things sync", where:"Menu (tap DuePlanner) → Profile, to sign in", go:"profile", description:"Subjects, subject colors, and Urgency Color Coding now sync across your devices." },
  { id:"subjects-in-settings", date:"2026-09-22", kind:"Navigation", headline:"Subjects in Settings", where:"Menu (tap DuePlanner) → Settings → Subjects", go:"settings:subjects", description:"Subjects are now managed in Settings, and work without signing in." },
  { id:"sessions-saved", date:"2026-09-22", kind:"New feature", headline:"Work sessions saved", where:"Tap a task to start a work session; your totals are in Menu (tap DuePlanner) → Inbox", go:"task", description:"Work sessions are now saved on the task, and your Inbox shows real time spent." },
  { id:"pomodoro-chime", date:"2026-09-22", kind:"New feature", headline:"Pomodoro chime", where:"Focus tab", go:"tasks:tab-focus", description:"The Pomodoro timer now chimes when it's done, and shows its time on the Focus tab while running." },
  { id:"undo-more", date:"2026-09-22", kind:"New feature", headline:"Undo more", where:"Menu (tap DuePlanner) → History → Undo", go:"history:undo-redo", description:"Bulk delete and Clear completed can now be undone." },
  { id:"calendar-sections", date:"2026-09-22", kind:"UI change", headline:"Calendar sections", description:"The Calendar layout now shows Overdue and Later sections, so no task disappears from it." },
  { id:"reminder-fixes", date:"2026-09-22", kind:"Bug fix", headline:"Reminder fixes", where:"Menu (tap DuePlanner) → Settings → Reminders", go:"settings:reminders", description:"\"At due time\" reminders now fire, and you no longer get several reminders for one task at once." },
  { id:"recurring-fix", date:"2026-09-22", kind:"Bug fix", headline:"No more duplicate repeats", where:"Tap the circle on a repeating task", description:"Un-completing a repeating task no longer leaves a duplicate behind." },
  { id:"icon-color-fix", date:"2026-09-22", kind:"Bug fix", headline:"Icon colors fixed", description:"Inbox and Settings menu icons now use the correct theme color instead of the browser's default blue." },
  { id:"history-collapsible", date:"2026-09-22", kind:"UI change", headline:"Collapsible History", where:"Menu (tap DuePlanner) → History", go:"history:undo-redo", description:"History is now a collapsible section in the title menu instead of always expanded." },
  { id:"undo-redo", date:"2026-09-22", kind:"New feature", headline:"Undo and redo", where:"Menu (tap DuePlanner) → History", go:"history:undo-redo", description:"Undo and Redo for deleted tasks, available anytime from the title menu." },
  { id:"settings-in-menu", date:"2026-09-22", kind:"Navigation", headline:"Settings moved", where:"Menu (tap DuePlanner) → Settings", go:"settings", description:"Settings moved out of the tab bar. Open it from the title menu instead." },
  { id:"title-menu", date:"2026-09-22", kind:"UI change", headline:"The title menu", where:"Tap DuePlanner, top left", description:"The DuePlanner title is now a menu with quick access to Inbox, History, Profile, and Settings." },
  { id:"wizard-cancel-moved", date:"2026-09-22", kind:"UI change", headline:"Cancel moved", where:"Tasks tab → + Add homework", go:"tasks:add", description:"Cancel moved out from between the add-task wizard's back/skip buttons to avoid accidental taps." },
  { id:"wizard-back-skip", date:"2026-09-22", kind:"New feature", headline:"Back and skip", where:"Tasks tab → + Add homework, under each question", go:"tasks:add", description:"Added back and skip buttons to the add-task wizard, so you can revisit or skip a question." },
  { id:"subject-colors-fix", date:"2026-09-22", kind:"Bug fix", headline:"Clearer subject colors", where:"Menu (tap DuePlanner) → Settings → Subjects", go:"settings:subjects", description:"Subject colors for English and Science no longer look nearly identical." },
  { id:"time-left-color", date:"2026-09-22", kind:"UI change", headline:"Theme-colored time left", where:"Time left, top right", go:"tasks:time-left", description:"The time-left number in the header now follows the theme instead of always being teal." },
];
// Every WHATS_NEW id that existed while the feed was still persisted as a
// whole array under "hw-whatsnew" (see the dismissed-ids migration below) --
// frozen, so entries added after that aren't mistaken for dismissed ones.
const UPDATE_KIND_ORDER=["New feature","Improvement","UI change","Bug fix","Navigation"];
function kindRank(kind:string){const i=UPDATE_KIND_ORDER.indexOf(kind);return i<0?UPDATE_KIND_ORDER.length:i;}
const LEGACY_WHATSNEW_IDS = ["icon-color-fix","history-collapsible","undo-redo","settings-in-menu","title-menu","wizard-cancel-moved","wizard-back-skip","subject-colors-fix","time-left-color"];
const REMINDER_OFFSETS = [
  { key:"1w", label:"1 week before", mins:10080 },
  { key:"1d", label:"1 day before", mins:1440 },
  { key:"3h", label:"3 hours before", mins:180 },
  { key:"1h", label:"1 hour before", mins:60 },
  { key:"0",  label:"At due time",   mins:0 },
] as const;
// The add-task questions asked after the title. Which are asked, and in what
// order, is the "New task questions" setting (`askQuestions`); `name` is how
// Settings lists each one.
const QUESTIONS = [
  { key:"subject", label:"What subject?", type:"select", name:"Subject" },
  { key:"dueDate", label:"When is it due?", type:"date", name:"Due date" },
  { key:"estMins", label:"How long will it take?", type:"time", name:"How long it takes" },
  { key:"recurrence", label:"Does this repeat?", type:"recurrence", name:"Repeats" },
];
const QUESTION_KEYS=QUESTIONS.map(q=>q.key);
// The questions to ask, in order, from the saved "New task questions" setting.
// HomeworkPlanner wraps this in useMemo: computed plainly in the component body,
// the React Compiler treated the list (read by the wizard's JSX) as possibly
// mutated and bailed out on the whole component (preserve-manual-memoization,
// reported on the css memo's F.google/F.body deps).
function askedQuestions(saved:unknown){
  return normalizeQuestionPrefs(saved,QUESTION_KEYS).filter(p=>p.on).map(p=>QUESTIONS.find(q=>q.key===p.key)!);
}

interface Subtask { id:string; text:string; done:boolean; }
interface Task {
  id:number; title:string; subject:string; dueDate:string; dueTime:string; estMins:number; done:boolean; order:number;
  subtasks?: Subtask[];
  recurrence?: Recurrence;
  archived?: boolean;
  completedAt?: number | null; // ms timestamp, set when marked done, cleared (null, never undefined -- Firestore's setDoc throws on literal undefined) when un-marked -- drives archive timing + weekly/monthly stats
  tags?: string[]; // free-form, cross-cutting -- distinct from subject (one per task, these are many)
  priorityOverride?: Priority; // manual override for getPriority()'s auto-computed value, cleared to go back to "Auto"
  sessions?: {mins:number; at:number}[]; // work sessions logged from the task modal's timer (at = ms timestamp when it ended)
  spawnedNextId?: number|null; // recurring tasks: id of the next occurrence created when this one was marked done, so un-marking it can take that copy back
}

// Reusable task shape -- local-only (localStorage), not synced to Firestore.
// Deliberate scope call: templates are a personal productivity convenience,
// not core data, and don't currently justify a second synced collection.
interface TaskTemplate { id:string; name:string; subject:string; estMins:number; recurrence?:Recurrence; subtasks?:{text:string}[]; }

const DEFAULT_TASKS: Task[] = [
  { id:1, title:"Chapter 5 Review", subject:"Math", dueDate:localDateStr(new Date(Date.now()+86400000)), dueTime:"", estMins:45, done:false, order:0 },
  { id:2, title:"Essay Draft", subject:"English", dueDate:localDateStr(new Date(Date.now()+3*86400000)), dueTime:"23:59", estMins:90, done:false, order:1 },
  { id:3, title:"Lab Report", subject:"Science", dueDate:localDateStr(new Date(Date.now()+5*86400000)), dueTime:"", estMins:60, done:false, order:2 },
  { id:4, title:"History Reading", subject:"History", dueDate:localDateStr(new Date(Date.now()+2*86400000)), dueTime:"09:00", estMins:30, done:false, order:3 },
];

// Picks the most urgent pending task, computed locally and instantly from the
// task data (this once called an AI API from the browser, which was both
// broken and insecure; nothing about it needs a network call).
function buildSuggestion(tasks:Task[]):string {
  const pending=tasks.filter(t=>!t.done&&!t.archived);
  if (pending.length===0) return "Nothing left to do. Great work!";
  if (pending.length===1) return `Just one task left: "${pending[0].title}". You've got this!`;
  const sorted=[...pending].sort((a,b)=>{
    const o:Record<string,number>={high:0,medium:1,low:2};
    const d=o[getPriority(a.dueDate,a.estMins,a.priorityOverride)]-o[getPriority(b.dueDate,b.estMins,b.priorityOverride)];
    return d!==0?d:(a.dueDate||"9999-99-99").localeCompare(b.dueDate||"9999-99-99");
  });
  const top=sorted[0];
  const days=daysUntil(top.dueDate);
  const timeStr=formatDuration(top.estMins);
  const urgencyWord=days==="Overdue!"?"overdue":days==="Due today!"?"due today":days==="Due tomorrow"?"due tomorrow":days?days.replace(" days left","d left"):"no deadline";
  return `Most urgent: "${top.title}"\n${urgencyWord}${timeStr?`, ~${timeStr}`:""}`;
}

// One entry in the undo/redo history (see undoStack in HomeworkPlanner).
type HistoryAction =
  | {type:"delete"; tasks:Task[]}
  // Any other change (complete, edit, archive, snooze, ...): each affected
  // task's state before and after -- see src/lib/history.ts.
  | {type:"change"; before:TaskStates<Task>; after:TaskStates<Task>; label:string};

// Recently deleted entries. Built at module scope because the React
// Compiler's purity lint rejects Date.now() inside component functions.
type TrashEntry={task:Task;deletedAt:number};
const TRASH_DAYS=30;
function trashEntries(list:Task[]):TrashEntry[]{ const at=Date.now(); return list.map(task=>({task,deletedAt:at})); }
function pruneTrash(prev:TrashEntry[]):TrashEntry[]{
  const cutoff=Date.now()-TRASH_DAYS*86400000;
  return prev.some(e=>e.deletedAt<cutoff)?prev.filter(e=>e.deletedAt>=cutoff):prev;
}
// Every task this device knows about, live or in Recently deleted, keyed by id
// -- the shape src/lib/sync.ts merges.
function localRecords(tasks:Task[],trash:TrashEntry[]):Map<number,SyncRecord<Task>>{
  const m=new Map<number,SyncRecord<Task>>();
  for(const e of trash)m.set(e.task.id,{task:e.task,deletedAt:e.deletedAt});
  for(const t of tasks)m.set(t.id,{task:t});
  return m;
}
// A tasks/ or trash/ doc as a cloud record. updatedAt/deletedAt are sync
// metadata, not task fields, so they're split off here.
function cloudRecord(d:QueryDocumentSnapshot,deleted:boolean):CloudRecord<Task>|null{
  const {updatedAt,deletedAt,...task}=d.data();
  if(typeof task.id!=="number"||typeof task.title!=="string")return null; // shape guard, see profile sync
  const rec:CloudRecord<Task>={task:task as Task,updatedAt:typeof updatedAt==="number"?updatedAt:0};
  if(deleted)rec.deletedAt=typeof deletedAt==="number"?deletedAt:0;
  return rec;
}

// A local YYYY-MM-DD `days` from today (bulk "set due date" shortcuts). Module
// scope for the same React Compiler purity reason as snoozeTarget below.
function dateInDays(days:number):string{ const d=new Date(); d.setDate(d.getDate()+days); return localDateStr(d); }

// A timestamp for the card glide's capture (see captureTaskRects). Module scope
// for the same React Compiler purity reason as dateInDays above.
function glideClock():number{ return performance.now(); }

// Snooze moves a task's due date (and, for "in 3 hours", its time) forward.
type SnoozeKind="later"|"tomorrow"|"week";
function snoozeTarget(kind:SnoozeKind):{dueDate:string;dueTime?:string}{
  if(kind==="later"){
    // Three hours from now, rounded up to the next quarter hour.
    const d=new Date(Date.now()+3*3600000);
    d.setMinutes(Math.ceil(d.getMinutes()/15)*15,0,0);
    return {dueDate:localDateStr(d),dueTime:`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`};
  }
  const d=new Date(); d.setDate(d.getDate()+(kind==="tomorrow"?1:7));
  return {dueDate:localDateStr(d)};
}

// ─── TASK SESSION MODAL ───────────────────────────────────────────────────────
// Defined at module scope (not nested in HomeworkPlanner) so its identity stays
// stable across renders -- otherwise the session timer's once-a-second tick
// would redefine this as a "new" component each time, forcing React to unmount
// and remount the whole modal (replaying its entrance animation) every second.
function TaskModal({task,T,F,subjects,subjectColors,colorCodeUrgency,now,h24,sessionActive,sessionSecs,allTags,onClose,onStartSession,onEndSession,onToggleDone,onDelete,onUpdateSubtasks,onArchive,onRestore,onDuplicate,onUpdateTask,onSnooze,onSkipOccurrence,onSetPriorityOverride,onSetTags,onSaveAsTemplate}:{
  task:Task; T:ThemeObj; F:typeof FONT; subjects:string[]; subjectColors:Record<string,string>; colorCodeUrgency:boolean; now:number; h24:boolean;
  sessionActive:boolean; sessionSecs:number;
  allTags:string[];
  onClose:()=>void; onStartSession:()=>void; onEndSession:()=>void; onToggleDone:()=>void; onDelete:()=>void;
  onUpdateSubtasks:(subtasks:Subtask[])=>void; onArchive:()=>void; onRestore:()=>void; onDuplicate:()=>void;
  onUpdateTask:(patch:Partial<Task>)=>void; onSnooze:(kind:SnoozeKind)=>void; onSkipOccurrence:()=>void;
  onSetPriorityOverride:(override:Priority|null)=>void; onSetTags:(tags:string[])=>void;
  onSaveAsTemplate:(name:string)=>void;
}){
  const pr=getPriority(task.dueDate,task.estMins,task.priorityOverride);
  const sc=subjectColors[task.subject]||T.accent;
  const sh=Math.floor(sessionSecs/3600); const sm=Math.floor(sessionSecs/60)%60; const ss=sessionSecs%60;
  const today=todayISO();
  const sessionHistory=(task.sessions||[]).filter(s=>localDateStr(new Date(s.at))===today)
    .map(s=>{const d=new Date(s.at);return {mins:s.mins,date:formatTime(`${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`,h24)};});
  const totalSessionMins=sessionHistory.reduce((a,b)=>a+b.mins,0);
  const subtasks=task.subtasks||[];
  const [newSubtaskText,setNewSubtaskText]=useState("");
  function addSubtask(){
    const text=newSubtaskText.trim();
    if(!text||subtasks.length>=LIMITS.subtasks)return; // firestore.rules caps the list
    onUpdateSubtasks([...subtasks,{id:String(nextId()),text,done:false}]);
    setNewSubtaskText("");
  }
  const tags=task.tags||[];
  const [newTagText,setNewTagText]=useState("");
  // Editing the task's own fields (title, subject, due date/time, estimate,
  // repeat) -- previously these could only be set while adding a task.
  // The estimate is kept as the typed text (digits only, may be empty mid-edit)
  // and only turned into minutes on save; minutes past 59 roll into hours.
  const [draft,setDraft]=useState<{title:string;subject:string;dueDate:string;dueTime:string;estH:string;estM:string;recurrence:Recurrence}|null>(null);
  const draftEstMins=draft?Math.min(LIMITS.estMins,(parseInt(draft.estH,10)||0)*60+(parseInt(draft.estM,10)||0)):0;
  function startEdit(){
    setDraft({title:task.title,subject:task.subject,dueDate:task.dueDate,dueTime:task.dueTime,
      estH:task.estMins>=60?String(Math.floor(task.estMins/60)):"",estM:task.estMins%60?String(task.estMins%60):"",recurrence:task.recurrence||"none"});
  }
  function saveEdit(){
    if(!draft)return;
    onUpdateTask({title:draft.title.trim()||task.title,subject:draft.subject,dueDate:draft.dueDate,
      dueTime:draft.dueDate?draft.dueTime:"",estMins:draftEstMins,recurrence:draft.recurrence});
    setDraft(null);
  }
  // Inline "name this template" field (replaces a browser prompt() dialog).
  const [templateName,setTemplateName]=useState<string|null>(null);
  const [templateSaved,setTemplateSaved]=useState(false);
  function addTag(){
    const t=newTagText.trim();
    if(!t||tags.includes(t)||tags.length>=LIMITS.tags)return; // firestore.rules caps the list
    onSetTags([...tags,t]);
    setNewTagText("");
  }
  // Focus trap + focus-return: a custom div-based modal gets neither for free
  // the way a native <dialog> would. On open, move focus in and cycle
  // Tab/Shift+Tab between the panel's first/last focusable elements so
  // keyboard users can't tab out to the page underneath; on close, restore
  // focus to whatever opened the modal instead of losing it to <body>.
  //
  // The mount/unmount effect below intentionally runs once ([] deps) so it
  // doesn't re-steal focus into the first element on every unrelated
  // re-render (e.g. the session timer ticking) -- sessionActive/onClose are
  // read through refs instead, kept current by this separate effect, so
  // Escape always sees the latest sessionActive rather than whatever it was
  // when the modal first opened.
  const sessionActiveRef=useRef(sessionActive);
  const onCloseRef=useRef(onClose);
  useEffect(()=>{sessionActiveRef.current=sessionActive;onCloseRef.current=onClose;});
  const panelRef=useRef<HTMLDivElement>(null);
  // Whatever opened the modal, captured in a layout effect: the page behind is
  // made inert in the same commit, and the browser blurs anything focused
  // inside an inert subtree before a regular effect would get to look. Kept on
  // a re-run (StrictMode's dev double-mount), when focus is already inside.
  const openerRef=useRef<HTMLElement|null>(null);
  useLayoutEffect(()=>{if(!openerRef.current)openerRef.current=document.activeElement as HTMLElement|null;},[]);
  useEffect(()=>{
    const previouslyFocused=openerRef.current;
    const focusableSelector='button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    panelRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    function handleKeyDown(e:KeyboardEvent){
      if(e.key==="Escape"&&!sessionActiveRef.current){onCloseRef.current();return;}
      if(e.key!=="Tab"||!panelRef.current)return;
      const els=Array.from(panelRef.current.querySelectorAll<HTMLElement>(focusableSelector)).filter(el=>!el.hasAttribute("disabled"));
      if(els.length===0)return;
      const first=els[0], last=els[els.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
    document.addEventListener("keydown",handleKeyDown);
    return ()=>{document.removeEventListener("keydown",handleKeyDown);previouslyFocused?.focus();};
  },[]);
  // Drag the top handle to move the sheet, like a native bottom sheet: it
  // follows the finger (with rubber-band resistance if pulled up), the backdrop
  // fades as it goes, and on release it springs back into place or -- if dragged
  // far enough or flicked -- flies off the bottom and closes, keeping the
  // finger's speed either way (physics in src/lib/spring.ts). Driven through
  // refs and direct style writes, not state, so a drag doesn't re-render the
  // whole modal every frame. Declared below onCloseRef on purpose (see the
  // React Compiler note in CLAUDE.md about forward references).
  const sheetRef=useRef<HTMLDivElement>(null);
  const overlayRef=useRef<HTMLDivElement>(null);
  const sheetDrag=useRef<{startY:number;samples:{t:number;y:number}[]}|null>(null);
  const sheetY=useRef(0);
  const sheetAnim=useRef(0);
  function setSheetY(y:number){
    sheetY.current=y;
    if(sheetRef.current)sheetRef.current.style.transform=y?`translateY(${y}px)`:"";
    const h=sheetRef.current?.offsetHeight||window.innerHeight;
    if(overlayRef.current)overlayRef.current.style.background=`rgba(0,0,0,${(0.53*(1-Math.min(1,Math.max(0,y)/h))).toFixed(3)})`;
  }
  function releaseSheet(vel:number,dismiss:boolean){
    cancelAnimationFrame(sheetAnim.current);
    if(window.matchMedia("(prefers-reduced-motion: reduce)").matches){if(dismiss)onCloseRef.current();else setSheetY(0);return;}
    const h=sheetRef.current?.offsetHeight||window.innerHeight;
    let v=dismiss?Math.max(vel,1400):vel, last=performance.now();
    const frame=(now:number)=>{
      const dt=Math.min(0.05,(now-last)/1000); last=now;
      if(dismiss){
        v+=4000*dt; // keeps accelerating off the screen
        const y=sheetY.current+v*dt; setSheetY(y);
        if(y>=h){onCloseRef.current();return;}
      }else{
        const st=stepSpring(sheetY.current,v,0,dt*animationRate()); v=st.vel;
        if(springSettled(st.pos,st.vel,0)){setSheetY(0);return;}
        setSheetY(st.pos);
      }
      sheetAnim.current=requestAnimationFrame(frame);
    };
    sheetAnim.current=requestAnimationFrame(frame);
  }
  useEffect(()=>()=>cancelAnimationFrame(sheetAnim.current),[]);
  return(
    <div ref={overlayRef} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.53)",zIndex:1000,display:"flex",alignItems:"flex-end",justifyContent:"center",padding:"0 0 0 0"}} onClick={e=>{if(e.target===e.currentTarget&&!sessionActive)onClose();}}>
      {/* The drag offset lives on this wrapper, not the panel: the panel's "pop"
          entrance animation (fill-mode forwards) would override its transform. */}
      <div ref={sheetRef} style={{width:"100%",maxWidth:580}}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={task.title} className="pop" style={{background:T.bg,borderRadius:"20px 20px 0 0",width:"100%",maxHeight:"90vh",overflowY:"auto",border:`1px solid ${T.border}`,borderBottom:"none"}}>
        {/* Handle -- drag down to close (not while a session is running) */}
        {!sessionActive&&<div
          onPointerDown={e=>{
            cancelAnimationFrame(sheetAnim.current); // catch the sheet mid-spring
            sheetDrag.current={startY:e.clientY-sheetY.current,samples:[{t:e.timeStamp,y:e.clientY}]};
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={e=>{
            const d=sheetDrag.current; if(!d)return;
            d.samples.push({t:e.timeStamp,y:e.clientY}); if(d.samples.length>8)d.samples.shift();
            const raw=e.clientY-d.startY;
            setSheetY(raw>=0?raw:-rubberBand(-raw));
          }}
          onPointerUp={e=>{
            const d=sheetDrag.current; if(!d)return; sheetDrag.current=null;
            d.samples.push({t:e.timeStamp,y:e.clientY});
            const v=releaseVelocity(d.samples);
            releaseSheet(v,shouldDismiss(sheetY.current,v));
          }}
          onPointerCancel={()=>{sheetDrag.current=null;releaseSheet(0,false);}}
          style={{display:"flex",justifyContent:"center",padding:"12px 0 8px",cursor:"grab",touchAction:"none"}}>
          <div style={{width:36,height:4,borderRadius:999,background:T.border}}/>
        </div>}
        {sessionActive&&<div style={{height:20}}/>}
        <div style={{padding:"12px 20px 32px"}}>
          {/* Task header */}
          <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:16}}>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:6}}>
                {task.subject&&<span style={{background:sc+"22",color:ink(sc,T.light),borderRadius:999,padding:"3px 10px",fontFamily:F.body,fontSize:11}}>{task.subject}</span>}
                {!task.done&&<span style={{background:priColor(pr,colorCodeUrgency)+"22",color:ink(priColor(pr,colorCodeUrgency),T.light),borderRadius:999,padding:"3px 10px",fontFamily:F.body,fontSize:11}}>{pr[0].toUpperCase()+pr.slice(1)} priority{task.priorityOverride?" (set manually)":""}</span>}
                {task.done&&<span style={{background:"#2ED57322",color:ink("#2ED573",T.light),borderRadius:999,padding:"3px 10px",fontFamily:F.body,fontSize:11}}>✓ Done</span>}
              </div>
              <div style={{fontFamily:F.heading,fontSize:22,color:T.text,lineHeight:1.2}}>{task.title}</div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:4,flexShrink:0}}>
              {!draft&&<button data-tour="task-edit" onClick={startEdit} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:8,color:T.textMuted,fontSize:11,cursor:"pointer",padding:"5px 10px"}}>Edit</button>}
              {!sessionActive&&<button onClick={onClose} aria-label="Close" style={{background:"none",border:"none",color:T.textFaint,fontSize:22,cursor:"pointer",padding:"0 0 0 8px",lineHeight:1}}>×</button>}
            </div>
          </div>

          {/* Edit panel */}
          {draft&&(()=>{
            const field={background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,padding:"8px 10px",fontSize:12,outline:"none",width:"100%",boxSizing:"border-box" as const};
            const label={fontSize:10,color:T.textMuted,textTransform:"uppercase" as const,letterSpacing:"0.08em",marginBottom:4,display:"block"};
            const subjectOptions=draft.subject&&!subjects.includes(draft.subject)?[...subjects,draft.subject]:subjects;
            return (
            <form onSubmit={e=>{e.preventDefault();saveEdit();}} style={{background:T.card,borderRadius:14,padding:"14px",border:`1px solid ${T.accent}44`,marginBottom:16,display:"flex",flexDirection:"column",gap:10}}>
              <label><span style={label}>Title</span>
                <input className="edit-field" autoFocus value={draft.title} maxLength={500} onChange={e=>setDraft({...draft,title:e.target.value})} style={field}/></label>
              <label><span style={label}>Subject</span>
                <select className="edit-field" value={draft.subject} onChange={e=>setDraft({...draft,subject:e.target.value})} style={field}>
                  <option value="">No subject</option>
                  {subjectOptions.map(s=><option key={s} value={s}>{s}</option>)}
                </select></label>
              <div style={{display:"flex",gap:8}}>
                <label style={{flex:1}}><span style={label}>Due date</span>
                  <input className="edit-field" type="date" value={draft.dueDate} onChange={e=>setDraft({...draft,dueDate:e.target.value})} style={field}/></label>
                <label style={{flex:1}}><span style={label}>Time</span>
                  <input className="edit-field" type="time" value={draft.dueTime} disabled={!draft.dueDate} onChange={e=>setDraft({...draft,dueTime:e.target.value})} style={{...field,opacity:draft.dueDate?1:0.5}}/></label>
              </div>
              <div style={{display:"flex",gap:8}}>
                {/* Plain text fields with the number keypad, not type="number":
                    those snapped an emptied field back to 0 (typing then gave
                    "030"), and step/max validation silently blocked Save. */}
                <label style={{flex:1}}><span style={label}>Estimate (hours)</span>
                  <input className="edit-field" inputMode="numeric" placeholder="0" value={draft.estH} onFocus={e=>e.currentTarget.select()} onChange={e=>setDraft({...draft,estH:e.target.value.replace(/\D/g,"").slice(0,4)})} style={field}/></label>
                <label style={{flex:1}}><span style={label}>Minutes</span>
                  <input className="edit-field" inputMode="numeric" placeholder="0" value={draft.estM} onFocus={e=>e.currentTarget.select()} onChange={e=>setDraft({...draft,estM:e.target.value.replace(/\D/g,"").slice(0,4)})} style={field}/></label>
              </div>
              {(parseInt(draft.estM,10)||0)>=60&&<div style={{fontSize:10,color:T.textMuted,marginTop:-4}}>Saves as {formatDuration(draftEstMins)}</div>}
              <label><span style={label}>Repeats</span>
                <select className="edit-field" value={draft.recurrence} onChange={e=>setDraft({...draft,recurrence:e.target.value as Recurrence})} style={field}>
                  <option value="none">Doesn't repeat</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
                </select></label>
              <div style={{display:"flex",gap:8}}>
                <button type="button" onClick={()=>setDraft(null)} style={{flex:1,background:"none",border:`1px solid ${T.border}`,borderRadius:9,padding:"9px",color:T.textMuted,cursor:"pointer",fontSize:12}}>Cancel</button>
                <button type="submit" style={{flex:1,background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:9,padding:"9px",cursor:"pointer",fontSize:12,fontWeight:500}}>Save</button>
              </div>
            </form>
            );
          })()}

          {/* Info row */}
          <div style={{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap"}}>
            {task.dueDate&&<div style={{background:T.card,borderRadius:10,padding:"8px 14px",border:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontFamily:F.body,fontSize:12,color:T.textMuted}}>{formatDate(task.dueDate)}{task.dueTime?` at ${formatTime(task.dueTime,h24)}`:""}</span>
              {!task.done&&countdown(task.dueDate,task.dueTime,now)&&<span style={{fontFamily:F.body,fontSize:12,color:ink(priColor(pr,colorCodeUrgency),T.light),fontWeight:500}}>· {countdown(task.dueDate,task.dueTime,now)}</span>}
            </div>}
            {task.estMins>0&&<div style={{background:T.card,borderRadius:10,padding:"8px 14px",border:`1px solid ${T.accent}44`,display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontFamily:F.body,fontSize:12,color:T.accent,fontWeight:500}}>
                {formatDuration(task.estMins)} estimated
              </span>
            </div>}
            {totalSessionMins>0&&<div style={{background:"#2ED57322",borderRadius:10,padding:"8px 14px",border:"1px solid #2ED57344",display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:14}}>✓</span>
              <span style={{fontFamily:F.body,fontSize:12,color:ink("#2ED573",T.light)}}>{formatDuration(totalSessionMins)} spent today</span>
            </div>}
          </div>

          {/* Snooze */}
          {!task.done&&!draft&&(
            <div data-tour="task-snooze" style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap",marginTop:-8,marginBottom:18}}>
              <span style={{fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginRight:2}}>Snooze</span>
              {([["later","In 3 hours"],["tomorrow","Tomorrow"],["week","Next week"]] as const).map(([k,l])=>(
                <button key={k} onClick={()=>onSnooze(k)} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:999,padding:"5px 12px",color:T.text,cursor:"pointer",fontSize:11}}>{l}</button>
              ))}
              {task.recurrence&&task.recurrence!=="none"&&(
                <button data-tour="task-skip" onClick={onSkipOccurrence} title="Move this repeating task to its next occurrence without completing it" style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:999,padding:"5px 12px",color:T.text,cursor:"pointer",fontSize:11}}>Skip this one ↻</button>
              )}
            </div>
          )}

          {/* Priority override */}
          <div style={{background:T.card,borderRadius:14,padding:"14px",border:`1px solid ${T.border}`,marginBottom:16}}>
            <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>Priority</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
              {([null,"low","medium","high"] as const).map(p=>{
                const active=p===null?!task.priorityOverride:task.priorityOverride===p;
                const label=p===null?"Auto":p[0].toUpperCase()+p.slice(1);
                const color=p===null?T.accent:priColor(p,colorCodeUrgency);
                return <button key={p??"auto"} aria-pressed={active} onClick={()=>onSetPriorityOverride(p)}
                  style={{background:active?color+"22":T.surface,border:`1.5px solid ${active?color:T.border}`,borderRadius:9,padding:"8px 4px",cursor:"pointer",color:active?color:T.textMuted,fontFamily:F.body,fontSize:11}}>
                  {label}
                </button>;
              })}
            </div>
          </div>

          {/* Subtasks */}
          <div style={{background:T.card,borderRadius:14,padding:"14px",border:`1px solid ${T.border}`,marginBottom:16}}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:subtasks.length?10:0}}>
              <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em"}}>Subtasks</div>
              {subtasks.length>0&&<div style={{fontFamily:F.body,fontSize:11,color:T.textFaint}}>{subtasks.filter(s=>s.done).length}/{subtasks.length}</div>}
            </div>
            {subtasks.length>0&&<div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
              {subtasks.map(s=>(
                <div key={s.id} style={{display:"flex",alignItems:"center",gap:8}}>
                  <button onClick={()=>onUpdateSubtasks(subtasks.map(x=>x.id===s.id?{...x,done:!x.done}:x))} aria-label={s.done?`Uncheck ${s.text}`:`Check off ${s.text}`} style={{background:s.done?"#2ED573":"none",border:`1.5px solid ${s.done?"#2ED573":T.textFaint}`,borderRadius:"50%",width:16,height:16,cursor:"pointer",flexShrink:0,padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {s.done&&<span style={{color:"#111",fontSize:9,fontWeight:"bold"}}>✓</span>}
                  </button>
                  <span style={{flex:1,fontFamily:F.body,fontSize:12,color:s.done?T.textFaint:T.text,textDecoration:s.done?"line-through":"none"}}>{s.text}</span>
                  <button onClick={()=>onUpdateSubtasks(subtasks.filter(x=>x.id!==s.id))} aria-label={`Delete subtask ${s.text}`} style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13,lineHeight:1,padding:"0 2px"}}>×</button>
                </div>
              ))}
            </div>}
            <div style={{display:"flex",gap:6}}>
              <input value={newSubtaskText} onChange={e=>setNewSubtaskText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addSubtask()} placeholder={subtasks.length>=LIMITS.subtasks?`Limit of ${LIMITS.subtasks} subtasks reached`:"Add a subtask..."} disabled={subtasks.length>=LIMITS.subtasks} maxLength={500} style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,padding:"7px 10px",fontFamily:F.body,fontSize:12,outline:"none"}}/>
              <button onClick={addSubtask} aria-label="Add subtask" style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:8,padding:"7px 12px",cursor:"pointer",fontFamily:F.body,fontSize:12,fontWeight:500}}>+</button>
            </div>
          </div>

          {/* Tags */}
          <div style={{background:T.card,borderRadius:14,padding:"14px",border:`1px solid ${T.border}`,marginBottom:16}}>
            <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:tags.length?10:0}}>Tags</div>
            {tags.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
              {tags.map(tag=>(
                <span key={tag} style={{display:"flex",alignItems:"center",gap:4,background:T.accent+"22",color:T.accent,borderRadius:999,padding:"3px 4px 3px 10px",fontFamily:F.body,fontSize:11}}>
                  {tag}
                  <button onClick={()=>onSetTags(tags.filter(x=>x!==tag))} aria-label={`Remove tag ${tag}`} style={{background:"none",border:"none",color:T.accent,cursor:"pointer",fontSize:13,lineHeight:1,padding:"0 4px"}}>×</button>
                </span>
              ))}
            </div>}
            <div style={{display:"flex",gap:6}}>
              <input value={newTagText} onChange={e=>setNewTagText(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addTag()} placeholder={tags.length>=LIMITS.tags?`Limit of ${LIMITS.tags} tags reached`:"Add a tag..."} disabled={tags.length>=LIMITS.tags} maxLength={100} style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,padding:"7px 10px",fontFamily:F.body,fontSize:12,outline:"none"}}/>
              <button onClick={addTag} aria-label="Add tag" style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:8,padding:"7px 12px",cursor:"pointer",fontFamily:F.body,fontSize:12,fontWeight:500}}>+</button>
            </div>
            {tags.length<LIMITS.tags&&allTags.filter(t=>!tags.includes(t)).length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:6,marginTop:8}}>
              {allTags.filter(t=>!tags.includes(t)).slice(0,8).map(t=>(
                <button key={t} onClick={()=>onSetTags([...tags,t])} style={{background:"none",border:`1px dashed ${T.border}`,borderRadius:999,padding:"3px 10px",fontFamily:F.body,fontSize:10,color:T.textFaint,cursor:"pointer"}}>+{t}</button>
              ))}
            </div>}
          </div>

          {/* Session timer */}
          <div style={{background:T.card,borderRadius:16,padding:"20px",border:`1px solid ${sessionActive?T.accent+"66":T.border}`,marginBottom:16,textAlign:"center",transition:"border-color 0.3s"}}>
            {sessionActive?(
              <>
                <div style={{fontFamily:F.body,fontSize:11,color:T.accent,marginBottom:8,letterSpacing:"0.1em",textTransform:"uppercase"}}>Session in progress</div>
                <div style={{fontFamily:F.heading,fontSize:52,color:T.text,lineHeight:1,marginBottom:4}}>
                  {sh>0?`${sh}:`:""}{String(sm).padStart(2,"0")}:{String(ss).padStart(2,"0")}
                </div>
                <div style={{fontFamily:F.body,fontSize:11,color:T.textFaint,marginBottom:18}}>Keep going!</div>
                <button onClick={onEndSession} style={{background:"#FF4757",color:"#fff",border:"none",borderRadius:12,padding:"13px 32px",fontFamily:F.heading,fontSize:17,cursor:"pointer",width:"100%",boxShadow:"0 4px 20px #FF475744"}}>
                  ⏹ End Session
                </button>
              </>
            ):(
              <>
                <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginBottom:8,letterSpacing:"0.1em",textTransform:"uppercase"}}>Ready to work?</div>
                <div style={{fontFamily:F.heading,fontSize:52,color:T.textFaint,lineHeight:1,marginBottom:18}}>00:00</div>
                <button onClick={onStartSession} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:12,padding:"13px 32px",fontFamily:F.heading,fontSize:17,cursor:"pointer",width:"100%",boxShadow:`0 4px 20px ${T.accentGlow}`}}>
                  ▶ Start Session
                </button>
              </>
            )}
          </div>

          {/* Session history */}
          {sessionHistory.length>0&&(
            <div style={{background:T.card,borderRadius:12,padding:"12px 14px",border:`1px solid ${T.border}`,marginBottom:16}}>
              <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Sessions today</div>
              {sessionHistory.map((s,i)=>(
                <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:i<sessionHistory.length-1?`1px solid ${T.borderFaint}`:"none"}}>
                  <span style={{fontFamily:F.body,fontSize:12,color:T.text}}>Session {i+1}</span>
                  <div style={{display:"flex",gap:10,alignItems:"center"}}>
                    <span style={{fontFamily:F.body,fontSize:11,color:T.textFaint}}>{s.date}</span>
                    <span style={{fontFamily:F.body,fontSize:12,color:T.accent,fontWeight:500}}>{formatDuration(s.mins)}</span>
                  </div>
                </div>
              ))}
              <div style={{display:"flex",justifyContent:"space-between",marginTop:8,paddingTop:8,borderTop:`1px solid ${T.border}`}}>
                <span style={{fontFamily:F.body,fontSize:12,color:T.textMuted}}>Total</span>
                <span style={{fontFamily:F.heading,fontSize:16,color:T.accent}}>{formatDuration(totalSessionMins)}</span>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{display:"grid",gridTemplateColumns:task.done?"1fr 1fr 1fr":"1fr 1fr",gap:8}}>
            <button onClick={onToggleDone}
              style={{background:task.done?"#FF475722":"#2ED57322",color:ink(task.done?"#FF4757":"#2ED573",T.light),border:`1px solid ${task.done?"#FF475744":"#2ED57344"}`,borderRadius:11,padding:"11px",fontFamily:F.body,fontSize:12,cursor:"pointer"}}>
              {task.done?"↩ Mark undone":"✓ Mark done"}
            </button>
            {task.done&&!task.archived&&(
              <button onClick={onArchive}
                style={{background:T.surface,color:T.textMuted,border:`1px solid ${T.border}`,borderRadius:11,padding:"11px",fontFamily:F.body,fontSize:12,cursor:"pointer"}}>
                Archive
              </button>
            )}
            {task.archived&&(
              <button onClick={onRestore}
                style={{background:T.surface,color:T.text,border:`1px solid ${T.border}`,borderRadius:11,padding:"11px",fontFamily:F.body,fontSize:12,cursor:"pointer"}}>
                Restore
              </button>
            )}
            <button onClick={onDelete}
              style={{background:"#FF475711",color:ink("#FF4757",T.light),border:"1px solid #FF475733",borderRadius:11,padding:"11px",fontFamily:F.body,fontSize:12,cursor:"pointer"}}>
              Delete task
            </button>
          </div>
          <button data-tour="task-duplicate" onClick={onDuplicate}
            style={{width:"100%",marginTop:8,background:"none",border:`1px solid ${T.border}`,borderRadius:11,padding:"10px",color:T.textMuted,fontFamily:F.body,fontSize:11,cursor:"pointer"}}>
            Duplicate task
          </button>
          {templateName===null&&<button onClick={()=>{setTemplateSaved(false);setTemplateName(task.title);}}
            style={{width:"100%",marginTop:8,background:"none",border:`1px solid ${T.border}`,borderRadius:11,padding:"10px",color:T.textMuted,fontFamily:F.body,fontSize:11,cursor:"pointer"}}>
            {templateSaved?"✓ Saved. Find it under \"+ Add homework\"":"Save as template"}
          </button>}
          {templateName!==null&&<form onSubmit={e=>{e.preventDefault();if(templateName.trim()){onSaveAsTemplate(templateName.trim());setTemplateName(null);setTemplateSaved(true);}}} style={{display:"flex",gap:6,marginTop:8}}>
            <input autoFocus value={templateName} onChange={e=>setTemplateName(e.target.value)} placeholder="Template name" aria-label="Template name" style={{flex:1,minWidth:0,background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,color:T.text,padding:"9px 12px",fontSize:12,outline:"none"}}/>
            <button type="submit" disabled={!templateName.trim()} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:9,padding:"9px 14px",cursor:"pointer",fontSize:12,fontWeight:500,opacity:templateName.trim()?1:0.5}}>Save</button>
            <button type="button" onClick={()=>setTemplateName(null)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:9,padding:"9px 12px",color:T.textMuted,cursor:"pointer",fontSize:12}}>Cancel</button>
          </form>}
        </div>
      </div>
      </div>
    </div>
  );
}

// Colored text (subject names, urgency labels) adjusted to stay readable on the
// theme -- those colors are picked for looks, and several fall well under
// WCAG AA as text on the light theme's near-white cards.
function ink(color:string,light:boolean):string{ return readableOn(color,light?"#e6e6e6":"#1a1a1a"); }

// Enter/Space activation for plain elements given role="button". Task titles
// and the reorder handle deliberately aren't <button>s: they sit in the path of
// swipe and drag gestures, and a real <button> there can swallow the touch on
// iOS Safari. click() bubbles to the card's own handler, same as a tap.
function activateOnKey(e:React.KeyboardEvent<HTMLElement>){
  if(e.key==="Enter"||e.key===" "){e.preventDefault();e.currentTarget.click();}
}

// Done checkmark, drawn as a stroke so it can draw itself in (.check-draw in
// the runtime css) the moment a task is completed; static everywhere else.
function CheckMark({size=10,color="#111",animate=false}:{size?:number;color?:string;animate?:boolean}){
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden="true" className={animate?"check-draw":undefined} style={{display:"block"}}>
      <polyline points="2.2,6.4 4.9,9 9.8,3.2" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1}/>
    </svg>
  );
}

// Defined at module scope for the same reason as TaskModal above: it's
// rendered from several places (toggles in the Settings tab) and stability
// matters so it isn't torn down and recreated on every unrelated re-render.
// One Settings section as a dropdown: the whole header row toggles it, and
// the body is only rendered while open. Which sections are open is
// remembered per device (openSettings, "hw-settings-open"). `tour` is the
// data-tour anchor "Take me there" highlights (see goTo).
// The header of a screen opened from the title menu (Inbox, History,
// Import/Export, Settings): a way back to Tasks and the screen's name, since
// the tab bar has nothing highlighted there.
function ScreenHeader({title,onBack,T,F}:{title:string;onBack:()=>void;T:ThemeObj;F:typeof FONT}){
  return(
    <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
      <button onClick={onBack} aria-label="Back to tasks" style={{background:T.cardAlt,border:`1px solid ${T.border}`,color:T.text,fontSize:12,cursor:"pointer",padding:"6px 12px",borderRadius:9}}>‹ Tasks</button>
      <h2 style={{fontFamily:F.heading,fontSize:20,color:T.text,margin:0,fontWeight:400}}>{title}</h2>
    </div>
  );
}

function SettingsSection({id,title,open,onToggle,T,F,tour,danger,gap=0,children}:{
  id:string; title:string; open:boolean; onToggle:(id:string)=>void; T:ThemeObj; F:typeof FONT;
  tour?:string; danger?:boolean; gap?:number; children:React.ReactNode;
}){
  const color=danger?ink("#FF4757",T.light):T.textMuted;
  return(
    <div data-tour={tour} style={{background:T.card,borderRadius:12,border:`1px solid ${danger?"#FF475744":T.border}`}}>
      <button onClick={()=>onToggle(id)} aria-expanded={open} aria-controls={`settings-${id}`}
        style={{display:"flex",alignItems:"center",justifyContent:"space-between",width:"100%",background:"none",border:"none",cursor:"pointer",padding:"16px",borderRadius:12,WebkitTapHighlightColor:"transparent"}}>
        <span style={{color,fontFamily:F.body,fontSize:10,letterSpacing:".08em",textTransform:"uppercase"}}>{title}</span>
        <span aria-hidden="true" style={{color,fontSize:13,transform:open?"rotate(180deg)":"none",transition:"transform 0.15s",display:"inline-block"}}>⌄</span>
      </button>
      {open&&<div id={`settings-${id}`} className="sec-body" style={{display:"flex",flexDirection:"column",gap,padding:"0 16px 16px"}}>{children}</div>}
    </div>
  );
}

function Toggle({on,onChange,T,label}:{on:boolean;onChange:(v:boolean)=>void;T:ThemeObj;label:string}){
  const trackColor=on?T.accent:T.solidBorder;
  return <button className="tog" role="switch" aria-checked={on} aria-label={label} onClick={()=>onChange(!on)} style={{background:trackColor}}>
    <span style={{position:"absolute",top:3,left:on?21:3,width:14,height:14,borderRadius:"50%",background:contrastColor(trackColor),boxShadow:"0 1px 3px rgba(0,0,0,0.4)",transition:"left 0.2s",display:"block"}}/>
  </button>;
}

// ─── TASK CARD (base) ────────────────────────────────────────────────────────
// Also module scope (see TaskModal above) -- MiniCard is rendered in a loop
// for every visible task across every layout, so being redefined (and every
// instance's DOM torn down/recreated) on each unrelated render was the most
// consequential case of this pattern in the file.
// Search as a floating panel: the search field lifts off the Tasks tab and
// floats up the middle of a blurred screen, and matching tasks (title, subject
// or tag) pop in under it as you type. Module scope, like TaskModal, so the
// once-a-second `now` tick doesn't remount it (and lose what's typed). `origin`
// is the field it flies out of and back into.
function SearchOverlay({tasks,T,F,subjectColors,colorCodeUrgency,origin,onOpenTask,onClose}:{
  tasks:Task[]; T:ThemeObj; F:typeof FONT; subjectColors:Record<string,string>; colorCodeUrgency:boolean;
  origin:React.RefObject<HTMLButtonElement|null>;
  onOpenTask:(task:Task)=>void; onClose:()=>void;
}){
  const [query,setQuery]=useState("");
  const backdropRef=useRef<HTMLDivElement>(null), barRef=useRef<HTMLDivElement>(null);
  const resultsRef=useRef<HTMLDivElement>(null), inputRef=useRef<HTMLInputElement>(null);
  const closing=useRef(false);
  // The part of the screen actually visible -- on phones the keyboard covers
  // the bottom, and the bar should float in the middle of what's left.
  const [view,setView]=useState(()=>({h:window.visualViewport?.height??window.innerHeight,top:window.visualViewport?.offsetTop??0}));
  useEffect(()=>{
    const vv=window.visualViewport;
    if(!vv)return;
    const update=()=>setView({h:vv.height,top:vv.offsetTop});
    vv.addEventListener("resize",update);vv.addEventListener("scroll",update);
    return()=>{vv.removeEventListener("resize",update);vv.removeEventListener("scroll",update);};
  },[]);
  const q=query.trim().toLowerCase();
  const results=!q?[]:tasks
    .filter(t=>!t.archived&&(t.title.toLowerCase().includes(q)||t.subject.toLowerCase().includes(q)||(t.tags||[]).some(g=>g.toLowerCase().includes(q))))
    .sort((a,b)=>a.done!==b.done?(a.done?1:-1):a.order-b.order)
    .slice(0,50);
  // Fly in from the field. A layout effect, so the first frame already shows
  // the bar at the field's spot, and focus lands inside the tap that opened
  // it (iOS only raises the keyboard for focus during a user gesture).
  useLayoutEffect(()=>{
    inputRef.current?.focus({preventScroll:true});
    const bar=barRef.current, from=origin.current?.getBoundingClientRect();
    if(!bar||!from||window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    const to=bar.getBoundingClientRect();
    backdropRef.current?.animate([{opacity:0},{opacity:1}],{duration:260,easing:"ease-out"});
    bar.animate([
      {transform:`translate(${from.left-to.left}px,${from.top-to.top}px)`,height:`${from.height}px`,boxShadow:"0 0 0 rgba(0,0,0,0)"},
      {transform:"none",height:`${to.height}px`},
    ],{duration:440,easing:"cubic-bezier(.2,.9,.25,1.05)"});
  },[origin]);
  // Fly back into the field, then unmount.
  function close(){
    if(closing.current)return;
    closing.current=true;
    const bar=barRef.current, to=origin.current?.getBoundingClientRect();
    if(!bar||!to||window.matchMedia("(prefers-reduced-motion: reduce)").matches){onClose();return;}
    const from=bar.getBoundingClientRect();
    resultsRef.current?.animate([{opacity:1},{opacity:0}],{duration:140,fill:"forwards"});
    backdropRef.current?.animate([{opacity:1},{opacity:0}],{duration:280,easing:"ease-in",fill:"forwards"});
    const anim=bar.animate([
      {transform:"none",height:`${from.height}px`},
      {transform:`translate(${to.left-from.left}px,${to.top-from.top}px)`,height:`${to.height}px`,boxShadow:"0 0 0 rgba(0,0,0,0)"},
    ],{duration:300,easing:"cubic-bezier(.4,0,.2,1)",fill:"forwards"});
    anim.finished.then(onClose,onClose);
  }
  function onKeyDown(e:React.KeyboardEvent){
    if(e.key==="Escape"){e.preventDefault();close();return;}
    if(e.key!=="ArrowDown"&&e.key!=="ArrowUp")return;
    // Arrow keys walk from the field through the results and back.
    const items=[inputRef.current,...(resultsRef.current?.querySelectorAll<HTMLElement>("[data-result]")??[])].filter(Boolean) as HTMLElement[];
    const i=items.indexOf(document.activeElement as HTMLElement);
    const next=items[Math.max(0,Math.min(items.length-1,i+(e.key==="ArrowDown"?1:-1)))];
    if(next){e.preventDefault();next.focus();}
  }
  // The typed text, marked where it matches the title.
  const highlight=(title:string)=>{
    const at=q?title.toLowerCase().indexOf(q):-1;
    if(at<0)return title;
    return <>{title.slice(0,at)}<mark style={{background:T.light?"rgba(0,0,0,0.1)":"rgba(255,255,255,0.18)",color:"inherit",borderRadius:3,padding:"0 1px"}}>{title.slice(at,at+q.length)}</mark>{title.slice(at+q.length)}</>;
  };
  return(
    <div role="dialog" aria-modal="true" aria-label="Search tasks" onKeyDown={onKeyDown}
      style={{position:"fixed",left:0,right:0,top:view.top,height:view.h,zIndex:900,display:"flex",justifyContent:"center",padding:`${Math.max(24,Math.round(view.h*0.34-28))}px 16px 16px`,transition:"padding-top .25s ease"}}>
      <div ref={backdropRef} onClick={close} style={{position:"absolute",inset:0,background:T.light?"rgba(245,245,245,0.55)":"rgba(0,0,0,0.5)",backdropFilter:"blur(14px)",WebkitBackdropFilter:"blur(14px)"}}/>
      <div style={{position:"relative",width:"min(548px,100%)",display:"flex",flexDirection:"column",gap:10,maxHeight:"100%"}}>
        <div ref={barRef} className="search-bar" style={{display:"flex",alignItems:"center",gap:9,height:54,flexShrink:0,overflow:"hidden",background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"0 8px 0 15px",color:T.textMuted,boxShadow:T.light?"0 12px 40px rgba(0,0,0,0.14)":"0 12px 40px rgba(0,0,0,0.55)"}}>
          <IconSearch/>
          <input ref={inputRef} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search tasks..." aria-label="Search tasks" enterKeyHint="search"
            onKeyDown={e=>{if(e.key==="Enter"&&results[0]){e.preventDefault();onOpenTask(results[0]);}}}
            style={{flex:1,minWidth:0,background:"none",border:"none",color:T.text,padding:"9px 0",fontFamily:F.body,fontSize:16,outline:"none"}}/>
          <button onClick={close} style={{background:"none",border:"none",color:T.textMuted,cursor:"pointer",fontFamily:F.body,fontSize:11,padding:"6px 7px"}}>Cancel</button>
        </div>
        <div ref={resultsRef} style={{display:"flex",flexDirection:"column",gap:6,overflowY:"auto",overscrollBehavior:"contain",minHeight:0,paddingBottom:8}}>
          {results.map((t,i)=>{
            const pr=getPriority(t.dueDate,t.estMins,t.priorityOverride);
            const sc=subjectColors[t.subject]||T.accent;
            return(
              <button key={t.id} data-result onClick={()=>onOpenTask(t)} className="search-pop"
                style={{animationDelay:`${Math.min(i,8)*35}ms`,display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",background:T.card,border:`1px solid ${T.border}`,borderRadius:10,padding:"11px 13px",cursor:"pointer",color:T.text}}>
                <span aria-hidden="true" style={{width:7,height:7,borderRadius:"50%",background:t.done?T.textFaint:priColor(pr,colorCodeUrgency),flexShrink:0}}/>
                <span style={{flex:1,minWidth:0,fontFamily:F.heading,fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:t.done?T.textFaint:T.text,textDecoration:t.done?"line-through":"none"}}>{highlight(t.title)}</span>
                {t.subject&&<span style={{background:sc+"22",color:ink(sc,T.light),borderRadius:999,padding:"2px 8px",fontFamily:F.body,fontSize:10,flexShrink:0}}>{t.subject}</span>}
                {!t.done&&t.dueDate&&<span style={{fontFamily:F.body,fontSize:10,color:ink(priColor(pr,colorCodeUrgency),T.light),flexShrink:0}}>{daysUntil(t.dueDate)}</span>}
              </button>
            );
          })}
          <div aria-live="polite" style={{textAlign:"center",fontFamily:F.body,fontSize:11,color:T.textMuted,padding:"6px 0"}}>
            {!q?"Type a title, subject or tag":results.length===0?`No tasks match "${query.trim()}"`:<span className="sr-only">{results.length} {results.length===1?"task":"tasks"} found</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

// "Take me there": once the destination has rendered, scrolls the element
// marked data-tour={anchor} into view, focuses it if it's a control, and rings
// it briefly. Retries for a moment, since the destination (Settings, a task
// sheet, Focus Mode) mounts after the state change that opens it. The ring is
// an inset shadow so an overflow:hidden parent (e.g. the title menu) can't clip it.
function flashTarget(anchor:string,color:string,tries=20){
  const el=document.querySelector<HTMLElement>(`[data-tour="${anchor}"]`);
  if(!el||!el.getClientRects().length){if(tries>0)setTimeout(()=>flashTarget(anchor,color,tries-1),60);return;}
  const reduce=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({block:"center",behavior:reduce?"auto":"smooth"});
  if(el.matches("button,a,input,select,[tabindex]"))el.focus({preventScroll:true});
  el.animate([
    {boxShadow:`inset 0 0 0 0 ${color}00`},
    {boxShadow:`inset 0 0 0 2px ${color}`,offset:0.12},
    {boxShadow:`inset 0 0 0 2px ${color}`,offset:0.75},
    {boxShadow:`inset 0 0 0 0 ${color}00`},
  ],{duration:2000,easing:"ease-out"});
}

// A long date for an update's detail panel, e.g. "Saturday, September 26, 2026".
function longDate(iso:string):string{
  const d=new Date(iso+"T00:00");
  return isNaN(d.getTime())?iso:d.toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric",year:"numeric"});
}

// A box as keyframe/style values, and pinning an element to one: UpdateDetail's
// card is normally centered by its flex container, so while its box animates
// it's pinned to fixed screen coordinates (else each width step would re-center
// it) and released after.
const box=(r:DOMRect)=>({left:`${r.left}px`,top:`${r.top}px`,width:`${r.width}px`,height:`${r.height}px`});
function pin(el:HTMLElement,r:DOMRect){Object.assign(el.style,{position:"fixed",margin:"0",...box(r)});}
// Back to its declared position:relative (clearing it would drop the card
// under the absolutely positioned backdrop).
function unpin(el:HTMLElement){Object.assign(el.style,{position:"relative",margin:"",left:"",top:"",width:"",height:""});}

// An Inbox update, opened: the row grows out of the menu into a card floating
// in the middle of a blurred screen (its box animates from the row's box to
// the card's, so nothing stretches), and shrinks back into the row on close.
// Back/Next step through the other updates in place. `origin` is the row
// element it grew from; module scope like SearchOverlay.
function UpdateDetail({items,index,T,F,origin,onIndex,onDismiss,onClosing,onClose,onGo}:{
  items:WhatsNewItem[]; index:number; T:ThemeObj; F:typeof FONT;
  origin:HTMLElement|null;
  onIndex:(i:number)=>void; onDismiss:(id:string)=>void; onClosing:()=>void; onClose:()=>void;
  onGo:(dest:string)=>void;
}){
  const item=items[index];
  const backdropRef=useRef<HTMLDivElement>(null), cardRef=useRef<HTMLDivElement>(null), bodyRef=useRef<HTMLDivElement>(null);
  const closeRef=useRef<HTMLButtonElement>(null);
  const closing=useRef(false);
  const reduced=()=>window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Grow out of the row once, on open. `origin` changes with Back/Next (so
  // close shrinks into the row of the update being shown), but that mustn't
  // replay this -- it made every Back/Next look like the panel reloading.
  const openedFrom=useRef(origin);
  useLayoutEffect(()=>{
    closeRef.current?.focus({preventScroll:true});
    const card=cardRef.current, from=openedFrom.current?.getBoundingClientRect();
    if(!card||!from||reduced())return;
    const to=card.getBoundingClientRect();
    pin(card,to);
    backdropRef.current?.animate([{opacity:0},{opacity:1}],{duration:280,easing:"ease-out"});
    const anim=card.animate([{...box(from),borderRadius:"8px"},{...box(to),borderRadius:"16px"}],{duration:420,easing:"cubic-bezier(.2,.9,.25,1)"});
    const release=()=>{if(!closing.current)unpin(card);};
    anim.finished.then(release,release);
    bodyRef.current?.animate([{opacity:0},{opacity:0,offset:0.45},{opacity:1}],{duration:420,easing:"ease-out"});
  },[]);
  // Back/Next swap the content in place: it slides in from the side you're
  // heading, and the card eases to the new height from the one measured just
  // before the switch (see go()).
  const shown=useRef(index);
  const heightBefore=useRef<number|null>(null);
  function go(i:number){
    heightBefore.current=cardRef.current?.getBoundingClientRect().height??null;
    onIndex(i);
  }
  useLayoutEffect(()=>{
    const dir=Math.sign(index-shown.current);
    shown.current=index;
    const card=cardRef.current, from=heightBefore.current;
    heightBefore.current=null;
    if(!dir||!card||closing.current||window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    const to=card.getBoundingClientRect().height;
    if(from!=null&&Math.abs(from-to)>=1)card.animate([{height:`${from}px`},{height:`${to}px`}],{duration:280,easing:"cubic-bezier(.2,.8,.3,1)"});
    bodyRef.current?.animate([{opacity:0,transform:`translateX(${dir*16}px)`},{opacity:1,transform:"none"}],{duration:260,easing:"cubic-bezier(.2,.8,.3,1)"});
  },[index]);
  // Back into the row -- or, when the row is gone (dismissed) or off screen, a fade.
  function close(dismissed=false){
    if(closing.current)return;
    closing.current=true;
    const card=cardRef.current, to=dismissed?null:origin?.getBoundingClientRect();
    // A dismissed update leaves the list only once the card is gone, or the
    // panel would unmount before its exit animation plays.
    const done=()=>{if(dismissed)onDismiss(item.id);onClose();};
    if(!card||reduced()){done();return;}
    const from=card.getBoundingClientRect();
    card.getAnimations().forEach(a=>a.cancel());
    bodyRef.current?.getAnimations().forEach(a=>a.cancel());
    pin(card,from);
    const intoRow=!!to&&to.width>0&&to.bottom>0&&to.top<window.innerHeight;
    backdropRef.current?.animate([{opacity:1},{opacity:0}],{duration:intoRow?340:200,easing:"ease-out",fill:"forwards"});
    let anim:Animation;
    if(intoRow){
      // One continuous move: the row is shown again underneath right away
      // (onClosing), and the card shrinks onto it while dissolving, so there's
      // nothing left to pop in when it lands. The text keeps its size and
      // wrapping (the body is frozen at its current box and clipped by the
      // card) instead of vanishing or re-flowing on the way.
      const body=bodyRef.current;
      if(body)Object.assign(body.style,{width:`${body.offsetWidth}px`,height:`${body.offsetHeight}px`,flexShrink:"0",overflow:"hidden"});
      onClosing();
      const ease="cubic-bezier(.32,.72,0,1)";
      body?.animate([{opacity:1},{opacity:0}],{duration:200,easing:"ease-out",fill:"forwards"});
      card.animate([{opacity:1},{opacity:1,offset:0.3},{opacity:0}],{duration:340,easing:"linear",fill:"forwards"});
      anim=card.animate([{...box(from),borderRadius:"16px"},{...box(to!),borderRadius:"8px"}],{duration:340,easing:ease,fill:"forwards"});
    } else {
      anim=card.animate([{opacity:1,transform:"none"},{opacity:0,transform:"scale(.96)"}],{duration:200,easing:"ease-in",fill:"forwards"});
    }
    anim.finished.then(done,done);
  }
  // "Take me there": a quick fade instead of shrinking back into the row,
  // since the destination opens as it goes.
  function goThere(dest:string){
    if(closing.current)return;
    closing.current=true;
    const card=cardRef.current;
    if(!card||reduced()){onGo(dest);return;}
    backdropRef.current?.animate([{opacity:1},{opacity:0}],{duration:180,easing:"ease-in",fill:"forwards"});
    const anim=card.animate([{opacity:1,transform:"none"},{opacity:0,transform:"scale(.97)"}],{duration:180,easing:"ease-in",fill:"forwards"});
    anim.finished.then(()=>onGo(dest),()=>onGo(dest));
  }
  if(!item)return null;
  const btn={background:"none",border:`1px solid ${T.border}`,borderRadius:9,padding:"9px 12px",cursor:"pointer",color:T.textMuted,fontFamily:F.body,fontSize:12};
  return(
    <div role="dialog" aria-modal="true" aria-labelledby="update-detail-title" data-keeps-menu onKeyDown={e=>{if(e.key==="Escape"){e.stopPropagation();close();}}}
      style={{position:"fixed",inset:0,zIndex:900,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div ref={backdropRef} onClick={()=>close()} style={{position:"absolute",inset:0,background:T.light?"rgba(245,245,245,0.55)":"rgba(0,0,0,0.5)",backdropFilter:"blur(14px)",WebkitBackdropFilter:"blur(14px)"}}/>
      <div ref={cardRef} style={{position:"relative",width:"min(460px,100%)",maxHeight:"100%",overflow:"hidden",background:T.card,border:`1px solid ${T.border}`,borderRadius:16,boxShadow:T.light?"0 16px 48px rgba(0,0,0,0.16)":"0 16px 48px rgba(0,0,0,0.6)",display:"flex",flexDirection:"column"}}>
        <div ref={bodyRef} style={{padding:"20px 20px 16px",display:"flex",flexDirection:"column",gap:14,overflowY:"auto"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
            <span style={{background:T.cardAlt,color:T.textMuted,border:`1px solid ${T.border}`,borderRadius:999,padding:"3px 10px",fontFamily:F.body,fontSize:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>{item.kind}</span>
            <button ref={closeRef} onClick={()=>close()} aria-label="Close" style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:20,lineHeight:1,padding:"2px 4px"}}>×</button>
          </div>
          <div>
            <h2 id="update-detail-title" style={{margin:0,fontFamily:F.heading,fontWeight:400,fontSize:26,lineHeight:1.15,color:T.text}}>{item.headline}</h2>
            <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginTop:6}}>{longDate(item.date)}</div>
          </div>
          <p style={{margin:0,fontFamily:F.body,fontSize:13,lineHeight:1.6,color:T.text}}>{item.description}</p>
          {item.list&&<div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>Finished</div>
            <ul style={{margin:0,paddingLeft:16,fontFamily:F.body,fontSize:12,lineHeight:1.6,color:T.text}}>
              {item.list.map((t,i)=><li key={i} style={{overflowWrap:"anywhere"}}>{t}</li>)}
            </ul>
          </div>}
          {item.where&&<div style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,padding:"10px 12px"}}>
            <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:4}}>Where to find it</div>
            <div style={{fontFamily:F.body,fontSize:12,lineHeight:1.5,color:T.text}}>{item.where}</div>
            {item.go&&<button onClick={()=>goThere(item.go!)} style={{marginTop:10,background:"none",border:`1px solid ${T.accent}`,borderRadius:9,padding:"7px 12px",cursor:"pointer",color:T.accent,fontFamily:F.body,fontSize:12}}>Take me there →</button>}
          </div>}
          <div style={{display:"flex",alignItems:"center",gap:8,paddingTop:4}}>
            <button onClick={()=>go(index-1)} disabled={index===0} aria-label="Back to the previous message" style={{...btn,opacity:index===0?0.4:1,cursor:index===0?"default":"pointer"}}>‹ Back</button>
            <button onClick={()=>go(index+1)} disabled={index===items.length-1} aria-label="Next message" style={{...btn,opacity:index===items.length-1?0.4:1,cursor:index===items.length-1?"default":"pointer"}}>Next ›</button>
            <span style={{flex:1,textAlign:"center",fontFamily:F.body,fontSize:10,color:T.textFaint}}>{index+1} of {items.length}</span>
            <button onClick={()=>close(true)} style={{...btn,background:T.accent,border:"none",color:contrastColor(T.accent)}}>Dismiss</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// The Calendar tab: a month grid (6 fixed rows, so it doesn't jump between
// months) where each day is shaded by how much open work is due that day
// (heatLevel) and dotted with its open tasks' subject colors, plus the chosen
// day's tasks underneath. Undated tasks aren't shown -- there's no day to put
// them on. Module scope like TaskModal, so the `now` tick doesn't remount it
// (which would reset the month you're looking at).
function CalendarView({tasks,T,F,subjectColors,colorCodeUrgency,weekStart,h24,now,onOpenTask,onToggleDone,onAddOn}:{
  tasks:Task[]; T:ThemeObj; F:typeof FONT; subjectColors:Record<string,string>; colorCodeUrgency:boolean;
  weekStart:number; h24:boolean; now:number;
  onOpenTask:(t:Task)=>void; onToggleDone:(id:number)=>void; onAddOn:(date:string)=>void;
}){
  const today=localDateStr(new Date(now));
  const [ym,setYm]=useState<[number,number]>(()=>{const d=new Date(now);return [d.getFullYear(),d.getMonth()];});
  const [selected,setSelected]=useState(today);
  const [year,month]=ym;
  const days=monthGrid(year,month,weekStart);
  const due=byDueDate(tasks.filter(t=>!t.archived));
  const gridRef=useRef<HTMLDivElement>(null);
  const refocus=useRef(false);
  // Moving the selection with the arrow keys keeps keyboard focus on it,
  // including when it crosses into the next or previous month.
  useEffect(()=>{
    if(!refocus.current)return;
    refocus.current=false;
    gridRef.current?.querySelector<HTMLElement>(`[data-day="${selected}"]`)?.focus();
  },[selected,ym]);
  const inMonth=(iso:string)=>Number(iso.slice(5,7))-1===month;
  function select(iso:string,viaKeys=false){
    refocus.current=viaKeys;
    setSelected(iso);
    const d=new Date(iso+"T00:00");
    if(d.getFullYear()!==year||d.getMonth()!==month)setYm([d.getFullYear(),d.getMonth()]);
  }
  // Changing month selects today if it's in view, else the 1st.
  function goMonth(delta:number){
    const [y,m]=shiftMonth(year,month,delta);
    setYm([y,m]);
    const t=new Date(now);
    setSelected(t.getFullYear()===y&&t.getMonth()===m?today:localDateStr(new Date(y,m,1)));
  }
  function onGridKey(e:React.KeyboardEvent){
    const step=({ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7} as Record<string,number>)[e.key];
    if(!step)return;
    e.preventDefault();
    const d=new Date(selected+"T00:00"); d.setDate(d.getDate()+step);
    select(localDateStr(d),true);
  }
  // Swipe left/right on the grid to change month.
  const swipeX=useRef<number|null>(null);
  const heat=["transparent",T.accent+"10",T.accent+"1f",T.accent+"2e",T.accent+"40"];
  const monthName=new Date(year,month,1).toLocaleDateString(undefined,{month:"long",year:"numeric"});
  const dayTasks=(due.get(selected)||[]).slice().sort((a,b)=>a.done!==b.done?(a.done?1:-1):(a.dueTime||"99").localeCompare(b.dueTime||"99")||a.order-b.order);
  const openMins=dayTasks.filter(t=>!t.done).reduce((n,t)=>n+(t.estMins||0),0);
  const card={background:T.card,borderRadius:14,padding:"14px",border:`1px solid ${T.border}`};
  const navBtn={background:"none",border:`1px solid ${T.border}`,borderRadius:9,width:34,height:34,cursor:"pointer",color:T.text,fontSize:16,display:"flex",alignItems:"center",justifyContent:"center",padding:0};
  const showToday=!(ym[0]===new Date(now).getFullYear()&&ym[1]===new Date(now).getMonth()&&selected===today);
  return(
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <div style={card}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
          <h2 aria-live="polite" style={{flex:1,margin:0,fontFamily:F.heading,fontWeight:400,fontSize:20,color:T.text}}>{monthName}</h2>
          {showToday&&<button onClick={()=>{setYm([new Date(now).getFullYear(),new Date(now).getMonth()]);setSelected(today);}} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:9,height:34,padding:"0 12px",cursor:"pointer",color:T.textMuted,fontFamily:F.body,fontSize:11}}>Today</button>}
          <button onClick={()=>goMonth(-1)} aria-label="Previous month" style={navBtn}>‹</button>
          <button onClick={()=>goMonth(1)} aria-label="Next month" style={navBtn}>›</button>
        </div>
        <div aria-hidden="true" style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:4}}>
          {weekdayLabels(weekStart).map(l=><div key={l} style={{textAlign:"center",fontFamily:F.body,fontSize:10,color:T.textFaint,textTransform:"uppercase",letterSpacing:"0.04em"}}>{l.slice(0,2)}</div>)}
        </div>
        <div ref={gridRef} key={`${year}-${month}`} className="sec-body" role="group" aria-label={`${monthName}, use arrow keys to move between days`} onKeyDown={onGridKey}
          onPointerDown={e=>{swipeX.current=e.clientX;}}
          onPointerUp={e=>{const x=swipeX.current;swipeX.current=null;if(x!=null&&Math.abs(e.clientX-x)>50)goMonth(e.clientX<x?1:-1);}}
          style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,touchAction:"pan-y"}}>
          {days.map(iso=>{
            const list=due.get(iso)||[];
            const open=list.filter(t=>!t.done);
            const mins=open.reduce((n,t)=>n+(t.estMins||0),0);
            const lvl=heatLevel(mins,open.length);
            const isSel=iso===selected, isToday=iso===today, other=!inMonth(iso);
            const overdue=iso<today&&open.length>0;
            const label=new Date(iso+"T00:00").toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"})
              +(open.length?`, ${open.length} due${mins?`, ${formatDuration(mins)}`:""}`:"")+(overdue?", overdue":"");
            return(
              <button key={iso} data-day={iso} onClick={()=>select(iso)} aria-label={label} aria-pressed={isSel} aria-current={isToday?"date":undefined} tabIndex={isSel?0:-1}
                style={{position:"relative",height:48,borderRadius:10,cursor:"pointer",padding:"5px 0 0",display:"flex",flexDirection:"column",alignItems:"center",gap:4,
                  background:heat[lvl],border:`${isSel?2:1}px solid ${isSel?T.accent:isToday?T.textMuted:"transparent"}`,opacity:other?0.4:1,color:T.text}}>
                <span style={{fontFamily:F.body,fontSize:13,lineHeight:1,fontWeight:isToday?600:400,color:overdue?ink(priColor("high",colorCodeUrgency),T.light):T.text}}>{Number(iso.slice(8))}</span>
                <span aria-hidden="true" style={{display:"flex",gap:3,alignItems:"center",height:6}}>
                  {open.slice(0,3).map(t=><span key={t.id} style={{width:5,height:5,borderRadius:"50%",background:subjectColors[t.subject]||T.textMuted}}/>)}
                  {open.length>3&&<span style={{fontFamily:F.body,fontSize:8,lineHeight:1,color:T.textMuted}}>+</span>}
                </span>
              </button>
            );
          })}
        </div>
        <div aria-hidden="true" style={{display:"flex",alignItems:"center",justifyContent:"flex-end",gap:4,marginTop:10,fontFamily:F.body,fontSize:9,color:T.textFaint}}>
          Less{heat.map((c,i)=><span key={i} style={{width:10,height:10,borderRadius:3,background:c,border:`1px solid ${T.borderFaint}`}}/>)}More
        </div>
      </div>
      <div style={card}>
        <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:10,marginBottom:10}}>
          <div style={{fontFamily:F.heading,fontSize:17,color:T.text}}>{selected===today?"Today":new Date(selected+"T00:00").toLocaleDateString(undefined,{weekday:"long",month:"long",day:"numeric"})}</div>
          {dayTasks.length>0&&<div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,flexShrink:0}}>{dayTasks.filter(t=>!t.done).length} due{openMins?` · ${formatDuration(openMins)}`:""}</div>}
        </div>
        {dayTasks.length===0
          ?<div style={{fontFamily:F.body,fontSize:12,color:T.textFaint,marginBottom:10}}>Nothing due.</div>
          :<div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
            {dayTasks.map(t=>{
              const sc=subjectColors[t.subject]||T.accent;
              return(
                <div key={t.id} onClick={()=>onOpenTask(t)} style={{display:"flex",alignItems:"center",gap:10,background:T.surface,borderRadius:10,padding:"9px 11px",cursor:"pointer"}}>
                  <button aria-label={t.done?`Mark ${t.title} not done`:`Mark ${t.title} done`} onClick={e=>{e.stopPropagation();onToggleDone(t.id);}}
                    style={{width:18,height:18,borderRadius:"50%",border:`2px solid ${t.done?"#2ED573":T.textFaint}`,background:t.done?"#2ED573":"none",cursor:"pointer",padding:0,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    {t.done&&<CheckMark size={10}/>}
                  </button>
                  <span role="button" tabIndex={0} onKeyDown={activateOnKey} className={"title-btn"+(t.done?" strike":"")} aria-haspopup="dialog" style={{flex:1,minWidth:0,fontFamily:F.heading,fontSize:14,color:t.done?T.textFaint:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</span>
                  {t.subject&&<span style={{background:sc+"22",color:ink(sc,T.light),borderRadius:999,padding:"2px 8px",fontFamily:F.body,fontSize:10,flexShrink:0}}>{t.subject}</span>}
                  {t.dueTime&&<span style={{fontFamily:F.body,fontSize:10,color:T.textMuted,flexShrink:0}}>{formatTime(t.dueTime,h24)}</span>}
                  {!t.dueTime&&t.estMins>0&&<span style={{fontFamily:F.body,fontSize:10,color:T.textMuted,flexShrink:0}}>{formatDuration(t.estMins)}</span>}
                </div>
              );
            })}
          </div>}
        <button onClick={()=>onAddOn(selected)} style={{width:"100%",background:"none",border:`1px dashed ${T.border}`,borderRadius:10,padding:"10px",cursor:"pointer",color:T.textMuted,fontFamily:F.body,fontSize:12}}>
          + Add homework due {selected===today?"today":new Date(selected+"T00:00").toLocaleDateString(undefined,{month:"short",day:"numeric"})}
        </button>
      </div>
    </div>
  );
}

function MiniCard({task,rank,reorderable,swipeable,T,F,subjectColors,colorCodeUrgency,now,h24,dragTaskId,dragOffsetY,onOpen,onToggleDone,onDelete,swipeClickGuard,swipeHandlers,swipeContentStyle,renderSwipeReveal,startDrag,onDragMove,endDrag,selectionMode,isSelected,onToggleSelect,justDone,onMoveBy}:{
  task:Task; rank:number; reorderable?:boolean; swipeable?:boolean;
  T:ThemeObj; F:typeof FONT; subjectColors:Record<string,string>; colorCodeUrgency:boolean; now:number; h24:boolean;
  dragTaskId:number|null; dragOffsetY:number;
  onOpen:(task:Task)=>void;
  onToggleDone:(id:number)=>void;
  onDelete:(id:number)=>void;
  swipeClickGuard:(onOpen:()=>void)=>()=>void;
  swipeHandlers:(id:number)=>{
    onPointerDown:(e:React.PointerEvent)=>void;
    onPointerMove:(e:React.PointerEvent)=>void;
    onPointerUp:()=>void;
    onPointerCancel:()=>void;
  };
  swipeContentStyle:(id:number)=>React.CSSProperties;
  renderSwipeReveal:(id:number)=>React.ReactNode;
  startDrag:(id:number,e:React.PointerEvent)=>void;
  onDragMove:(e:React.PointerEvent)=>void;
  endDrag:()=>void;
  selectionMode?:boolean; isSelected?:boolean; onToggleSelect?:(id:number)=>void;
  justDone?:boolean;
  onMoveBy?:(id:number,delta:number)=>void;
}) {
  const pr=getPriority(task.dueDate,task.estMins,task.priorityOverride);
  const sc=subjectColors[task.subject]||T.accent;
  const dm=countdown(task.dueDate,task.dueTime,now)??daysUntil(task.dueDate);
  const isTop=rank===0&&!task.done; const isNext=rank===1&&!task.done;
  const isDragging=dragTaskId===task.id;
  return(
    <div
      className="tc"
      role="listitem"
      data-task-id={task.id}
      onClick={selectionMode?()=>onToggleSelect?.(task.id):swipeClickGuard(()=>{if(dragTaskId==null){onOpen(task);}})}
      {...(swipeable&&!selectionMode?swipeHandlers(task.id):{})}
      style={{background:isTop?T.gradientCard:T.card,borderRadius:13,padding:"13px 15px",border:`1px solid ${isSelected?T.accent:isTop?T.accent+"44":task.done?"transparent":T.border}`,position:"relative",overflow:"hidden",cursor:"pointer",transform:isDragging?`translateY(${dragOffsetY}px) scale(1.02)`:"none",transition:isDragging?"none":undefined,boxShadow:isDragging?"0 8px 24px rgba(0,0,0,0.35)":undefined,zIndex:isDragging?10:undefined,touchAction:isDragging?"none":swipeable?"pan-y":undefined,pointerEvents:isDragging?"none":undefined}}>
      {swipeable&&!selectionMode&&renderSwipeReveal(task.id)}
      {!task.done&&<div style={{position:"absolute",left:0,top:0,bottom:0,width:3,background:priColor(pr,colorCodeUrgency),borderRadius:"13px 0 0 13px"}}/>}
      <div style={{paddingLeft:8,display:"flex",alignItems:"flex-start",gap:9,...(swipeable?swipeContentStyle(task.id):{})}}>
        {reorderable&&!task.done&&!selectionMode&&(
          // Drag handle, and the keyboard way to reorder: focus it and use the
          // arrow keys. A div, not a <button> -- see activateOnKey.
          <div role="button" tabIndex={0} data-reorder aria-label={`Reorder ${task.title}`} title="Drag, or use the arrow keys"
            onClick={e=>e.stopPropagation()}
            onKeyDown={e=>{if(e.key==="ArrowUp"||e.key==="ArrowDown"){e.preventDefault();e.stopPropagation();onMoveBy?.(task.id,e.key==="ArrowUp"?-1:1);}}}
            onPointerDown={e=>{e.stopPropagation();startDrag(task.id,e);}}
            onPointerMove={onDragMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            style={{background:"none",border:"none",color:T.textFaint,cursor:isDragging?"grabbing":"grab",fontSize:14,lineHeight:1,marginTop:2,padding:"0 2px",touchAction:"none",flexShrink:0,fontFamily:"inherit"}}>
            <span aria-hidden="true">⠿</span>
          </div>
        )}
        <button aria-label={selectionMode?(isSelected?`Deselect ${task.title}`:`Select ${task.title}`):task.done?`Mark ${task.title} not done`:`Mark ${task.title} done`} onClick={e=>{e.stopPropagation();if(selectionMode){onToggleSelect?.(task.id);}else{onToggleDone(task.id);}}} style={{background:selectionMode?(isSelected?T.accent:"none"):task.done?"#2ED573":"none",border:`2px solid ${selectionMode?(isSelected?T.accent:T.textFaint):task.done?"#2ED573":T.textFaint}`,borderRadius:selectionMode?4:"50%",width:19,height:19,cursor:"pointer",flexShrink:0,marginTop:2,display:"flex",alignItems:"center",justifyContent:"center",padding:0,transition:"all 0.2s"}} className={justDone&&!selectionMode?"check-pop":undefined}>
          {(selectionMode?isSelected:task.done)&&<CheckMark size={11} color={selectionMode?contrastColor(T.accent):"#111"} animate={justDone&&!selectionMode}/>}
        </button>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:7,flexWrap:"wrap"}}>
            {isTop&&<span className="rb" style={{background:T.accent+"33",color:T.accent}}>do first</span>}
            {isNext&&<span className="rb" style={{background:T.text+"11",color:T.text}}>next up</span>}
            <span role="button" tabIndex={0} onKeyDown={activateOnKey} className={"title-btn"+(task.done?(justDone?" strike strike-anim":" strike"):"")} aria-haspopup={selectionMode?undefined:"dialog"} style={{fontFamily:F.heading,fontSize:15,color:task.done?T.textFaint:T.text,transition:"color 0.3s"}}>{task.title}</span>
            {task.recurrence&&task.recurrence!=="none"&&<span title={`Repeats ${task.recurrence}`} style={{color:T.textMuted,fontSize:12}}>↻</span>}
            {task.subject&&<span style={{background:sc+"22",color:ink(sc,T.light),borderRadius:999,padding:"2px 8px",fontFamily:F.body,fontSize:10}}>{task.subject}</span>}
            {task.priorityOverride&&<span className="rb" title="Priority set manually" style={{background:priColor(task.priorityOverride,colorCodeUrgency)+"22",color:ink(priColor(task.priorityOverride,colorCodeUrgency),T.light)}}>{task.priorityOverride}</span>}
            {task.tags?.map(tag=><span key={tag} style={{color:T.textMuted,fontFamily:F.body,fontSize:10}}>#{tag}</span>)}
          </div>
          <div style={{display:"flex",gap:12,marginTop:4,flexWrap:"wrap"}}>
            {task.dueDate&&<span style={{fontFamily:F.body,fontSize:11,color:T.textMuted}}>{formatDate(task.dueDate)}{task.dueTime?` ${formatTime(task.dueTime,h24)}`:""}</span>}
            {task.estMins>0&&<span style={{fontFamily:F.body,fontSize:11,color:T.textMuted}}>{formatDuration(task.estMins)}</span>}
            {!task.done&&dm&&<span style={{fontFamily:F.body,fontSize:11,color:ink(priColor(pr,colorCodeUrgency),T.light),fontWeight:500}}>{dm}</span>}
          </div>
          {!!task.subtasks?.length&&(
            <div style={{display:"flex",alignItems:"center",gap:6,marginTop:5}}>
              <div style={{flex:1,maxWidth:80,height:4,background:T.border,borderRadius:999}}>
                <div style={{width:`${Math.round(task.subtasks.filter(s=>s.done).length/task.subtasks.length*100)}%`,height:"100%",background:T.accent,borderRadius:999,transition:"width 0.3s"}}/>
              </div>
              <span style={{fontFamily:F.body,fontSize:10,color:T.textFaint}}>{task.subtasks.filter(s=>s.done).length}/{task.subtasks.length}</span>
            </div>
          )}
        </div>
        {!selectionMode&&<button aria-label={`Delete ${task.title}`} style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:15,padding:"2px 5px",lineHeight:1}} onClick={e=>{e.stopPropagation();onDelete(task.id);}}>×</button>}
      </div>
    </div>
  );
}

// Captured at module load so the "Add to Home Screen" button can trigger the
// browser's own install prompt later (Chrome/Edge/Android fire this event;
// Safari never does, so it gets written instructions instead).
interface InstallPromptEvent extends Event { prompt:()=>Promise<void>; }
let deferredInstallPrompt:InstallPromptEvent|null=null;
if(typeof window!=="undefined"){
  window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();deferredInstallPrompt=e as InstallPromptEvent;});
}
function isStandalone(){
  return window.matchMedia?.("(display-mode: standalone)").matches||(navigator as unknown as {standalone?:boolean}).standalone===true;
}

// ─── PROFILE MODAL ────────────────────────────────────────────────────────────
// Also module scope (see TaskModal/MiniCard above) -- notably, this fixed a
// real bug on top of the perf/remount concern: the "Add a subject" field used
// to be an uncontrolled ref-based input, and since this component was being
// recreated on every unrelated parent re-render, a background update (a
// Firestore sync landing, etc.) while the user was mid-typing would silently
// wipe out the text. newSubjectText/setNewSubjectText are lifted to the
// parent specifically so they survive that; being hoisted now means this
// component itself is no longer being recreated in the first place either.
function ProfileModal({T,F,fbUser,authPending,signInError,syncError,syncStatus,visibleTasks,totalMins,subjects,subjectColors,colorCodeUrgency,setShowProfile,signInWithFirebase,signOutFirebase}:{
  T:ThemeObj; F:typeof FONT;
  fbUser:User|null; authPending:boolean; signInError:string|null; syncError:string|null; syncStatus:string|null;
  visibleTasks:Task[]; totalMins:number;
  subjects:string[]; subjectColors:Record<string,string>; colorCodeUrgency:boolean;
  setShowProfile:(v:boolean)=>void;
  signInWithFirebase:()=>Promise<void>;
  signOutFirebase:()=>Promise<void>;
}) {
  const doneTasks=visibleTasks.filter(t=>t.done).length;
  const totalTasks=visibleTasks.length;
  const highPri=visibleTasks.filter(t=>!t.done&&getPriority(t.dueDate,t.estMins,t.priorityOverride)==="high").length;
  const pct=totalTasks>0?Math.round(doneTasks/totalTasks*100):0;
  const [installHint,setInstallHint]=useState<string|null>(null);
  const subjectCounts=subjects.map(s=>({name:s,count:visibleTasks.filter(t=>t.subject===s).length,color:subjectColors[s]})).filter(s=>s.count>0).sort((a,b)=>b.count-a.count);

  // Signed in last time, but Firebase hasn't said so yet this load: show the
  // Profile page's own header rather than flashing the sign-in screen.
  if (!fbUser&&authPending) return (
    <div style={{position:"fixed",inset:0,background:T.bg,zIndex:1000,overflowY:"auto"}}>
      <div style={{maxWidth:560,margin:"0 auto",padding:"20px 16px 40px"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div style={{fontFamily:F.heading,fontSize:22,color:T.accent}}>Profile</div>
          <button onClick={()=>setShowProfile(false)} aria-label="Close" style={{background:"none",border:"none",color:T.textFaint,fontSize:22,cursor:"pointer",lineHeight:1}}>×</button>
        </div>
        <div role="status" style={{textAlign:"center",fontFamily:F.body,fontSize:12,color:T.textFaint,marginTop:48}}>Loading your profile…</div>
      </div>
    </div>
  );

  if (!fbUser) return (
    // ── SIGN IN SCREEN (monkeytype-style) ─────────────────────────────────────
    <div style={{position:"fixed",inset:0,background:T.bg,zIndex:1000,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"24px"}}>
      <button onClick={()=>setShowProfile(false)} aria-label="Close" style={{position:"absolute",top:20,right:20,background:"none",border:"none",color:T.textFaint,fontSize:22,cursor:"pointer",lineHeight:1}}>×</button>
      {/* Logo */}
      <div style={{marginBottom:40,textAlign:"center"}}>
        <div style={{fontFamily:F.heading,fontSize:42,color:T.accent,lineHeight:1}}>Due<span style={{color:T.text}}>Planner</span></div>
        <div style={{fontFamily:F.body,fontSize:12,color:T.textFaint,marginTop:6}}>due. studios · sync across devices</div>
      </div>
      {/* Sign in box */}
      <div style={{width:"100%",maxWidth:340}}>
        <button onClick={signInWithFirebase}
          style={{width:"100%",display:"flex",alignItems:"center",justifyContent:"center",gap:12,background:T.card,border:`1px solid ${T.border}`,borderRadius:12,padding:"14px 20px",cursor:"pointer",marginBottom:12,transition:"all 0.15s"}}>
          {/* Google icon */}
          <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 6.29C4.672 4.163 6.656 3.58 9 3.58z"/></svg>
          <span style={{fontFamily:F.body,fontSize:13,color:T.text}}>Continue with Google</span>
        </button>
        {signInError&&<div style={{textAlign:"center",fontFamily:F.body,fontSize:11,color:ink("#FF4757",T.light),marginBottom:12,lineHeight:1.5}}>{signInError}</div>}
        <div style={{textAlign:"center",fontFamily:F.body,fontSize:11,color:T.textFaint,lineHeight:1.6}}>
          Signing in syncs your homework across your devices. We never sell your data or use it for ads. See the <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{color:T.textMuted}}>privacy policy</a> for the services that help run the app.
        </div>
      </div>
      {/* Add to Home Screen -- the browser's own install prompt where it offers
          one (Chrome/Edge/Android), otherwise platform-specific instructions;
          hidden entirely once the app is already running installed. */}
      {!isStandalone()&&<button onClick={async()=>{
        if(deferredInstallPrompt){ await deferredInstallPrompt.prompt(); deferredInstallPrompt=null; setInstallHint(null); return; }
        setInstallHint(/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1)
          ?"In Safari, tap the Share button, then \"Add to Home Screen\"."
          :"Open your browser's menu and choose \"Install app\" or \"Add to Home screen\".");
      }} style={{width:"100%",maxWidth:340,background:"none",border:`1px solid ${T.border}`,borderRadius:12,padding:"12px",fontFamily:F.body,fontSize:12,color:T.textMuted,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",gap:8,marginTop:12}}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 2L12 16M12 2L7 7M12 2L17 7" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><path d="M3 16V20C3 21.1 3.9 22 5 22H19C20.1 22 21 21.1 21 20V16" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round"/></svg>
        Add to Home Screen
      </button>}
      {installHint&&<div style={{maxWidth:340,textAlign:"center",fontFamily:F.body,fontSize:11,color:T.textMuted,marginTop:8,lineHeight:1.5}}>{installHint}</div>}
      {/* Decorative divider */}
      <div style={{position:"absolute",bottom:40,display:"flex",alignItems:"center",gap:12}}>
        <div style={{height:1,width:60,background:T.border}}/>
        <span style={{fontFamily:F.body,fontSize:10,color:T.textFaint}}>due. studios</span>
        <div style={{height:1,width:60,background:T.border}}/>
      </div>
    </div>
  );

  // ── PROFILE SCREEN (signed in) ─────────────────────────────────────────────
  return (
    <div style={{position:"fixed",inset:0,background:T.bg,zIndex:1000,overflowY:"auto"}}>
      <div style={{maxWidth:560,margin:"0 auto",padding:"20px 16px 40px"}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
          <div style={{fontFamily:F.heading,fontSize:22,color:T.accent}}>Profile</div>
          <button onClick={()=>setShowProfile(false)} aria-label="Close" style={{background:"none",border:"none",color:T.textFaint,fontSize:22,cursor:"pointer",lineHeight:1}}>×</button>
        </div>

        {/* Avatar + name */}
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",marginBottom:32}}>
          <div style={{position:"relative",marginBottom:14}}>
            {fbUser.photoURL
              ? <img src={fbUser.photoURL} alt="" style={{width:80,height:80,borderRadius:"50%",objectFit:"cover",border:`3px solid ${T.accent}`}}/>
              : <div style={{width:80,height:80,borderRadius:"50%",background:T.surface,border:`3px solid ${T.accent}`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                  <svg width="34" height="34" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" fill={T.textMuted}/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={T.textMuted} strokeWidth="2" strokeLinecap="round"/></svg>
                </div>
            }
          </div>
          <div style={{fontFamily:F.heading,fontSize:24,color:T.text,marginBottom:4}}>{fbUser.displayName||"Your account"}</div>
          <div style={{fontFamily:F.body,fontSize:12,color:T.textFaint,marginBottom:8}}>{fbUser.email}</div>
          <div style={{display:"flex",alignItems:"center",gap:6,background:syncError?"#FF475722":"#2ED57322",borderRadius:999,padding:"4px 12px",border:`1px solid ${syncError?"#FF475744":"#2ED57344"}`}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:syncError?"#FF4757":"#2ED573"}}/>
            <span style={{fontFamily:F.body,fontSize:11,color:ink(syncError?"#FF4757":"#2ED573",T.light)}}>{syncError?"Sync issue":syncStatus||"Synced across devices"}</span>
          </div>
          {syncError&&<div style={{fontFamily:F.body,fontSize:11,color:ink("#FF4757",T.light),marginTop:8,textAlign:"center",maxWidth:280,lineHeight:1.5}}>{syncError}</div>}
        </div>

        {/* Progress ring + stats */}
        <div style={{background:T.card,borderRadius:16,padding:"20px",border:`1px solid ${T.border}`,marginBottom:14,display:"flex",alignItems:"center",gap:20}}>
          {/* Ring */}
          <div style={{position:"relative",width:80,height:80,flexShrink:0}}>
            <svg width="80" height="80" style={{transform:"rotate(-90deg)"}}>
              <circle cx="40" cy="40" r="33" fill="none" stroke={T.border} strokeWidth="7"/>
              <circle cx="40" cy="40" r="33" fill="none" stroke={T.accent} strokeWidth="7" strokeDasharray="207" strokeDashoffset={207*(1-pct/100)} strokeLinecap="round" style={{transition:"stroke-dashoffset 0.8s"}}/>
            </svg>
            <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <span style={{fontFamily:F.heading,fontSize:18,color:T.text}}>{pct}%</span>
            </div>
          </div>
          <div style={{flex:1}}>
            <div style={{fontFamily:F.heading,fontSize:13,color:T.textMuted,marginBottom:10}}>Completion</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {[{l:"Total",v:totalTasks,c:T.text},{l:"Done",v:doneTasks,c:"#2ED573"},{l:"Pending",v:totalTasks-doneTasks,c:T.accent},{l:"Urgent",v:highPri,c:priColor("high",colorCodeUrgency)}].map(s=>(
                <div key={s.l}>
                  <div style={{fontFamily:F.heading,fontSize:20,color:s.c}}>{s.v}</div>
                  <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint}}>{s.l}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Time stats */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
          <div style={{background:T.card,borderRadius:14,padding:"16px",border:`1px solid ${T.border}`}}>
            <div style={{fontFamily:F.heading,fontSize:26,color:T.accent}}>{formatDuration(totalMins)||"0m"}</div>
            <div style={{fontFamily:F.body,fontSize:11,color:T.textFaint,marginTop:2}}>Estimated left</div>
          </div>
          <div style={{background:T.card,borderRadius:14,padding:"16px",border:`1px solid ${T.border}`}}>
            <div style={{fontFamily:F.heading,fontSize:26,color:T.accent}}>{formatDuration(visibleTasks.filter(t=>t.done).reduce((a,b)=>a+(b.estMins||0),0))||"0m"}</div>
            <div style={{fontFamily:F.body,fontSize:11,color:T.textFaint,marginTop:2}}>Completed work</div>
          </div>
        </div>

        {/* Subject breakdown */}
        {subjectCounts.length>0&&(
          <div style={{background:T.card,borderRadius:14,padding:"16px",border:`1px solid ${T.border}`,marginBottom:14}}>
            <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:12}}>By subject</div>
            {subjectCounts.map(s=>(
              <div key={s.name} style={{marginBottom:10}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                  <span style={{fontFamily:F.body,fontSize:12,color:T.text}}>{s.name}</span>
                  <span style={{fontFamily:F.body,fontSize:11,color:T.textFaint}}>{s.count} task{s.count!==1?"s":""}</span>
                </div>
                <div style={{height:5,background:T.border,borderRadius:999}}>
                  <div style={{width:`${Math.round(s.count/totalTasks*100)}%`,height:"100%",background:s.color,borderRadius:999,transition:"width 0.5s"}}/>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Sign out */}
        <button onClick={async()=>{await signOutFirebase();setShowProfile(false);}}
          style={{width:"100%",background:"none",border:`1px solid #FF475744`,borderRadius:12,padding:"13px",color:ink("#FF4757",T.light),fontFamily:F.body,fontSize:13,cursor:"pointer"}}>
          Sign out
        </button>
      </div>
    </div>
  );
}

// Marks tasks done/undone. A recurring task spawns its next occurrence when
// marked done -- due date advanced (or still none, if it never had one),
// subtasks reset to unchecked, no carried-over sessions -- and remembers that
// copy's id, so marking it undone again removes the copy (if it hasn't been
// completed itself) instead of leaving a duplicate behind on every toggle.
function setDone(prev:Task[],ids:number[],done:boolean):Task[]{
  let next=[...prev];
  for(const id of ids){
    const task=next.find(t=>t.id===id);
    if(!task||task.done===done)continue;
    // Un-completing also un-archives: an archived task that isn't done would
    // otherwise be hidden from every view except Archived.
    next=next.map(t=>t.id===id?{...t,done,completedAt:done?Date.now():null,...(done?{}:{archived:false})}:t);
    const recurring=task.recurrence&&task.recurrence!=="none";
    if(done&&recurring&&!(task.spawnedNextId&&next.some(t=>t.id===task.spawnedNextId))){
      const copyId=nextId();
      next=next.map(t=>t.id===id?{...t,spawnedNextId:copyId}:t);
      next.push({...task,id:copyId,done:false,completedAt:null,archived:false,spawnedNextId:null,
        dueDate:task.dueDate?advanceDate(task.dueDate,task.recurrence as Recurrence):"",
        order:nextOrder(next),sessions:[],
        ...(task.subtasks?{subtasks:task.subtasks.map(s=>({...s,id:String(nextId()),done:false}))}:{})});
    }
    if(!done&&task.spawnedNextId){
      const copy=next.find(t=>t.id===task.spawnedNextId);
      if(copy&&!copy.done) next=next.filter(t=>t.id!==copy.id);
      next=next.map(t=>t.id===id?{...t,spawnedNextId:null}:t);
    }
  }
  return next;
}

// `new Notification()` throws on Android Chrome (pages there may only show
// notifications through a service worker), so fall back to the PWA's service
// worker registration. Best-effort either way.
function notify(title:string,options?:NotificationOptions){
  try{ new Notification(title,options); }
  catch{ navigator.serviceWorker?.ready.then(reg=>reg.showNotification(title,options)).catch(()=>{}); }
}

// Next free manual-order slot. Using list.length collided with existing
// orders once tasks had been deleted (orders keep their gaps), which made
// new tasks sort unpredictably among old ones.
function nextOrder(list:Task[]):number{
  return list.reduce((m,t)=>Math.max(m,t.order??0),-1)+1;
}

// Short two-note chime for the end of a Pomodoro -- synthesized with Web Audio
// so there's no sound file to ship. Best-effort: silently does nothing if
// audio is unavailable or blocked.
function playChime(){
  try{
    const Ctx=window.AudioContext||(window as unknown as {webkitAudioContext:typeof AudioContext}).webkitAudioContext;
    const ctx=new Ctx();
    [880,1320].forEach((freq,i)=>{
      const osc=ctx.createOscillator(), gain=ctx.createGain();
      osc.type="sine"; osc.frequency.value=freq;
      const start=ctx.currentTime+i*0.18;
      gain.gain.setValueAtTime(0.0001,start);
      gain.gain.exponentialRampToValueAtTime(0.25,start+0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001,start+0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start); osc.stop(start+0.55);
    });
    setTimeout(()=>{ctx.close().catch(()=>{});},1500);
  }catch{/* audio unavailable */}
}

export default function HomeworkPlanner() {
  const [tasks,setTasks]=useState<Task[]>(()=>{
    try{
      const s=localStorage.getItem("hw-tasks");
      const loaded:Task[]=s?JSON.parse(s):DEFAULT_TASKS;
      // Backfill order for tasks saved before drag-to-reorder existed.
      return loaded.map((t,i)=>t.order===undefined?{...t,order:i}:t);
    }catch{return DEFAULT_TASKS;}
  });
  // Latest tasks, readable from long-lived callbacks (the Firestore listener)
  // without re-subscribing on every change.
  const tasksRef=useRef(tasks);
  useEffect(()=>{tasksRef.current=tasks;},[tasks]);
  // Recently deleted: every deleted task is kept here for 30 days so it can be
  // restored after the undo toast is gone. Synced (users/{uid}/trash) when
  // signed in, so a delete on one device shows up in the others' trash.
  const [trash,setTrash]=usePersistedState<TrashEntry[]>("hw-trash",[]);
  useEffect(()=>{ setTrash(pruneTrash); },[setTrash]);
  const trashRef=useRef(trash);
  useEffect(()=>{trashRef.current=trash;},[trash]);
  // Date & time settings (Settings -> Date & time); synced with the profile.
  const [timeFormat,setTimeFormat]=usePersistedState<"12h"|"24h">("hw-timeformat","12h");
  const [weekStart,setWeekStart]=usePersistedState<number>("hw-weekstart",0); // 0 = Sunday, 1 = Monday
  const h24=timeFormat==="24h";
  const [selectedTask,setSelectedTask]=useState<Task|null>(null);
  // Wall clock for live countdowns ("due in 2h 15m"), refreshed every 30s.
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const t=setInterval(()=>setNow(Date.now()),30000);return()=>clearInterval(t);},[]);
  const [themeMode,setThemeMode]=usePersistedState<"light"|"dark"|"auto">("hw-thememode","auto");
  const [systemPrefersDark,setSystemPrefersDark]=useState(()=>typeof window!=="undefined"&&!!window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(()=>{
    if(typeof window==="undefined"||!window.matchMedia)return;
    const mq=window.matchMedia("(prefers-color-scheme: dark)");
    const handler=(e:MediaQueryListEvent)=>setSystemPrefersDark(e.matches);
    mq.addEventListener("change",handler);
    return()=>mq.removeEventListener("change",handler);
  },[]);
  const effectiveThemeMode:"light"|"dark"=themeMode==="auto"?(systemPrefersDark?"dark":"light"):themeMode;
  // There's exactly one theme per light/dark category (Stealth / Stealth Light),
  // so the theme is fully determined by effectiveThemeMode -- no independent
  // theme choice, no per-category "last picked" memory, and nothing to correct
  // when the mode changes.
  const themeName:ThemeName=effectiveThemeMode==="light"?"stealthLight":"stealth";
  const [savedLayout,setLayout]=usePersistedState<LayoutName>("hw-layout","list");
  // A saved layout may be one that's since been removed -- fall back to List.
  const layout:LayoutName=savedLayout in LAYOUTS?savedLayout:"list";
  const [groupBy,setGroupBy]=usePersistedState("hw-group","none");
  const [showDone,setShowDone]=usePersistedState("hw-showdone",true);
  const [showSuggestion,setShowSuggestion]=usePersistedState("hw-showsuggestion",true);
  // The suggestion card's × hides just the current suggestion (by task id);
  // it comes back when a different task becomes the most urgent. Turning
  // suggestions off entirely is the Settings toggle.
  const [hiddenSuggestionFor,setHiddenSuggestionFor]=usePersistedState<number|null>("hw-suggestion-hidden",null);
  // 0 = never auto-archive. Otherwise the number of days after completion before
  // a done task is automatically archived (re-checked whenever tasks change).
  const [autoArchiveDays,setAutoArchiveDays]=usePersistedState("hw-autoarchive",7);
  // Auto-archive: re-checked whenever tasks (local edits, or a Firestore sync
  // landing) or the setting change. Idempotent -- once a task is archived this
  // finds nothing new to do and no-ops, so it can't loop or fight manual unarchive.
  // This is a genuine side effect (archiving based on wall-clock time having
  // passed, not on a prop mirroring another prop), so it belongs in a useEffect
  // per React's own guidance -- react-hooks/set-state-in-effect's heuristic
  // doesn't distinguish that from the "adjusting state" anti-pattern it targets.
  useEffect(()=>{
    if(autoArchiveDays<=0)return;
    const cutoff=Date.now()-autoArchiveDays*86400000;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTasks(prev=>{
      let changed=false;
      const next=prev.map(t=>{
        if(t.done&&!t.archived&&t.completedAt&&t.completedAt<cutoff){changed=true;return {...t,archived:true};}
        return t;
      });
      return changed?next:prev;
    });
  },[tasks,autoArchiveDays]);

  // Due date reminders. NOTE: this is Notification API only, no service worker --
  // it only fires while the tab is open (or gets reopened/refocused), never as
  // true background push when the tab/browser is fully closed.
  const [notificationsEnabled,setNotificationsEnabled]=usePersistedState("hw-notifications",false);
  const [notificationNote,setNotificationNote]=useState<string|null>(null);
  async function toggleNotifications(next:boolean){
    if(!next){ setNotificationsEnabled(false); setNotificationNote(null); return; }
    if(!("Notification" in window)){ setNotificationNote("Notifications aren't supported in this browser."); setNotificationsEnabled(false); return; }
    const perm=await Notification.requestPermission();
    if(perm==="granted"){ setNotificationsEnabled(true); setNotificationNote(null); }
    else { setNotificationsEnabled(false); setNotificationNote("Notifications were blocked. Allow them for this site in your browser settings to turn this on."); }
  }
  // Multiple, independently-toggleable lead times for tasks that have a
  // specific due TIME (not just a date) -- e.g. both "1 day before" and
  // "1 hour before" can be on at once. Tasks without a due time fall back to
  // the plain once-daily due/overdue summary below, since there's no time to
  // offset from.
  const [enabledOffsets,setEnabledOffsets]=usePersistedState<string[]>("hw-reminder-offsets",["0"]);
  function toggleOffset(key:string){
    setEnabledOffsets(prev=>prev.includes(key)?prev.filter(k=>k!==key):[...prev,key]);
  }
  useEffect(()=>{
    if(!notificationsEnabled)return;
    if(!("Notification" in window)||Notification.permission!=="granted")return;
    function checkDue(){
      if(document.hidden)return;
      const today=todayISO();
      if(localStorage.getItem("hw-last-notified")!==today){
        // Tasks with a due time get their own offset reminders below, so the
        // daily summary only covers date-only tasks (unless offsets are all off).
        const due=tasks.filter(t=>!t.done&&!t.archived&&t.dueDate&&t.dueDate<=today&&(!t.dueTime||enabledOffsets.length===0||t.dueDate<today));
        if(due.length>0){
          localStorage.setItem("hw-last-notified",today);
          const title=due.length===1?`"${due[0].title}" is due`:`${due.length} tasks due or overdue`;
          notify(title,{body:due.slice(0,3).map(t=>t.title).join(", ")});
        }
      }
      // Offset-based reminders, only for tasks with a specific due time --
      // fires once per (task, offset, due-datetime) combo, tracked so
      // editing a task's due date/time naturally resets which reminders
      // are still owed for it.
      if(enabledOffsets.length===0)return;
      let sent:Record<string,true>={};
      try{sent=JSON.parse(localStorage.getItem("hw-sent-reminders")||"{}");}catch{/* ignore */}
      const now=Date.now();
      let changed=false;
      for(const t of tasks){
        if(t.done||t.archived||!t.dueDate||!t.dueTime)continue;
        const dueAt=new Date(`${t.dueDate}T${t.dueTime}`).getTime();
        // Every enabled offset whose reminder time has arrived. Each stops at
        // the due time, except "at due time" itself, which gets a 15-minute
        // grace window -- otherwise its window (due time -> due time) is empty
        // and it could never fire.
        const eligible=REMINDER_OFFSETS.filter(o=>enabledOffsets.includes(o.key)&&now>=dueAt-o.mins*60000&&now<dueAt+(o.mins===0?15*60000:0));
        if(eligible.length===0)continue;
        // Only the closest one is actually sent; the earlier, now-stale ones are
        // just marked as sent -- so opening the app 30 minutes before a deadline
        // gives one reminder, not "1 day / 3 hours / 1 hour" all at once.
        const sentKey=(o:typeof REMINDER_OFFSETS[number])=>`${t.id}-${o.key}-${t.dueDate}T${t.dueTime}`;
        const closest=eligible.reduce((a,b)=>b.mins<a.mins?b:a);
        if(!sent[sentKey(closest)]){
          const minsLeft=Math.round((dueAt-now)/60000);
          const daysLeft=Math.round(minsLeft/1440);
          const when=minsLeft<=0?"now":minsLeft<60?`in ${minsLeft} min`:minsLeft<1440?`in ${formatDuration(minsLeft)}`:`in ${daysLeft} day${daysLeft===1?"":"s"}`;
          notify(`"${t.title}" is due ${when}`,{body:`${formatDate(t.dueDate)} at ${formatTime(t.dueTime,h24)}`});
        }
        for(const o of eligible){ if(!sent[sentKey(o)]){ sent[sentKey(o)]=true; changed=true; } }
      }
      // Drop records for tasks that are finished, deleted, or rescheduled --
      // they can never match again, and would otherwise pile up forever.
      const live=tasks.filter(t=>!t.done&&!t.archived&&t.dueDate&&t.dueTime).map(t=>[`${t.id}-`,`-${t.dueDate}T${t.dueTime}`]);
      for(const k of Object.keys(sent)){
        if(!live.some(([pre,post])=>k.startsWith(pre)&&k.endsWith(post))){ delete sent[k]; changed=true; }
      }
      if(changed)localStorage.setItem("hw-sent-reminders",JSON.stringify(sent));
    }
    checkDue();
    document.addEventListener("visibilitychange",checkDue);
    // Offset reminders need to fire close to a specific time, not just when
    // the tab regains focus, so also re-check periodically while it's open.
    const interval=setInterval(checkDue,60000);
    return ()=>{document.removeEventListener("visibilitychange",checkDue);clearInterval(interval);};
  },[notificationsEnabled,tasks,enabledOffsets,h24]);

  // Desktop layout: "narrow" (default, current single-column look), "wide" (roomier
  // center column), "sidebar" (tabs move into a persistent left nav column). All of
  // these only kick in above a min-width via CSS media queries, so phones/tablets
  // always render the same single narrow column regardless of this setting.
  const [desktopLayout,setDesktopLayout]=usePersistedState("hw-desktoplayout","narrow");
  // Red/orange/green priority coloring, toggleable off in favor of one neutral
  // gray (NEUTRAL_PRIORITY_COLOR) everywhere urgency is shown -- default on.
  const [colorCodeUrgency,setColorCodeUrgency]=usePersistedState("hw-colorcode-urgency",true);
  const [liquidGlass,setLiquidGlass]=usePersistedState("hw-liquid-glass",false);
  // Animation speed (Settings -> Looks; local-only): 1 is normal. Applied app
  // wide by src/lib/animSpeed.ts.
  const [storedAnimSpeed,setAnimSpeed]=usePersistedState<number>("hw-anim-speed",1);
  const animSpeed=clampSpeed(storedAnimSpeed);
  useEffect(()=>{setAnimationSpeed(animSpeed);},[animSpeed]);
  // Pomodoro lengths (minutes) and whether a break starts on its own when a
  // focus session ends. Local-only, like the other Looks/Focus preferences.
  const [pomodoroWorkMins,setPomodoroWorkMins]=usePersistedState("hw-pomodoro-work",25);
  const [pomodoroBreakMins,setPomodoroBreakMins]=usePersistedState("hw-pomodoro-break",5);
  const [autoStartBreaks,setAutoStartBreaks]=usePersistedState("hw-pomodoro-autobreak",true);
  // "New task questions": which add-task questions are asked, in what order.
  // Local-only, like the Focus timer settings.
  const [savedAddQuestions,setSavedAddQuestions]=usePersistedState<unknown>("hw-add-questions",null);
  const addQuestionPrefs=normalizeQuestionPrefs(savedAddQuestions,QUESTION_KEYS);
  const askQuestions=useMemo(()=>askedQuestions(savedAddQuestions),[savedAddQuestions]);
  const [subjects,setSubjects]=usePersistedState<string[]>("hw-subjects",DEFAULT_SUBJECTS);
  // Only the ids the user dismissed are stored, and the feed itself always
  // comes from WHATS_NEW -- storing the whole feed (the old approach) meant a
  // returning user never saw any entry added after their first visit.
  const [dismissedWhatsNew,setDismissedWhatsNew]=useState<string[]>(()=>{
    try{
      const stored=localStorage.getItem("hw-whatsnew-dismissed");
      if(stored)return JSON.parse(stored);
      const legacy=localStorage.getItem("hw-whatsnew");
      if(legacy){
        const kept=new Set((JSON.parse(legacy) as {id:string}[]).map(w=>w.id));
        return LEGACY_WHATSNEW_IDS.filter(id=>!kept.has(id));
      }
    }catch{/* malformed or unavailable storage -- show everything */}
    return [];
  });
  useEffect(()=>{
    try{localStorage.setItem("hw-whatsnew-dismissed",JSON.stringify(dismissedWhatsNew));localStorage.removeItem("hw-whatsnew");}catch{/* storage unavailable */}
  },[dismissedWhatsNew]);
  const whatsNew=WHATS_NEW.filter(w=>!dismissedWhatsNew.includes(w.id));
  // The Inbox's Updates filter: one chip per kind that still has an update
  // showing, in UPDATE_KIND_ORDER (kinds not listed there go last).
  const [updateKind,setUpdateKind]=useState("all");
  const updateKinds=[...new Set(whatsNew.map(w=>w.kind))].sort((a,b)=>kindRank(a)-kindRank(b));
  const activeKind=updateKinds.includes(updateKind)?updateKind:"all";
  const shownUpdates=activeKind==="all"?whatsNew:whatsNew.filter(w=>w.kind===activeKind);
  // Which Inbox dropdowns are open. Not remembered: both start open.
  const [openInbox,setOpenInbox]=useState<string[]>(["inbox-messages","inbox-updates"]);
  function toggleInboxSection(id:string){setOpenInbox(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);}
  function dismissWhatsNew(id:string){setDismissedWhatsNew(prev=>[...prev,id]);}
  // The Inbox update open in the floating panel (UpdateDetail), by id, and the
  // row it grew out of (to grow back into on close).
  const [openUpdate,setOpenUpdate]=useState<{id:string;origin:HTMLElement|null;closing?:boolean}|null>(null);
  const [subjectColors,setSubjectColors]=useState<Record<string,string>>(()=>{try{const s=localStorage.getItem("hw-subjectcolors");return {...DEFAULT_SUBJECT_COLORS,...(s?JSON.parse(s):{})};}catch{return DEFAULT_SUBJECT_COLORS;}});
  useEffect(()=>{localStorage.setItem("hw-subjectcolors",JSON.stringify(subjectColors));},[subjectColors]);
  const [templates,setTemplates]=usePersistedState<TaskTemplate[]>("hw-templates",[]);
  function saveAsTemplate(task:Task,name:string){
    setTemplates(prev=>[...prev,{id:String(nextId()),name,subject:task.subject,estMins:task.estMins,recurrence:task.recurrence,subtasks:(task.subtasks||[]).map(s=>({text:s.text}))}]);
  }
  function addSubject(name:string){
    const trimmed=name.trim();
    if(!trimmed||subjects.length>=LIMITS.subjects||subjects.some(s=>s.toLowerCase()===trimmed.toLowerCase()))return;
    const used=new Set(Object.values(subjectColors));
    const color=SUBJECT_COLOR_PALETTE.find(c=>!used.has(c))||SUBJECT_COLOR_PALETTE[subjects.length%SUBJECT_COLOR_PALETTE.length];
    setSubjects(prev=>[...prev,trimmed]);
    setSubjectColors(prev=>({...prev,[trimmed]:color}));
  }
  // Rename and/or recolor a subject; a rename carries over to every task
  // (including Recently deleted) and template using it. False if the new name
  // is empty or taken.
  function updateSubject(old:string,name:string,color:string):boolean{
    const trimmed=name.trim();
    if(!trimmed||subjects.some(s=>s!==old&&s.toLowerCase()===trimmed.toLowerCase()))return false;
    setSubjects(prev=>prev.map(s=>s===old?trimmed:s));
    setSubjectColors(prev=>{const next={...prev};delete next[old];next[trimmed]=color;return next;});
    if(trimmed!==old){
      setTasks(prev=>prev.map(t=>t.subject===old?{...t,subject:trimmed}:t));
      setTrash(prev=>prev.map(e=>e.task.subject===old?{...e,task:{...e.task,subject:trimmed}}:e));
      setTemplates(prev=>prev.map(tp=>tp.subject===old?{...tp,subject:trimmed}:tp));
    }
    return true;
  }
  function removeSubject(name:string){
    setSubjects(prev=>prev.filter(s=>s!==name));
    setSubjectColors(prev=>{const next={...prev};delete next[name];return next;});
  }

  useEffect(()=>{localStorage.setItem("hw-tasks",JSON.stringify(tasks));},[tasks]);
  // Clears any stale custom-accent override from before this feature was removed,
  // so a leftover value can't silently hijack T.accent away from the active
  // theme's own black/white accent (this is what caused text using color:T.accent
  // to render invisible against a background it was never designed for).
  useEffect(()=>{localStorage.removeItem("hw-accent");},[]);
  // Clears any stale per-user font choice from before the Font picker was
  // removed (down to exactly one font now, same treatment as hw-accent above).
  useEffect(()=>{localStorage.removeItem("hw-font");},[]);

  // ── FIREBASE AUTH ─────────────────────────────────────────────────────────────
  const [fbUser,setFbUser]=useState<User|null>(null);
  // True from load until Firebase first reports the auth state, but only if
  // this device was signed in last time ("hw-signed-in"). Lets Profile show a
  // loading state instead of the sign-in screen for that moment.
  const [authPending,setAuthPending]=useState(()=>localStorage.getItem("hw-signed-in")==="1");
  const [signInError,setSignInError]=useState<string|null>(null);
  // Surfaces a failure from either half of the Firestore sync (read or write)
  // -- previously both failed completely silently, so a permission error or
  // dropped connection meant edits just never reached the cloud with no way
  // for the user to know their data wasn't actually syncing.
  const [syncError,setSyncError]=useState<string|null>(null);
  const isSyncingProfile=useRef(false);
  // Sync status, for the "Synced 2m ago" line and the offline indicator.
  const [lastSyncedAt,setLastSyncedAt]=useState<number|null>(null);
  const [hasPendingWrites,setHasPendingWrites]=useState(false);
  const [online,setOnline]=useState(()=>navigator.onLine);
  useEffect(()=>{
    const on=()=>setOnline(true), off=()=>setOnline(false);
    window.addEventListener("online",on); window.addEventListener("offline",off);
    return()=>{window.removeEventListener("online",on);window.removeEventListener("offline",off);};
  },[]);
  // Guards each "save TO Firestore" effect below from firing before we've
  // heard back from Firestore, for THIS uid specifically, even once. Without
  // this, signing in on a device that still has different local/default data
  // races the outbound save against the inbound read -- if the save's
  // isSyncing window covers the moment the real snapshot arrives, that
  // snapshot gets dropped and the stale local data gets written over the
  // user's actual cloud data instead of the other way around. Storing the uid
  // we've synced (not just a boolean) means a direct switch from one
  // signed-in account to another -- or a sign-out/sign-back-in as the same
  // account -- can't leave a stale "synced" flag pointing at the wrong (or
  // now-outdated) snapshot. Reactive state, not a ref -- an empty result
  // (nothing to apply) still needs to flip this via a re-render, and a ref
  // mutation alone wouldn't trigger that.
  const [profileSyncedForUid,setProfileSyncedForUid]=useState<string|null>(null);
  const [tasksSyncedForUid,setTasksSyncedForUid]=useState<string|null>(null);
  // Task sync (users/{uid}/tasks for live tasks, users/{uid}/trash for
  // Recently deleted). baseRef is what we last knew the cloud held, per task
  // id; dirtyAtRef is when this device last changed a task it hasn't written
  // yet. An incoming snapshot is merged against both (src/lib/sync.ts) rather
  // than replacing local state, so an edit made in the 400ms before it's
  // written can't be wiped by another device's change arriving first, and the
  // save effect writes only the fields that changed. Before this, tasks were
  // one array field on users/{uid} -- see migrateLegacyTasks below for why
  // that stopped scaling.
  const baseRef=useRef<Map<number,SyncRecord<Task>>>(new Map());
  const dirtyAtRef=useRef<Map<number,number>>(new Map());
  const prevLocalRef=useRef<Map<number,SyncRecord<Task>>>(new Map());
  // Latest snapshot of each collection; merging waits until both have arrived.
  const cloudTasksRef=useRef<Map<number,CloudRecord<Task>>|null>(null);
  const cloudTrashRef=useRef<Map<number,CloudRecord<Task>>|null>(null);
  const syncUidRef=useRef<string|null>(null);
  // Task ids with a write of ours still on its way to the server (count per
  // id). One write can touch both tasks/ and trash/ (e.g. moving a task to
  // Recently deleted), but the two listeners below hear about it separately --
  // for a moment the task looks gone from both, which the merge would read as
  // "deleted on another device" and wipe. So while a write is in flight, the
  // merge uses what we wrote instead of the cloud's in-between state, and
  // re-merges (applyRef) once it lands.
  const inFlightRef=useRef<Map<number,number>>(new Map());
  const applyRef=useRef<(()=>void)|null>(null);
  // Set only for an explicit sign-in (not a restored session): the first
  // cloud snapshot after it keeps any tasks created while signed out instead
  // of replacing them. Limited to explicit sign-ins because on a normal page
  // load, a local task missing from the cloud usually means it was deleted
  // on another device, and must not be resurrected.
  const mergeLocalOnSignIn=useRef(false);
  // Gates both live listeners below until any one-time legacy-data migration
  // for this uid has been checked (and, if needed, completed) -- see
  // migrateLegacyTasks. Without this, the tasks-subcollection listener could
  // see "genuinely empty" on a pre-migration existing account (wiping local
  // tasks the instant it fires) before the migration's own write has a chance
  // to land.
  const [readyForUid,setReadyForUid]=useState<string|null>(null);
  // Whether THIS uid had no profile document at all the moment migration was
  // checked -- i.e. a genuinely first-ever sign-in, never synced before. An
  // empty tasks subcollection is ambiguous on its own (brand new account with
  // nothing to sync down yet, vs. a returning account that legitimately has
  // zero tasks right now); this disambiguates it so the tasks-FROM listener
  // knows not to apply an empty result -- and so wipe local state -- for a
  // brand-new account, while still respecting a real "zero tasks" for anyone
  // who has synced before.
  const [isNewAccountForUid,setIsNewAccountForUid]=useState<string|null>(null);

  // Listen for auth state
  useEffect(()=>{
    const unsub=onAuthStateChanged(auth,user=>{
      setFbUser(user);
      setAuthPending(false);
      if(user) { localStorage.removeItem("hw-signin-redirect-pending"); localStorage.setItem("hw-signed-in","1"); }
      else { localStorage.removeItem("hw-signed-in"); setProfileSyncedForUid(null); setTasksSyncedForUid(null); setReadyForUid(null); setIsNewAccountForUid(null); }
    });
    // Only relevant if signInWithFirebase had to fall back to the redirect
    // method below (e.g. a browser that blocks/mishandles the popup) -- this
    // is where any error from THAT flow surfaces, since there's no popup
    // promise to catch in that case.
    getRedirectResult(auth).then(result=>{
      const pending=localStorage.getItem("hw-signin-redirect-pending");
      if(!result&&pending&&Date.now()-Number(pending)<5*60*1000){
        // A redirect sign-in was started but Firebase came back with no user
        // and no thrown error -- this is one of two ways storage-blocking
        // shows up; see isStorageBlockedError above for the other (thrown)
        // shape, caught below.
        setSignInError(STORAGE_BLOCKED_MESSAGE);
      }
      localStorage.removeItem("hw-signin-redirect-pending");
    }).catch(e=>{
      console.error(e);
      if(isStorageBlockedError(e)){
        setSignInError(STORAGE_BLOCKED_MESSAGE);
      } else {
        const code=(e as {code?:string})?.code||"unknown";
        setSignInError(`Sign-in didn't go through (${code}). Please try again.`);
      }
      localStorage.removeItem("hw-signin-redirect-pending");
    });
    return unsub;
  },[]);

  // One-time-per-uid: move any pre-existing "tasks" array field from the old
  // single-document shape into the users/{uid}/tasks subcollection, then
  // remove it. Runs to completion (readyForUid gates both live listeners
  // below) before either one attaches, so there's no window where the
  // subcollection listener could see "genuinely empty" on an account that
  // actually still has legacy data waiting to move.
  useEffect(()=>{
    // Sign-out already resets readyForUid (and the other uid-keyed sync
    // state) from the auth-listener's callback above, so nothing to do here.
    if(!fbUser)return;
    let cancelled=false;
    (async()=>{
      try{
        const profileRef=doc(db,"users",fbUser.uid);
        const countsRef=doc(db,"users",fbUser.uid,"meta","counts");
        // Make sure the task counter exists (it starts at zero; tasks from
        // before it existed just aren't counted). Every task write bumps it,
        // and the rules refuse a new task without that -- so if it can't be
        // checked (offline, nothing cached), queue its creation anyway: it
        // lands before the task writes queued after it, and if the doc already
        // exists the rules just refuse this reset, harmlessly.
        try{
          const c=await getDoc(countsRef);
          if(!c.exists())await setDoc(countsRef,{n:0,t:0,last:""});
        }catch(err){
          console.error(err);
          setDoc(countsRef,{n:0,t:0,last:""}).catch(()=>{});
        }
        const snap=await getDoc(profileRef);
        const isNew=!snap.exists();
        const data=snap.exists()?snap.data():null;
        if(data&&Array.isArray(data.tasks)){
          const tasksCol=collection(db,"users",fbUser.uid,"tasks");
          const existing=await getDocs(tasksCol);
          if(existing.empty&&data.tasks.length>0){
            // One batch per task, each bumping the task counter (the rules
            // check one task per counter change). Only after they've all been
            // written is the legacy field cleared -- if anything here throws,
            // it's left in place so the next load retries from scratch.
            await Promise.all((data.tasks as Task[]).map(t=>{
              const batch=writeBatch(db);
              addTaskWrite(batch,{task:doc(tasksCol,String(t.id)),trash:doc(db,"users",fbUser.uid,"trash",String(t.id)),counts:countsRef},t.id,{task:t},undefined,Date.now(),true);
              return batch.commit();
            }));
          }
          await updateDoc(profileRef,{tasks:deleteField()});
        }
        if(!cancelled) setIsNewAccountForUid(isNew?fbUser.uid:null);
      }catch(err){
        console.error(err);
        if(!cancelled) setSyncError("Couldn't prepare cloud sync. Please try again.");
      }finally{
        if(!cancelled) setReadyForUid(fbUser.uid);
      }
    })();
    return ()=>{cancelled=true;};
  },[fbUser]);

  // Sync the small "profile" fields (not tasks -- those live in their own
  // subcollection, synced separately below) FROM Firestore.
  useEffect(()=>{
    if(!fbUser||readyForUid!==fbUser.uid)return;
    const ref=doc(db,"users",fbUser.uid);
    const unsub=onSnapshot(ref,snap=>{
      if(snap.exists()&&!isSyncingProfile.current){
        const data=snap.data();
        // Firestore data is untyped (DocumentData) -- a malformed or legacy
        // document (e.g. from an older buggy version, or a manual edit in the
        // console) could otherwise inject a wrong-shaped value straight into
        // state and crash a render. Cheap shape checks before applying.
        if(typeof data.layout==="string"&&data.layout in LAYOUTS) setLayout(data.layout as LayoutName);
        if(typeof data.colorCodeUrgency==="boolean") setColorCodeUrgency(data.colorCodeUrgency);
        if(data.timeFormat==="12h"||data.timeFormat==="24h") setTimeFormat(data.timeFormat);
        if(data.weekStart===0||data.weekStart===1) setWeekStart(data.weekStart);
        if(Array.isArray(data.subjects)&&data.subjects.every((s:unknown)=>typeof s==="string")) setSubjects(data.subjects);
        if(data.subjectColors&&typeof data.subjectColors==="object"&&Object.values(data.subjectColors).every(v=>typeof v==="string")) setSubjectColors({...DEFAULT_SUBJECT_COLORS,...data.subjectColors});
      }
      setProfileSyncedForUid(fbUser.uid);
      setSyncError(null);
    },err=>{
      console.error(err);
      setSyncError("Couldn't sync with the cloud. Your changes are saved on this device, but may not reach your other devices until this is resolved.");
    });
    return unsub;
  },[fbUser,readyForUid,setLayout,setColorCodeUrgency,setSubjects,setTimeFormat,setWeekStart]);

  // Save the profile fields TO Firestore whenever they change. Gated on
  // profileSyncedForUid matching the current user so the very first write
  // can't fire before we know what's actually in the user's cloud doc.
  useEffect(()=>{
    if(!fbUser||profileSyncedForUid!==fbUser.uid)return;
    isSyncingProfile.current=true;
    const ref=doc(db,"users",fbUser.uid);
    setDoc(ref,{layout,colorCodeUrgency,subjects,subjectColors,timeFormat,weekStart},{merge:true})
      .then(()=>setSyncError(null))
      .catch(err=>{
        console.error(err);
        setSyncError("Couldn't save to the cloud. Your changes are safe on this device, but won't reach your other devices until this is resolved.");
      })
      .finally(()=>{isSyncingProfile.current=false;});
  },[layout,colorCodeUrgency,subjects,subjectColors,timeFormat,weekStart,fbUser,profileSyncedForUid]);

  // Sync tasks FROM the tasks and trash subcollections.
  useEffect(()=>{
    if(!fbUser||readyForUid!==fbUser.uid)return;
    const uid=fbUser.uid;
    // A different account than the one baseRef/dirtyAtRef describe: start clean.
    if(syncUidRef.current!==uid){ baseRef.current=new Map(); dirtyAtRef.current=new Map(); prevLocalRef.current=new Map(); inFlightRef.current=new Map(); syncUidRef.current=uid; }
    cloudTasksRef.current=null; cloudTrashRef.current=null;
    const apply=()=>{
      const cloudTasks=cloudTasksRef.current, cloudTrash=cloudTrashRef.current;
      if(!cloudTasks||!cloudTrash)return;
      const cloud=new Map([...cloudTrash,...cloudTasks]);
      for(const id of inFlightRef.current.keys()){
        const mine=baseRef.current.get(id);
        if(mine) cloud.set(id,{...mine,updatedAt:cloud.get(id)?.updatedAt??0}); else cloud.delete(id);
      }
      // An empty cloud is ambiguous on its own: a brand-new account with
      // nothing synced yet vs. a returning account that legitimately has zero
      // tasks. isNewAccountForUid (set by the migration effect above, from
      // whether a profile doc existed at all) tells them apart -- for a new
      // account, leave local state (e.g. DEFAULT_TASKS) alone so the save
      // effect pushes it up as the first write.
      if(cloud.size===0&&isNewAccountForUid===uid&&baseRef.current.size===0){ mergeLocalOnSignIn.current=false; setTasksSyncedForUid(uid); return; }
      const local=localRecords(tasksRef.current,trashRef.current);
      if(mergeLocalOnSignIn.current){
        // Explicit sign-in: keep tasks created while signed out (marking them
        // as unsaved local changes) instead of letting the cloud replace them.
        const isStarter=(t:Task)=>!t.done&&DEFAULT_TASKS.some(d=>d.id===t.id&&d.title===t.title);
        const at=Date.now();
        for(const [id,r] of local) if(!cloud.has(id)&&r.deletedAt===undefined&&!isStarter(r.task)) dirtyAtRef.current.set(id,at);
        mergeLocalOnSignIn.current=false;
      }
      const merged=reconcile(baseRef.current,local,cloud,dirtyAtRef.current);
      baseRef.current=new Map([...cloud].map(([id,r])=>[id,r.deletedAt!==undefined?{task:r.task,deletedAt:r.deletedAt}:{task:r.task}]));
      for(const id of [...dirtyAtRef.current.keys()]) if(same(merged.get(id),baseRef.current.get(id))) dirtyAtRef.current.delete(id);
      // Keep the current on-screen order of existing tasks; new ones go last.
      const pos=new Map(tasksRef.current.map((t,i)=>[t.id,i]));
      const live:Task[]=[], deleted:TrashEntry[]=[];
      for(const r of merged.values()) if(r.deletedAt!==undefined) deleted.push({task:r.task,deletedAt:r.deletedAt}); else live.push(r.task);
      live.sort((x,y)=>(pos.get(x.id)??Infinity)-(pos.get(y.id)??Infinity));
      deleted.sort((x,y)=>y.deletedAt-x.deletedAt);
      if(!same(live,tasksRef.current)) setTasks(live);
      if(!same(deleted,trashRef.current)) setTrash(deleted);
      setTasksSyncedForUid(uid);
    };
    applyRef.current=apply;
    let tasksMeta={pending:false,fromCache:true}, trashMeta={pending:false,fromCache:true};
    const status=()=>{
      const pending=tasksMeta.pending||trashMeta.pending;
      setHasPendingWrites(pending);
      if(!pending&&!tasksMeta.fromCache&&!trashMeta.fromCache) setLastSyncedAt(Date.now());
    };
    const onErr=(err:unknown)=>{
      console.error(err);
      setSyncError("Couldn't sync with the cloud. Your changes are saved on this device, but may not reach your other devices until this is resolved.");
    };
    const toMap=(docs:QueryDocumentSnapshot[],deleted:boolean)=>{
      const m=new Map<number,CloudRecord<Task>>();
      for(const d of docs){const r=cloudRecord(d,deleted);if(r)m.set(r.task.id,r);}
      return m;
    };
    // includeMetadataChanges: also hear when pending writes reach the server
    // (for "Synced just now"); docChanges() leaves those out, so they skip the merge.
    const unsubTasks=onSnapshot(collection(db,"users",uid,"tasks"),{includeMetadataChanges:true},snap=>{
      tasksMeta={pending:snap.metadata.hasPendingWrites,fromCache:snap.metadata.fromCache};
      if(!cloudTasksRef.current||snap.docChanges().length>0){ cloudTasksRef.current=toMap(snap.docs,false); apply(); }
      status(); setSyncError(null);
    },onErr);
    const unsubTrash=onSnapshot(collection(db,"users",uid,"trash"),{includeMetadataChanges:true},snap=>{
      trashMeta={pending:snap.metadata.hasPendingWrites,fromCache:snap.metadata.fromCache};
      if(!cloudTrashRef.current||snap.docChanges().length>0){ cloudTrashRef.current=toMap(snap.docs,true); apply(); }
      status();
    },err=>{
      // Don't let a trash problem hold up syncing the tasks themselves.
      onErr(err);
      trashMeta={pending:false,fromCache:false};
      if(!cloudTrashRef.current){ cloudTrashRef.current=new Map(); apply(); }
    });
    return()=>{unsubTasks();unsubTrash();applyRef.current=null;};
  },[fbUser,readyForUid,isNewAccountForUid,setTrash]);

  // Save tasks TO the cloud whenever they change -- only the tasks that differ
  // from baseRef, and for an edited task only its changed fields (a merge
  // write), so a save can't overwrite fields another device just changed.
  // Each doc carries updatedAt (when the edit happened) for conflict merging.
  // A deleted task moves from tasks/ to trash/ (with deletedAt); emptying the
  // trash or the 30-day cleanup deletes the doc for real. Trash is its own
  // collection rather than a flag on tasks/ docs so older app versions still
  // open on another device see a plain delete instead of the task coming back.
  //
  // Debounced so a burst of rapid local changes collapses into one write --
  // most notably, drag-to-reorder calls setTasks() on every card the dragged
  // item passes over. Local state (and localStorage) still update instantly.
  const tasksSaveTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  // The not-yet-sent debounced write, if any -- lets sign-out push it through
  // immediately instead of losing the last edit made within 400ms of signing out.
  const pendingTasksWrite=useRef<(()=>Promise<void>)|null>(null);
  useEffect(()=>{
    if(!fbUser||tasksSyncedForUid!==fbUser.uid)return;
    const uid=fbUser.uid;
    // Note when each task changed, for conflict merging.
    const local=localRecords(tasks,trash);
    const at=Date.now();
    for(const id of new Set([...local.keys(),...baseRef.current.keys()])){
      const r=local.get(id);
      if(same(r,baseRef.current.get(id))) dirtyAtRef.current.delete(id);
      else if(!dirtyAtRef.current.has(id)||!same(r,prevLocalRef.current.get(id))) dirtyAtRef.current.set(id,at);
    }
    prevLocalRef.current=local;
    clearTimeout(tasksSaveTimer.current);
    const run=():Promise<void>=>{
      pendingTasksWrite.current=null;
      const base=baseRef.current;
      const commits:Promise<void>[]=[];
      for(const id of new Set([...local.keys(),...base.keys()])){
        const L=local.get(id), B=base.get(id);
        if(same(L,B))continue;
        const updatedAt=dirtyAtRef.current.get(id)??Date.now();
        const refs={task:doc(db,"users",uid,"tasks",String(id)),trash:doc(db,"users",uid,"trash",String(id)),counts:doc(db,"users",uid,"meta","counts")};
        const counted=true; // the rules require the task counter on every create (firestore.rules)
        // One batch per task, so one rejected write can't take others down with it.
        const batch=writeBatch(db);
        addTaskWrite(batch,refs,id,L,B,updatedAt,counted);
        const inFlight=inFlightRef.current;
        inFlight.set(id,(inFlight.get(id)??0)+1);
        commits.push(batch.commit().catch(async err=>{
          // Rejected -- most often because B was stale (another device moved
          // or deleted this task first, so the counter change didn't match).
          // Retry once from what actually exists in the cloud right now.
          if((err as {code?:string})?.code!=="permission-denied")throw err;
          const [tk,tr]=await Promise.all([getDocFromServer(refs.task),getDocFromServer(refs.trash)]);
          const retry=writeBatch(db);
          addTaskWriteFromActual(retry,refs,id,L,{tasks:tk.exists(),trash:tr.exists()},updatedAt,counted);
          await retry.commit().catch(err2=>{
            // Still refused while adding: most likely the per-account cap.
            if(L&&!tk.exists()&&!tr.exists())setSyncError(`You've reached the limit of ${LIMITS.tasks.toLocaleString()} tasks (including archived and recently deleted ones). New tasks are saved on this device, but won't sync until you delete some.`);
            throw err2;
          });
        }).finally(()=>{
          const left=(inFlight.get(id)??1)-1;
          if(left>0)inFlight.set(id,left); else inFlight.delete(id);
          applyRef.current?.();
        }));
        // Optimistic: Firestore applies the write to its local cache right
        // away and retries it until the server accepts or rejects it.
        if(L) base.set(id,L); else base.delete(id);
        dirtyAtRef.current.delete(id);
      }
      if(commits.length===0)return Promise.resolve();
      return Promise.all(commits)
        .then(()=>setSyncError(null))
        .catch(err=>{
          console.error(err);
          setSyncError(prev=>prev?.startsWith("You've reached the limit")?prev:"Couldn't save to the cloud. Your changes are safe on this device, but won't reach your other devices until this is resolved.");
        });
    };
    pendingTasksWrite.current=run;
    tasksSaveTimer.current=setTimeout(run,400);
    return ()=>clearTimeout(tasksSaveTimer.current);
  },[tasks,trash,fbUser,tasksSyncedForUid]);

  async function signInWithFirebase(){
    setSignInError(null);
    // Set before the popup resolves: the auth listener can fire (and start
    // syncing) before signInWithPopup's promise does.
    mergeLocalOnSignIn.current=true;
    try{
      await signInWithPopup(auth,googleProvider);
    } catch(e){
      mergeLocalOnSignIn.current=false;
      console.error(e);
      const code=(e as {code?:string})?.code||"unknown";
      if(code==="auth/popup-closed-by-user"||code==="auth/cancelled-popup-request"){
        return; // the user closed it (or a second attempt overlapped) -- not a real failure, nothing to show
      }
      if(code==="auth/operation-not-supported-in-this-environment"){
        // The one case where popup genuinely isn't an option at all (some
        // embedded/in-app webviews) -- redirect is the only path here,
        // despite its own known issues (see isStorageBlockedError below).
        try{
          localStorage.setItem("hw-signin-redirect-pending",String(Date.now()));
          await signInWithRedirect(auth,googleProvider);
        } catch(e2){
          localStorage.removeItem("hw-signin-redirect-pending");
          console.error(e2);
          if(isStorageBlockedError(e2)){ setSignInError(STORAGE_BLOCKED_MESSAGE); }
          else { const code2=(e2 as {code?:string})?.code||"unknown"; setSignInError(`Sign-in didn't go through (${code2}). Please try again.`); }
        }
        return;
      }
      // Everything else here (most commonly auth/popup-blocked) means the
      // browser's popup blocker stepped in. Popup-based sign-in doesn't
      // depend on sessionStorage surviving a full page navigation the way
      // signInWithRedirect does (the result comes back via postMessage
      // between two windows that stay open at the same time), so it's
      // markedly more reliable in browsers with strict storage partitioning
      // -- notably Firefox's Enhanced Tracking Protection, which reliably
      // breaks the redirect method regardless of per-site exceptions, since
      // the actual storage access happens on Firebase's authDomain (a
      // different origin from this site) during the round trip, not on this
      // site's own origin. Asking the user to allow popups and retry with
      // the *more* reliable method beats silently falling back to the one
      // that's known to fail here.
      setSignInError("Your browser blocked the sign-in popup. Please allow popups for this site, then try again. That's more reliable here than the alternative full-page redirect method.");
    }
  }
  async function signOutFirebase(){
    clearTimeout(tasksSaveTimer.current);
    // Capped: offline, a write only resolves once it reaches the server, and
    // Firestore keeps it queued anyway -- sign-out shouldn't hang on that.
    try{ await Promise.race([pendingTasksWrite.current?.(),new Promise(r=>setTimeout(r,3000))]); }catch{/* already surfaced via syncError */}
    await fbSignOut(auth);
    setFbUser(null);
    // Signed-out use is local-only, so don't leave this account's tasks and
    // subjects sitting on the device (possibly a shared one) after signing
    // out -- they're safe in the cloud and come back on the next sign-in.
    baseRef.current=new Map(); dirtyAtRef.current=new Map(); prevLocalRef.current=new Map();
    setLastSyncedAt(null);
    setTasks([]);
    setSubjects(DEFAULT_SUBJECTS);
    setSubjectColors(DEFAULT_SUBJECT_COLORS);
    setTrash([]);
    setRecaps([]);setRecapsChecked(null);
  }
  const [showDeleteAccountConfirm,setShowDeleteAccountConfirm]=useState(false);
  const [deleteConfirmText,setDeleteConfirmText]=useState("");
  const [deleteAccountBusy,setDeleteAccountBusy]=useState(false);
  const [deleteAccountError,setDeleteAccountError]=useState<string|null>(null);
  // Deletes the Firestore profile doc + every doc in the tasks and trash subcollections,
  // then the Auth account itself, then wipes local data too -- "delete my
  // data" should mean all of it, not just the cloud copy. In chunks, since a
  // batch holds at most 500 writes and an account can have up to 5,500 docs;
  // the profile doc goes last, so an interrupted run can simply be retried.
  // (The task counter, users/{uid}/meta/counts, can't be deleted by design --
  // see firestore.rules -- and holds only two numbers.)
  async function deleteAccountForever(){
    if(!fbUser)return;
    setDeleteAccountBusy(true);
    setDeleteAccountError(null);
    try{
      const [snap,trashSnap]=await Promise.all([getDocs(collection(db,"users",fbUser.uid,"tasks")),getDocs(collection(db,"users",fbUser.uid,"trash"))]);
      const refs=[...snap.docs,...trashSnap.docs].map(d=>d.ref);
      for(let i=0;i<refs.length;i+=450){
        const batch=writeBatch(db);
        refs.slice(i,i+450).forEach(r=>batch.delete(r));
        await batch.commit();
      }
      await writeBatch(db).delete(doc(db,"users",fbUser.uid)).commit();
      await deleteUser(fbUser);
      Object.keys(localStorage).filter(k=>k.startsWith("hw-")).forEach(k=>localStorage.removeItem(k));
      window.location.reload();
    } catch(e){
      console.error(e);
      const code=(e as {code?:string})?.code||"unknown";
      setDeleteAccountError(
        code==="auth/requires-recent-login"
          ? "For your security, please sign out, sign back in, and try again."
          : `Couldn't delete your account (${code}). Please try again.`
      );
    } finally {
      setDeleteAccountBusy(false);
    }
  }

  const [adding,setAdding]=useState(false);
  const [focusMode,setFocusMode]=useState(false); // transient by design -- no persistence needed
  // Focus Mode swaps the *entire* app shell (see the early-return below), so
  // without this the tab bar/header just vanish mid-frame -- especially ugly
  // right after the tab bar's own sliding pill animation. startViewTransition
  // needs the DOM to already reflect the new state by the time its callback
  // returns, which setFocusMode alone can't guarantee (React batches state
  // updates), hence flushSync forcing it through synchronously first. Falls
  // straight back to a plain instant setFocusMode on browsers that don't
  // have the API yet (anything pre Safari 18 -- Chrome/Edge have had it for
  // years), so this never breaks anything, only sometimes fails to animate.
  useEffect(()=>{
    if(!focusMode)return;
    const onKey=(e:KeyboardEvent)=>{if(e.key==="Escape")setFocusMode(false);};
    document.addEventListener("keydown",onKey);
    return()=>document.removeEventListener("keydown",onKey);
  },[focusMode]);
  function setFocusModeAnimated(value:boolean){
    if(typeof document.startViewTransition==="function"){
      document.startViewTransition(()=>{flushSync(()=>setFocusMode(value));});
    } else {
      setFocusMode(value);
    }
  }
  const [step,setStep]=useState(0);
  const [newTask,setNewTask]=useState<Partial<Task>>({title:"",subject:"",dueDate:"",dueTime:"",estMins:30});
  const [pendingDueDate,setPendingDueDate]=useState<string|null>(null);
  const [usingTemplate,setUsingTemplate]=useState(false);
  const [templateSubtasks,setTemplateSubtasks]=useState<{text:string}[]|null>(null);
  const inputValRef=useRef("");
  const [filter,setFilter]=useState("all");
  // The floating search panel (SearchOverlay), and the field it flies out of.
  const [searchOpen,setSearchOpen]=useState(false);
  const searchTriggerRef=useRef<HTMLButtonElement>(null);
  const [activeTab,setActiveTab]=useState("tasks");
  const [titleMenuOpen,setTitleMenuOpen]=useState(false);
  const titleMenuRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!titleMenuOpen)return;
    // Panels opened from the menu (data-keeps-menu, e.g. an Inbox update) sit
    // outside it but shouldn't close it.
    const keeps=(t:EventTarget|null)=>t instanceof Element&&!!t.closest("[data-keeps-menu]");
    function onPointerDown(e:PointerEvent){if(titleMenuRef.current&&!titleMenuRef.current.contains(e.target as Node)&&!keeps(e.target))setTitleMenuOpen(false);}
    function onKeyDown(e:KeyboardEvent){if(e.key==="Escape"&&!keeps(e.target))setTitleMenuOpen(false);}
    document.addEventListener("pointerdown",onPointerDown);
    document.addEventListener("keydown",onKeyDown);
    return ()=>{document.removeEventListener("pointerdown",onPointerDown);document.removeEventListener("keydown",onKeyDown);};
  },[titleMenuOpen]);
  // "time left" breakdown popover in the header -- same outside-click /
  // Escape-to-close handling as the title menu above.
  const [timeMenuOpen,setTimeMenuOpen]=useState(false);
  const timeMenuRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!timeMenuOpen)return;
    function onPointerDown(e:PointerEvent){if(timeMenuRef.current&&!timeMenuRef.current.contains(e.target as Node))setTimeMenuOpen(false);}
    function onKeyDown(e:KeyboardEvent){if(e.key==="Escape")setTimeMenuOpen(false);}
    document.addEventListener("pointerdown",onPointerDown);
    document.addEventListener("keydown",onKeyDown);
    return ()=>{document.removeEventListener("pointerdown",onPointerDown);document.removeEventListener("keydown",onKeyDown);};
  },[timeMenuOpen]);
  // Which Settings dropdowns are open (SettingsSection ids), remembered on this
  // device so returning to Settings doesn't mean reopening everything.
  const [openSettings,setOpenSettings]=usePersistedState<string[]>("hw-settings-open",[]);
  function toggleSettingsSection(id:string){setOpenSettings(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);}
  // Syllabus import: transient by design (a paste-and-review staging area, not
  // something worth persisting across reloads like tasks are).
  const [importText,setImportText]=useState("");
  const [importSubject,setImportSubject]=useState<string|null>(null);
  const [importPreview,setImportPreview]=useState<{title:string;dueDate:string;checked:boolean}[]|null>(null);
  const [importedCount,setImportedCount]=useState<number|null>(null);
  const importSubjectEff=importSubject&&subjects.includes(importSubject)?importSubject:subjects[0]||"";
  function scanSyllabus(){
    const found=parseSyllabus(importText);
    setImportPreview(found.map(f=>({...f,checked:true})));
    setImportedCount(null);
  }
  function toggleImportItem(idx:number){
    setImportPreview(prev=>prev&&prev.map((it,i)=>i===idx?{...it,checked:!it.checked}:it));
  }
  function commitImport(){
    if(!importPreview)return;
    const subject=importSubjectEff;
    const toAdd=importPreview.filter(it=>it.checked);
    if(toAdd.length===0)return;
    setTasks(prev=>[
      ...prev,
      ...toAdd.map((it,i):Task=>({id:nextId(),title:it.title,subject,dueDate:it.dueDate,dueTime:"",estMins:0,done:false,order:nextOrder(prev)+i})),
    ]);
    setImportedCount(toAdd.length);
    setImportText("");
    setImportPreview(null);
  }
  const [pomodoroActive,setPomodoroActive]=useState(false);
  const [pomodoroSecs,setPomodoroSecs]=useState(()=>pomodoroWorkMins*60);
  const [pomodoroPhase,setPomodoroPhase]=useState<"work"|"break">("work");
  const [timeHours,setTimeHours]=useState(0);
  const [timeMins,setTimeMins]=useState(30);
  const [showProfile,setShowProfile]=useState(false);
  const [sessionActive,setSessionActive]=useState(false);
  const [sessionSecs,setSessionSecs]=useState(0);
  const sessionInterval=useRef<ReturnType<typeof setInterval>|undefined>(undefined);
  const inputRef=useRef<HTMLInputElement>(null);
  // Settings' "Add a subject" field. Controlled and kept up here so a
  // re-render (a Firestore sync landing, etc.) can never wipe typed text.
  const [newSubjectText,setNewSubjectText]=useState("");
  const [pendingSubjectDelete,setPendingSubjectDelete]=useState<string|null>(null);
  // The subject being renamed/recolored in Settings, and its draft values.
  const [editingSubject,setEditingSubject]=useState<{old:string;name:string;color:string}|null>(null);
  const [confirmEmptyTrash,setConfirmEmptyTrash]=useState(false);
  // Drag-to-reorder (default list layout, pending tasks only)
  const [dragTaskId,setDragTaskId]=useState<number|null>(null);
  const [dragOffsetY,setDragOffsetY]=useState(0);
  const dragStartY=useRef(0);
  const dragOrderIds=useRef<number[]>([]);
  // Swipe gestures (List/Checklist layouts): left deletes, right toggles
  // done. Direction is locked on the first few px of movement so a mostly-vertical
  // drag (page scroll) is left alone instead of being hijacked as a swipe.
  const [swipeId,setSwipeId]=useState<number|null>(null);
  const [swipeX,setSwipeX]=useState(0);
  const swipeStart=useRef({x:0,y:0});
  const swipeLocked=useRef(false);
  const swipeMoved=useRef(false);
  const SWIPE_THRESHOLD=90;
  // Undo/redo action history. Actions apply immediately (so Firestore sync,
  // which just diffs against `tasks`, doesn't need special-casing) and keep
  // what's needed to reverse them: "delete" keeps the removed tasks; "change"
  // keeps each affected task's full state before and after (see changeTasks).
  // A new action always clears redoStack, same as any standard undo/redo history.
  const [undoStack,setUndoStack]=useState<HistoryAction[]>([]);
  const [redoStack,setRedoStack]=useState<HistoryAction[]>([]);
  const [undoToast,setUndoToast]=useState<string|null>(null);
  function addToTrash(list:Task[]){
    const ids=new Set(list.map(t=>t.id));
    const added=trashEntries(list);
    setTrash(prev=>[...added,...prev.filter(e=>!ids.has(e.task.id))].slice(0,200));
  }
  function removeFromTrash(ids:number[]){
    const s=new Set(ids);
    setTrash(prev=>prev.filter(e=>!s.has(e.task.id)));
  }
  function restoreFromTrash(id:number){
    const entry=trash.find(e=>e.task.id===id);
    if(!entry)return;
    setTasks(prev=>prev.some(t=>t.id===id)?prev:[...prev,{...entry.task,order:nextOrder(prev)}]);
    removeFromTrash([id]);
  }
  const undoToastTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  // Bulk edit / multi-select, in every layout: MiniCard handles it itself, the
  // other layouts' rows go through openOrSelect/chk in renderTasks.
  const [selectionMode,setSelectionMode]=useState(false);
  const [selectedIds,setSelectedIds]=useState<number[]>([]);
  function toggleSelected(id:number){
    setSelectedIds(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);
  }
  // The bulk bar's "Pick a date..." swaps its due-date menu for a date field.
  // null = not picking; otherwise the date typed so far (applied with "Set",
  // not on change -- mid-typing a year can briefly be a valid date like 0002).
  const [bulkDate,setBulkDate]=useState<string|null>(null);
  function exitSelectionMode(){ setSelectionMode(false); setSelectedIds([]); setBulkDate(null); }

  const base=THEMES[themeName];
  // Liquid glass (optional, "Liquid Glass" toggle in Options -> Looks): every
  // surface token becomes a translucent tint over the page's soft background
  // glow (see .app-shell::before in the stylesheet) instead of an opaque gray,
  // and borders become a faint rim. The css string below keys its glass
  // selectors off these exact border values. Off = the original opaque theme.
  const glass=!liquidGlass
    ?{card:base.card as string,cardAlt:base.cardAlt as string,surface:base.surface as string,border:base.border as string,borderAccent:base.borderAccent as string}
    :base.light
    ?{card:"rgba(255,255,255,0.6)",cardAlt:"rgba(255,255,255,0.42)",surface:"rgba(255,255,255,0.5)",border:"rgba(0,0,0,0.08)",borderAccent:"rgba(0,0,0,0.12)"}
    :{card:"rgba(255,255,255,0.045)",cardAlt:"rgba(255,255,255,0.08)",surface:"rgba(255,255,255,0.035)",border:"rgba(255,255,255,0.11)",borderAccent:"rgba(255,255,255,0.16)"};
  const T:ThemeObj={...base,...glass,solidBorder:base.border,borderFaint:liquidGlass?glass.border:base.border+"33",accentGlow:base.accent+"44",gradientCard:`linear-gradient(135deg,${glass.cardAlt},${glass.card})`,accent:base.accent as typeof base.accent};
  // Mirrors just the resolved background color (not the whole theme) to its own
  // key, read synchronously by a tiny inline script in index.html before React
  // hydrates -- prevents a flash of the browser's default white background for
  // returning dark-theme users, without duplicating the THEMES palette there.
  useEffect(()=>{try{localStorage.setItem("hw-bg",T.bg);}catch{/* storage unavailable */}},[T.bg]);

  const suggestion=buildSuggestion(tasks);

  // focus input when adding starts
  useEffect(()=>{if(adding){setTimeout(()=>inputRef.current?.focus(),50);}},[adding,step]);

  // Pomodoro timer: a focus session, then a break. Finishing either phase is
  // handled in its own effect (not inside the countdown's state updater, where
  // side effects don't belong): it plays a short chime, sends a notification
  // if they're allowed, and moves to the other phase.
  //
  // Counts down from a fixed end time, not by subtracting a second per tick:
  // browsers slow timers in background tabs to about once a minute (and pause
  // them with the screen locked), which used to stretch a 25-minute session
  // far past 25 minutes. Re-anchored whenever it starts or changes phase.
  const pomodoroSecsRef=useRef(pomodoroSecs);
  useEffect(()=>{pomodoroSecsRef.current=pomodoroSecs;});
  useEffect(()=>{
    if(!pomodoroActive)return;
    const endAt=Date.now()+pomodoroSecsRef.current*1000;
    const tick=()=>setPomodoroSecs(Math.max(0,Math.ceil((endAt-Date.now())/1000)));
    const t=setInterval(tick,500);
    document.addEventListener("visibilitychange",tick);
    return()=>{clearInterval(t);document.removeEventListener("visibilitychange",tick);};
  },[pomodoroActive,pomodoroPhase]);
  const [pomodoroDone,setPomodoroDone]=useState(false);
  // Set when a break runs out; shows the "next up" suggestion until it's
  // started or dismissed.
  const [breakEnded,setBreakEnded]=useState(false);
  // The task the last focus session was logged to, so the suggestion after the
  // break can offer to keep going on it.
  const [lastWorkedTaskId,setLastWorkedTaskId]=useState<number|null>(null);
  // Which task Focus Mode is about (null = the first pending task). The
  // refs mirror the resolved task and the after-break suggestion for the
  // Pomodoro-finished effect below, which is declared before they're computed.
  const [focusTaskId,setFocusTaskId]=useState<number|null>(null);
  // Tasks completed a moment ago: they hold their place in the list while the
  // check draws in and the title strikes through, then settle to the bottom
  // (see toggleDone).
  const [justDone,setJustDone]=useState<number[]>([]);
  // Text for the screen-reader-only live region (e.g. "Moved to position 2 of 5").
  const [srMessage,setSrMessage]=useState("");
  const [focusPickerOpen,setFocusPickerOpen]=useState(false);
  const pomodoroTaskRef=useRef<number|null>(null);
  const nextSuggestionRef=useRef<string|null>(null);
  useEffect(()=>{
    if(!pomodoroActive||pomodoroSecs>0)return;
    playChime();
    if(pomodoroPhase==="work"){
      // A finished focus session counts as a work session on the focus task.
      const logId=pomodoroTaskRef.current;
      if(logId!=null)setTasks(prev=>prev.map(t=>t.id===logId?{...t,sessions:addSession(t.sessions,{mins:pomodoroWorkMins,at:Date.now()})}:t));
      setLastWorkedTaskId(logId);setPomodoroPhase("break");setPomodoroSecs(pomodoroBreakMins*60);setPomodoroActive(autoStartBreaks);setPomodoroDone(true);setBreakEnded(false);
      try{ if("Notification" in window&&Notification.permission==="granted") notify("Pomodoro done",{body:autoStartBreaks?`Nice work! Your ${pomodoroBreakMins}-minute break has started.`:`Nice work! Time for a ${pomodoroBreakMins}-minute break.`}); }catch{/* notifications unavailable */}
    }else{
      setPomodoroPhase("work");setPomodoroSecs(pomodoroWorkMins*60);setPomodoroActive(false);setPomodoroDone(false);setBreakEnded(true);
      const next=nextSuggestionRef.current;
      try{ if("Notification" in window&&Notification.permission==="granted") notify("Break's over",{body:next?`Next up: ${next}`:"Ready for another round?"}); }catch{/* notifications unavailable */}
    }
  },[pomodoroActive,pomodoroSecs,pomodoroPhase,pomodoroWorkMins,pomodoroBreakMins,autoStartBreaks]);
  useEffect(()=>{
    if(!pomodoroDone)return;
    const t=setTimeout(()=>setPomodoroDone(false),8000);
    return()=>clearTimeout(t);
  },[pomodoroDone]);
  // Back to a fresh focus session (also how a break is skipped).
  function resetPomodoro(){setPomodoroActive(false);setPomodoroPhase("work");setPomodoroSecs(pomodoroWorkMins*60);}
  // Changing a length only moves the timer if it's sitting untouched at the
  // start of that phase -- a paused session keeps its remaining time.
  function changePomodoroLength(phase:"work"|"break",mins:number){
    const cur=phase==="work"?pomodoroWorkMins:pomodoroBreakMins;
    if(!pomodoroActive&&pomodoroPhase===phase&&pomodoroSecs===cur*60)setPomodoroSecs(mins*60);
    (phase==="work"?setPomodoroWorkMins:setPomodoroBreakMins)(mins);
  }

  const visibleTasks=tasks;
  // Every tag used on any task, deduplicated -- powers the "quick add" suggestion
  // chips in TaskModal's tag editor instead of retyping tags you've already used.
  const allTags=[...new Set(tasks.flatMap(t=>t.tags||[]))].sort();
  // Pending tasks sort by their manual drag order; done tasks always sink to the
  // bottom -- except ones in justDone, which stay put until they settle.
  const allSorted=[...visibleTasks].sort((a,b)=>{
    const ad=a.done&&!justDone.includes(a.id), bd=b.done&&!justDone.includes(b.id);
    if(ad!==bd)return ad?1:-1;
    return a.order-b.order;
  });
  const filteredTasks=allSorted.filter(t=>{
    if(filter==="archived")return !!t.archived;
    if(t.archived)return false; // archived tasks never show in all/pending/done, only the dedicated view
    if(filter==="done")return t.done;
    if(filter==="pending")return !t.done||justDone.includes(t.id);
    if(filter==="noest")return !t.done&&!t.estMins; // from the "Time left" dropdown; not a chip
    return showDone||!t.done||justDone.includes(t.id);
  });
  const topTask=allSorted.find(t=>!t.done&&!t.archived);
  const focusTask=tasks.find(t=>t.id===focusTaskId&&!t.done&&!t.archived)||topTask;
  useEffect(()=>{pomodoroTaskRef.current=focusTask?.id??null;});
  // What to do when a break ends: keep going on the task from the last session
  // if it's still open, otherwise the most urgent open task.
  const nextSuggestion=tasks.find(t=>t.id===lastWorkedTaskId&&!t.done&&!t.archived)||mostUrgent(tasks.filter(t=>!t.done&&!t.archived));
  const suggestionIsContinue=nextSuggestion!=null&&nextSuggestion.id===lastWorkedTaskId;
  useEffect(()=>{nextSuggestionRef.current=nextSuggestion?.title??null;});
  function startSuggested(){
    if(!nextSuggestion)return;
    setFocusTaskId(nextSuggestion.id);setBreakEnded(false);setFocusPickerOpen(false);
    setPomodoroPhase("work");setPomodoroSecs(pomodoroWorkMins*60);setPomodoroActive(true);
    if(!focusMode)setFocusModeAnimated(true);
  }
  // Keep the screen on in Focus Mode (Screen Wake Lock API, where supported).
  // The browser drops the lock whenever the tab is hidden, so it's re-taken
  // when the tab comes back.
  useEffect(()=>{
    if(!focusMode||!("wakeLock" in navigator))return;
    let lock:WakeLockSentinel|null=null; let cancelled=false;
    const acquire=()=>{navigator.wakeLock.request("screen").then(l=>{if(cancelled)l.release().catch(()=>{});else lock=l;}).catch(()=>{});};
    acquire();
    const onVisible=()=>{if(document.visibilityState==="visible")acquire();};
    document.addEventListener("visibilitychange",onVisible);
    return()=>{cancelled=true;document.removeEventListener("visibilitychange",onVisible);lock?.release().catch(()=>{});};
  },[focusMode]);
  const openTasks=visibleTasks.filter(t=>!t.done&&!t.archived);
  const totalMins=openTasks.reduce((s,t)=>s+(t.estMins||0),0);
  // Per-subject split of totalMins for the header's "time left" popover, largest
  // first; tasks with no subject are pooled under "" (shown as "No subject").
  // `spent` is real time logged by the task timer on those same open tasks.
  const timeBySubject=(()=>{
    const m:Record<string,{mins:number;spent:number}>={};
    openTasks.forEach(t=>{const e=m[t.subject||""]||={mins:0,spent:0};e.mins+=t.estMins||0;e.spent+=(t.sessions||[]).reduce((a,x)=>a+x.mins,0);});
    return Object.entries(m).filter(([,e])=>e.mins>0).sort((a,b)=>b[1].mins-a[1].mins).map(([name,e])=>({name,...e,pct:totalMins?Math.round(e.mins/totalMins*100):0}));
  })();
  // Same open tasks split by when they're due (empty buckets dropped).
  const timeByDue=(()=>{
    const today=localDateStr(new Date(now));
    return DUE_BUCKETS.map(b=>{const ts=openTasks.filter(t=>dueBucket(t.dueDate,today)===b.key);return {...b,count:ts.length,mins:ts.reduce((s,t)=>s+(t.estMins||0),0)};}).filter(b=>b.count>0);
  })();
  // Open tasks with no estimate count as 0 above, so the total reads low.
  const noEstimateCount=openTasks.filter(t=>!t.estMins).length;
  const fmtMins=(m:number)=>formatDuration(m)||"0m";
  // One line for the title menu: where this device's changes stand.
  const syncStatus=!fbUser?null
    :!online?"Offline. Changes will sync when you're back online"
    :hasPendingWrites?"Saving..."
    :lastSyncedAt?`Synced ${formatAgo(lastSyncedAt,now)}`
    :"Connecting...";

  // Inbox messages: a recap is written when a day, week, month or year ends
  // (src/lib/recaps.ts), from whatever was finished or worked on in it. They
  // are snapshots kept on this device ("hw-recaps"); recapsChecked is the last
  // date this ran, so each period is only written once, even if dismissed.
  // Waits for the first sync when signed in, so a recap isn't written from a
  // half-loaded list. Archived tasks count: archiving doesn't erase history.
  const [recaps,setRecaps]=usePersistedState<Recap[]>("hw-recaps",[]);
  const [recapsChecked,setRecapsChecked]=usePersistedState<string|null>("hw-recaps-checked",null);
  const todayStr=localDateStr(new Date(now));
  const tasksLoaded=!authPending&&(!fbUser||tasksSyncedForUid===fbUser.uid);
  useEffect(()=>{
    if(!tasksLoaded||recapsChecked===todayStr)return;
    const fresh=newRecaps(tasks,recapsChecked,todayStr,weekStart);
    if(fresh.length)setRecaps(prev=>mergeRecaps(prev,fresh));
    setRecapsChecked(todayStr);
  },[tasksLoaded,recapsChecked,todayStr,tasks,weekStart,setRecaps,setRecapsChecked]);
  const recapItems:WhatsNewItem[]=recaps.map(recapMessage);
  const unreadRecaps=recaps.filter(r=>!r.read).map(r=>r.id);
  // Opening a message (or stepping to it with Back/Next) marks it read.
  function openMessage(id:string,origin:HTMLElement|null){
    setOpenUpdate({id,origin});
    if(unreadRecaps.includes(id))setRecaps(prev=>prev.map(r=>r.id===id?{...r,read:true}:r));
  }
  function dismissMessage(id:string){
    if(id.startsWith("recap-"))setRecaps(prev=>prev.filter(r=>r.id!==id));
    else dismissWhatsNew(id);
  }

  function startAdding(){
    setAdding(true);setStep(-1);
    // 30 minutes is only the estimate picker's starting point; with that
    // question turned off, the task gets no estimate.
    setNewTask({title:"",subject:"",dueDate:"",dueTime:"",estMins:askQuestions.some(q=>q.type==="time")?30:0});
    setPendingDueDate(null);
    setTimeHours(0);setTimeMins(30);
    setUsingTemplate(false);setTemplateSubtasks(null);
    inputValRef.current="";
    if(inputRef.current) inputRef.current.value="";
  }
  // Skips straight to the due-date question (wherever it is in the user's
  // order), since everything else a template covers (subject/estimate/
  // recurrence/subtasks) is already decided -- confirmDueTime and finishTask
  // below check usingTemplate/templateSubtasks to finish immediately after the
  // date instead of asking the remaining questions. With the due-date question
  // turned off, the task is added straight away.
  function startFromTemplate(tpl:TaskTemplate){
    const task={title:tpl.name,subject:tpl.subject,dueDate:"",dueTime:"",estMins:tpl.estMins,recurrence:tpl.recurrence};
    const dateStep=askQuestions.findIndex(q=>q.type==="date");
    if(dateStep<0){finishTask(task as Task,tpl.subtasks||null);return;}
    setAdding(true);
    setNewTask(task);
    setPendingDueDate(null);
    setUsingTemplate(true);setTemplateSubtasks(tpl.subtasks||null);
    setStep(dateStep);
  }
  function handleTitleSubmit(e:React.FormEvent){
    e.preventDefault();
    const val=inputRef.current?.value||"";
    if(!val.trim())return;
    const updated={...newTask,title:val.trim()};
    setNewTask(updated);
    inputValRef.current="";
    if(inputRef.current) inputRef.current.value="";
    // Every question turned off in Settings: the title is all there is to ask.
    if(askQuestions.length===0){finishTask(updated as Task);return;}
    setStep(0);
  }
  // A wizard answer advances after a 100ms beat; this ignores a second tap in
  // that window, which could otherwise add the task twice or skip a question.
  const wizardAdvancing=useRef(false);
  function afterBeat(fn:()=>void){
    wizardAdvancing.current=true;
    setTimeout(()=>{wizardAdvancing.current=false;fn();},100);
  }
  function handleAnswer(val:string){
    if(wizardAdvancing.current)return;
    const q=askQuestions[step];
    const value = q.type==="time" ? parseInt(val) : val;
    const updated={...newTask,[q.key]:value};setNewTask(updated);
    inputValRef.current="";
    if(inputRef.current) inputRef.current.value="";
    afterBeat(()=>{if(step<askQuestions.length-1){setStep(s=>s+1);}else finishTask(updated as Task);});
  }
  function goBackStep(){
    if(askQuestions[step]?.type==="date"&&pendingDueDate!==null){setPendingDueDate(null);return;}
    if(step>-1)setStep(s=>s-1);
  }
  function goForwardStep(){
    if(wizardAdvancing.current)return;
    if(askQuestions[step]?.type==="date"&&pendingDueDate!==null){confirmDueTime("");return;}
    // Skipping leaves that answer blank -- for the estimate that means 0 (shown
    // as no estimate), not the wizard's hidden 30-minute starting value.
    const updated=askQuestions[step]?.type==="time"?{...newTask,estMins:0}:newTask;
    if(updated!==newTask)setNewTask(updated);
    // A template already answered everything after the date (see confirmDueTime).
    if(usingTemplate&&askQuestions[step]?.type==="date"){finishTask(updated as Task);return;}
    if(step<askQuestions.length-1){setStep(s=>s+1);}else finishTask(updated as Task);
  }
  function handleDateInput(val:string){
    setPendingDueDate(val);
    inputValRef.current="";
    if(inputRef.current) inputRef.current.value="";
  }
  function confirmDueTime(time:string){
    if(wizardAdvancing.current)return;
    const updated={...newTask,dueDate:pendingDueDate||"",dueTime:time};setNewTask(updated);
    setPendingDueDate(null);
    inputValRef.current="";
    if(inputRef.current) inputRef.current.value="";
    if(usingTemplate){
      afterBeat(()=>finishTask(updated as Task));
    } else {
      afterBeat(()=>{if(step<askQuestions.length-1){setStep(s=>s+1);}else finishTask(updated as Task);});
    }
  }
  function finishTask(task:Task,tplSubtasks:{text:string}[]|null=templateSubtasks){
    const subtasks=tplSubtasks?tplSubtasks.map(s=>({id:String(nextId()),text:s.text,done:false})):undefined;
    captureTaskRects();
    setTasks(prev=>[...prev,{...task,id:nextId(),done:false,order:nextOrder(prev),...(subtasks?{subtasks}:{})}]);
    setAdding(false);setStep(0);
    setUsingTemplate(false);setTemplateSubtasks(null);
  }
  // Where each task card is (every layout marks its cards with data-task-id),
  // for animating the list from its old arrangement to the new one (FLIP: the
  // layout effect below plays the difference). Call it right before the state
  // change. The motion depends on what happened:
  // - "settle": a task just completed glides to the done tasks (toggleDone).
  // - "shift": filter, search, add, delete, undo, bulk actions -- a brisk move.
  // - "quick": keyboard reordering, where a long glide would lag the arrow keys.
  // Cards on screen are also cloned, so one that leaves can fade out as a
  // stand-in after React has removed the real one.
  type GlideMode="settle"|"shift"|"quick";
  const taskRectsBefore=useRef<{rects:Map<string,{x:number;y:number;w:number;h:number;clone:HTMLElement|null}>;mode:GlideMode;at:number}|null>(null);
  // Stand-ins still fading out, by task id, so a task that comes straight back
  // (e.g. search typed then erased) doesn't show twice.
  const taskGhosts=useRef(new Map<string,HTMLElement>());
  function captureTaskRects(mode:GlideMode="shift"){
    if(window.matchMedia("(prefers-reduced-motion: reduce)").matches)return;
    const rects=new Map<string,{x:number;y:number;w:number;h:number;clone:HTMLElement|null}>();
    const vh=window.innerHeight;
    document.querySelectorAll<HTMLElement>("[data-task-id]").forEach(el=>{
      const r=el.getBoundingClientRect();
      const onScreen=r.bottom>0&&r.top<vh&&r.width>0;
      rects.set(el.dataset.taskId!,{x:r.left,y:r.top,w:r.width,h:r.height,clone:onScreen?el.cloneNode(true) as HTMLElement:null});
    });
    taskRectsBefore.current={rects,mode,at:glideClock()};
  }
  function toggleDone(id:number){
    const task=tasks.find(t=>t.id===id);
    if(!task)return;
    changeTasks(prev=>setDone(prev,[id],!task.done),`${task.done?"uncheck":"complete"} "${task.title}"`,
      task.done?`"${task.title}" marked not done`:`"${task.title}" completed`);
    // Completing: the card holds its place while the check draws in and the
    // title strikes through, then glides down to the done tasks. Unchecking
    // glides it straight back up. Reduced motion skips all of it. (After
    // changeTasks, so this capture replaces its "shift" one.)
    if(!window.matchMedia("(prefers-reduced-motion: reduce)").matches){
      if(!task.done){
        setJustDone(prev=>[...prev,id]);
        setTimeout(()=>{captureTaskRects("settle");setJustDone(prev=>prev.filter(x=>x!==id));},scaledMs(640));
      }else{
        setJustDone(prev=>prev.filter(x=>x!==id));
        captureTaskRects("settle");
      }
    }
  }
  useLayoutEffect(()=>{
    const before=taskRectsBefore.current;
    if(!before)return;
    taskRectsBefore.current=null;
    // A capture whose change never rendered (e.g. picking the filter already
    // selected) mustn't animate some later, unrelated render from stale spots.
    if(glideClock()-before.at>1000)return;
    const {mode}=before;
    const vh=window.innerHeight;
    const cards=[...document.querySelectorAll<HTMLElement>("[data-task-id]")];
    // Stop any glide still running first, or its offset would skew the new
    // measurement (the "before" positions already include it, so nothing jumps).
    cards.forEach(el=>el.getAnimations().forEach(a=>{if(a instanceof CSSAnimation||a instanceof CSSTransition)return;a.cancel();}));
    const present=new Set<string>();
    const moves:{el:HTMLElement;dx:number;dy:number}[]=[];
    const enters:HTMLElement[]=[];
    for(const el of cards){
      const id=el.dataset.taskId!;
      present.add(id);
      taskGhosts.current.get(id)?.remove();
      const r=el.getBoundingClientRect();
      const was=before.rects.get(id);
      const onScreenNow=r.bottom>0&&r.top<vh;
      if(!was){if(onScreenNow)enters.push(el);continue;}
      const dx=was.x-r.left, dy=was.y-r.top;
      // Off screen both before and after: nothing anyone would see.
      if(!onScreenNow&&!(was.y+was.h>0&&was.y<vh))continue;
      if(Math.abs(dx)>=1||Math.abs(dy)>=1)moves.push({el,dx,dy});
    }
    // Cards that left: a stand-in copy fades out where the card was.
    for(const [id,was] of before.rects){
      if(present.has(id)||!was.clone)continue;
      const g=was.clone;
      g.removeAttribute("data-task-id");
      g.setAttribute("aria-hidden","true");
      g.inert=true;
      Object.assign(g.style,{position:"fixed",left:`${was.x}px`,top:`${was.y}px`,width:`${was.w}px`,height:`${was.h}px`,margin:"0",pointerEvents:"none",zIndex:"2",transition:"none"});
      document.body.appendChild(g);
      taskGhosts.current.get(id)?.remove();
      taskGhosts.current.set(id,g);
      const anim=g.animate([{opacity:1,transform:"scale(1)"},{opacity:0,transform:"scale(.96)"}],{duration:mode==="settle"?270:200,easing:"ease-in",fill:"forwards"});
      const done=()=>{g.remove();if(taskGhosts.current.get(id)===g)taskGhosts.current.delete(id);};
      anim.finished.then(done,done);
    }
    // New arrivals fade and rise in, a beat after the others start making room,
    // in a quick cascade down the list.
    enters.forEach((el,i)=>{
      el.animate([{opacity:0,transform:"translateY(8px) scale(.98)"},{opacity:1,transform:"none"}],
        {duration:280,delay:80+Math.min(i,8)*30,easing:"cubic-bezier(.2,.8,.3,1)",fill:"backwards"});
    });
    const farthest=Math.max(0,...moves.map(m=>Math.hypot(m.dx,m.dy)));
    for(const {el,dx,dy} of moves){
      const from=`translate(${dx}px,${dy}px)`;
      if(mode==="quick"){
        el.animate([{transform:from},{transform:"none"}],{duration:320,easing:"cubic-bezier(.2,.8,.3,1)"});
        continue;
      }
      const dist=Math.hypot(dx,dy);
      if(mode==="shift"){
        el.animate([{transform:from},{transform:"none"}],{duration:Math.min(520,340+dist*0.25),easing:"cubic-bezier(.25,.8,.3,1)"});
        continue;
      }
      // "settle": the card that travels farthest (the one just completed) is
      // the star: it lifts slightly, slides the whole way down at an even pace
      // over about 1.3-1.8s, and sets down softly, riding above the cards it
      // passes. The others just make room, quicker and without the lift.
      const lead=dist===farthest&&moves.length>1;
      if(lead){
        const duration=Math.min(1800,1100+dist*0.95);
        el.style.zIndex="3";
        const anim=el.animate([
          {transform:`${from} scale(1)`,easing:"cubic-bezier(.3,0,.2,1)"},
          {transform:`translate(${dx*0.92}px,${dy*0.92}px) scale(1.025)`,offset:0.1,easing:"cubic-bezier(.45,0,.25,1)"},
          {transform:"translate(0,0) scale(1.025)",offset:0.9,easing:"cubic-bezier(.3,0,.2,1)"},
          {transform:"translate(0,0) scale(1)"},
        ],{duration});
        const done=()=>{el.style.zIndex="";};
        anim.finished.then(done,done);
      }else{
        el.animate([{transform:from},{transform:"none"}],{duration:Math.min(1020,600+dist*0.68),easing:"cubic-bezier(.45,0,.2,1)"});
      }
    }
  });
  // Every delete path (single, bulk, "clear completed") goes through here, so
  // they're all undoable the same way instead of some being permanent.
  function deleteTasks(ids:number[]){
    const removed=tasks.filter(t=>ids.includes(t.id));
    if(removed.length===0)return;
    captureTaskRects();
    setTasks(prev=>prev.filter(t=>!ids.includes(t.id)));
    addToTrash(removed);
    pushUndoable({type:"delete",tasks:removed},removed.length===1?`"${removed[0].title}" deleted`:`${removed.length} tasks deleted`);
  }
  function deleteTask(id:number){ deleteTasks([id]); }
  // Records an already-applied action in the history and shows the undo toast.
  function pushUndoable(action:HistoryAction,toast:string){
    setUndoStack(prev=>[...prev,action]);
    setRedoStack([]);
    setUndoToast(toast);
    clearTimeout(undoToastTimer.current);
    undoToastTimer.current=setTimeout(()=>setUndoToast(null),5000);
  }
  // Applies a change to the task list and records it in the undo history.
  function changeTasks(fn:(prev:Task[])=>Task[],label:string,toast:string){
    const next=fn(tasks);
    const {before,after}=diffTasks(tasks,next);
    if(before.length===0)return;
    captureTaskRects();
    setTasks(next);
    pushUndoable({type:"change",before,after,label},toast);
  }
  const plural=(n:number)=>`${n} ${n===1?"task":"tasks"}`;
  // "No quiz this week": moves a repeating task to its next occurrence without
  // marking it done (so no completion is recorded and nothing new is spawned).
  function skipOccurrence(id:number){
    const task=tasks.find(t=>t.id===id);
    if(!task||!task.recurrence||task.recurrence==="none")return;
    const after={dueDate:advanceDate(task.dueDate||todayISO(),task.recurrence)};
    changeTasks(prev=>prev.map(t=>t.id===id?{...t,...after}:t),`skip "${task.title}"`,
      `"${task.title}" skipped to ${formatDate(after.dueDate)}`);
  }
  function snoozeTask(id:number,kind:SnoozeKind){
    const task=tasks.find(t=>t.id===id);
    if(!task)return;
    const target=snoozeTarget(kind);
    const after={dueDate:target.dueDate,dueTime:target.dueTime??task.dueTime};
    changeTasks(prev=>prev.map(t=>t.id===id?{...t,...after}:t),`snooze "${task.title}"`,
      `"${task.title}" snoozed to ${formatDate(after.dueDate)}${after.dueTime?` ${formatTime(after.dueTime,h24)}`:""}`);
  }
  // Each action type's reversal lives in its branch here.
  function undo(){
    if(undoStack.length===0)return;
    const action=undoStack[undoStack.length-1];
    captureTaskRects();
    if(action.type==="delete"){
      setTasks(prev=>{const have=new Set(prev.map(t=>t.id));return [...prev,...action.tasks.filter(t=>!have.has(t.id))];});
      removeFromTrash(action.tasks.map(t=>t.id));
    }
    if(action.type==="change")setTasks(prev=>applyTaskStates(prev,action.before));
    setUndoStack(prev=>prev.slice(0,-1));
    setRedoStack(prev=>[...prev,action]);
    setUndoToast(null);
  }
  function redo(){
    if(redoStack.length===0)return;
    const action=redoStack[redoStack.length-1];
    captureTaskRects();
    if(action.type==="delete"){const ids=new Set(action.tasks.map(t=>t.id));setTasks(prev=>prev.filter(t=>!ids.has(t.id)));addToTrash(action.tasks);}
    if(action.type==="change")setTasks(prev=>applyTaskStates(prev,action.after));
    setRedoStack(prev=>prev.slice(0,-1));
    setUndoStack(prev=>[...prev,action]);
  }
  const describeAction=(action:HistoryAction)=>action.type==="change"?action.label
    :`delete ${action.tasks.length===1?`"${action.tasks[0].title}"`:`${action.tasks.length} tasks`}`;
  function updateSubtasks(id:number,subtasks:Subtask[]){
    setTasks(prev=>prev.map(t=>t.id===id?{...t,subtasks}:t));
  }
  function setPriorityOverride(id:number,override:Priority|null){
    setTasks(prev=>prev.map(t=>t.id===id?{...t,priorityOverride:override??undefined}:t));
  }
  function setTaskTags(id:number,tags:string[]){
    setTasks(prev=>prev.map(t=>t.id===id?{...t,tags}:t));
  }
  // A fresh copy: not done, no logged sessions, subtasks unchecked, and not
  // linked to the original's repeat chain.
  function duplicateTask(id:number):Task|null{
    const src=tasks.find(t=>t.id===id);
    if(!src)return null;
    const copy:Task={...src,id:nextId(),done:false,completedAt:null,archived:false,spawnedNextId:null,sessions:[],
      order:nextOrder(tasks),...(src.subtasks?{subtasks:src.subtasks.map(s=>({...s,id:String(nextId()),done:false}))}:{})};
    captureTaskRects();
    setTasks(prev=>[...prev,copy]);
    return copy;
  }
  function archiveTask(id:number){
    const task=tasks.find(t=>t.id===id);
    if(!task)return;
    changeTasks(prev=>prev.map(t=>t.id===id?{...t,archived:true}:t),`archive "${task.title}"`,`"${task.title}" archived`);
  }
  function unarchiveTask(id:number){
    const task=tasks.find(t=>t.id===id);
    if(!task)return;
    changeTasks(prev=>prev.map(t=>t.id===id?{...t,archived:false}:t),`restore "${task.title}"`,`"${task.title}" restored`);
  }
  // The task detail's Edit panel.
  function editTask(id:number,patch:Partial<Task>){
    const task=tasks.find(t=>t.id===id);
    if(!task)return;
    changeTasks(prev=>prev.map(t=>t.id===id?{...t,...patch}:t),`edit "${task.title}"`,`"${patch.title??task.title}" updated`);
  }
  function bulkMarkDone(ids:number[]){
    changeTasks(prev=>setDone(prev,ids,true),`complete ${plural(ids.length)}`,`${plural(ids.length)} completed`);
    exitSelectionMode();
  }
  function bulkArchive(ids:number[]){
    changeTasks(prev=>prev.map(t=>ids.includes(t.id)?{...t,archived:true}:t),`archive ${plural(ids.length)}`,`${plural(ids.length)} archived`);
    exitSelectionMode();
  }
  function bulkDelete(ids:number[]){
    deleteTasks(ids);
    exitSelectionMode();
  }
  function bulkSetDue(ids:number[],dueDate:string){
    // Keeps each task's own due time; clearing the date clears the time too
    // (a time with no date means nothing), same as the Edit panel.
    changeTasks(prev=>prev.map(t=>ids.includes(t.id)?{...t,dueDate,dueTime:dueDate?t.dueTime:""}:t),
      `set the due date of ${plural(ids.length)}`,dueDate?`${plural(ids.length)} due ${formatDate(dueDate)}`:`Due date cleared on ${plural(ids.length)}`);
    exitSelectionMode();
  }
  function bulkSetPriority(ids:number[],p:Priority|null){
    changeTasks(prev=>prev.map(t=>ids.includes(t.id)?{...t,priorityOverride:p??undefined}:t),
      `set the priority of ${plural(ids.length)}`,p?`${plural(ids.length)} set to ${p} priority`:`${plural(ids.length)} back to automatic priority`);
    exitSelectionMode();
  }
  function bulkSetSubject(ids:number[],subject:string){
    changeTasks(prev=>prev.map(t=>ids.includes(t.id)?{...t,subject}:t),`move ${plural(ids.length)} to ${subject||"no subject"}`,`${plural(ids.length)} moved to ${subject||"no subject"}`);
    exitSelectionMode();
  }
  function exportAllDataJSON(){
    const data={
      exportedAt:new Date().toISOString(),
      tasks,subjects,subjectColors,templates,
      settings:{themeMode,layout,groupBy,desktopLayout,colorCodeUrgency,liquidGlass,showDone,showSuggestion,autoArchiveDays,notificationsEnabled,enabledOffsets,timeFormat,weekStart,pomodoroWorkMins,pomodoroBreakMins,autoStartBreaks},
    };
    downloadFile(`dueplanner-export-${todayISO()}.json`,JSON.stringify(data,null,2),"application/json");
  }
  // Restores an "Export all (JSON)" file. Merges rather than replaces: tasks
  // already here (same id) are left alone, subjects and templates are added
  // if missing, and existing subject colors win. Settings aren't touched.
  const importFileRef=useRef<HTMLInputElement>(null);
  const [importBackupNote,setImportBackupNote]=useState<string|null>(null);
  async function importBackupJSON(file:File){
    try{
      const data=JSON.parse(await file.text());
      const raw:unknown[]=Array.isArray(data?.tasks)?data.tasks:[];
      const incoming:Task[]=raw.filter((t):t is Task=>!!t&&typeof (t as Task).id==="number"&&typeof (t as Task).title==="string")
        // Brought inside the limits firestore.rules enforces, or a hand-edited
        // backup could save locally but never sync.
        .map(t=>sanitizeTask(t as unknown as Record<string,unknown>) as unknown as Task);
      if(incoming.length===0&&!Array.isArray(data?.subjects)){
        setImportBackupNote("That file doesn't look like a DuePlanner export.");
        return;
      }
      const have=new Set(tasks.map(t=>t.id));
      const base=nextOrder(tasks);
      const fresh=incoming.filter(t=>!have.has(t.id)).map((t,i)=>({...t,order:base+i}));
      if(fresh.length)setTasks(prev=>[...prev,...fresh]);
      if(Array.isArray(data?.subjects)){
        const extra=(data.subjects as unknown[]).filter((s):s is string=>typeof s==="string"&&!subjects.some(x=>x.toLowerCase()===s.toLowerCase()));
        if(extra.length)setSubjects(prev=>[...prev,...extra.map(x=>x.slice(0,LIMITS.subject))].slice(0,LIMITS.subjects));
      }
      if(data?.subjectColors&&typeof data.subjectColors==="object"){
        const cols=Object.fromEntries(Object.entries(data.subjectColors).filter(([,v])=>typeof v==="string")) as Record<string,string>;
        // Existing colors win; the map stays within the profile doc's cap.
        setSubjectColors(prev=>Object.fromEntries(Object.entries({...prev,...Object.fromEntries(Object.entries(cols).filter(([k])=>!(k in prev)))}).slice(0,LIMITS.subjects)));
      }
      if(Array.isArray(data?.templates)){
        setTemplates(prev=>{
          const ids=new Set(prev.map(t=>t.id));
          return [...prev,...(data.templates as TaskTemplate[]).filter(t=>t&&typeof t.id==="string"&&typeof t.name==="string"&&!ids.has(t.id))];
        });
      }
      const skipped=incoming.length-fresh.length;
      setImportBackupNote(`Imported ${fresh.length} task${fresh.length===1?"":"s"}${skipped?` (${skipped} already here)`:""}.`);
    }catch{
      setImportBackupNote("Couldn't read that file. Pick a .json file from \"Export all (JSON)\".");
    }
  }
  function exportTasksCSV(){
    const headers=["title","subject","dueDate","dueTime","estMins","done","priority","tags","recurrence"];
    const rows=tasks.map(t=>[
      t.title,t.subject,t.dueDate,t.dueTime,t.estMins,t.done?"yes":"no",
      getPriority(t.dueDate,t.estMins,t.priorityOverride),
      (t.tags||[]).join("; "),t.recurrence||"none",
    ].map(csvField).join(","));
    downloadFile(`dueplanner-tasks-${todayISO()}.csv`,[headers.join(","),...rows].join("\n"),"text/csv");
  }

  // Drag-to-reorder: pointer capture keeps move/up events on the handle even as
  // the finger/cursor leaves it, so no window-level listeners are needed. While
  // dragging, whichever pending card the pointer is currently over gets swapped
  // with the dragged one, live, by reassigning their `order` values.
  function startDrag(id:number,e:React.PointerEvent){
    dragOrderIds.current=allSorted.filter(t=>!t.done).map(t=>t.id);
    dragStartY.current=e.clientY;
    setDragTaskId(id);
    setDragOffsetY(0);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onDragMove(e:React.PointerEvent){
    if(dragTaskId==null)return;
    setDragOffsetY(e.clientY-dragStartY.current);
    const el=document.elementFromPoint(e.clientX,e.clientY) as HTMLElement|null;
    const cardEl=el?.closest("[data-task-id]") as HTMLElement|null;
    if(!cardEl)return;
    const overId=Number(cardEl.dataset.taskId);
    if(!overId||overId===dragTaskId)return;
    const ids=dragOrderIds.current;
    const from=ids.indexOf(dragTaskId), to=ids.indexOf(overId);
    if(from===-1||to===-1||from===to)return;
    const next=[...ids];
    next.splice(from,1);
    next.splice(to,0,dragTaskId);
    dragOrderIds.current=next;
    const orderMap=new Map(next.map((tid,idx)=>[tid,idx]));
    setTasks(prev=>prev.map(t=>orderMap.has(t.id)?{...t,order:orderMap.get(t.id)!}:t));
    dragStartY.current=e.clientY;
    setDragOffsetY(0);
  }
  function endDrag(){setDragTaskId(null);setDragOffsetY(0);}
  // Keyboard reordering (arrow keys on a card's handle): moves the task one
  // place among the pending tasks, glides the cards like completing does, keeps
  // focus on the handle, and says where it landed.
  function moveTaskBy(id:number,delta:number){
    const ids=allSorted.filter(t=>!t.done).map(t=>t.id);
    const from=ids.indexOf(id), to=from+delta;
    if(from===-1||to<0||to>=ids.length)return;
    ids.splice(from,1); ids.splice(to,0,id);
    const orderMap=new Map(ids.map((tid,idx)=>[tid,idx]));
    captureTaskRects("quick");
    setTasks(prev=>prev.map(t=>orderMap.has(t.id)?{...t,order:orderMap.get(t.id)!}:t));
    setSrMessage(`Moved to position ${to+1} of ${ids.length}`);
    requestAnimationFrame(()=>document.querySelector<HTMLElement>(`[data-task-id="${id}"] [data-reorder]`)?.focus());
  }

  // Tracks which row a pointer is currently down on, purely via refs, so a plain
  // tap causes zero state updates -- MiniCard is a nested component (recreated
  // every parent render), so a setState on pointerdown would remount the pressed
  // row mid-gesture and silently swallow the browser's native click event. State
  // (swipeId/swipeX) only gets touched once a gesture actually locks in as a swipe.
  const swipeActiveId=useRef<number|null>(null);
  function onSwipeStart(id:number,e:React.PointerEvent){
    swipeActiveId.current=id;
    swipeStart.current={x:e.clientX,y:e.clientY};
    swipeLocked.current=false;
    swipeMoved.current=false;
  }
  function onSwipeMove(id:number,e:React.PointerEvent){
    if(swipeActiveId.current!==id)return;
    const dx=e.clientX-swipeStart.current.x;
    const dy=e.clientY-swipeStart.current.y;
    if(!swipeLocked.current){
      if(Math.abs(dx)>8&&Math.abs(dx)>Math.abs(dy)*1.5){
        swipeLocked.current=true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setSwipeId(id);
      } else if(Math.abs(dy)>8){
        swipeActiveId.current=null; // vertical intent -- let the page scroll instead
        return;
      } else return;
    }
    swipeMoved.current=true;
    setSwipeX(Math.max(-140,Math.min(140,dx)));
  }
  function onSwipeEnd(id:number){
    if(swipeActiveId.current!==id)return;
    swipeActiveId.current=null;
    const wasLocked=swipeLocked.current;
    swipeLocked.current=false;
    if(!wasLocked)return;
    const dx=swipeX;
    setSwipeId(null);
    setSwipeX(0);
    if(dx<=-SWIPE_THRESHOLD)deleteTask(id);
    else if(dx>=SWIPE_THRESHOLD)toggleDone(id);
  }
  function onSwipeCancel(id:number){
    if(swipeActiveId.current!==id)return;
    swipeActiveId.current=null;
    const wasLocked=swipeLocked.current;
    swipeLocked.current=false;
    // Always clear this, even if not locked -- otherwise a swipe that locked in
    // and then got interrupted (pointercancel) leaves it stuck true, silently
    // swallowing the user's very next tap anywhere in the swipeable list.
    swipeMoved.current=false;
    if(!wasLocked)return;
    setSwipeId(null);
    setSwipeX(0);
  }
  function swipeHandlers(id:number){
    return {
      onPointerDown:(e:React.PointerEvent)=>onSwipeStart(id,e),
      onPointerMove:(e:React.PointerEvent)=>onSwipeMove(id,e),
      onPointerUp:()=>onSwipeEnd(id),
      onPointerCancel:()=>onSwipeCancel(id),
    };
  }
  function swipeContentStyle(id:number):React.CSSProperties{
    const active=swipeId===id;
    const dx=active?swipeX:0;
    return {transform:dx?`translateX(${dx}px)`:undefined,transition:active?"none":"transform 0.25s cubic-bezier(.34,1.4,.64,1)",touchAction:"pan-y"};
  }
  function swipeClickGuard(onOpen:()=>void){
    return ()=>{ if(swipeMoved.current){swipeMoved.current=false;return;} onOpen(); };
  }
  function renderSwipeReveal(id:number){
    if(swipeId!==id||swipeX===0)return null;
    const isRight=swipeX>0;
    const done=tasks.find(t=>t.id===id)?.done;
    return <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:isRight?"flex-start":"flex-end",padding:"0 20px",background:isRight?"#2ED57333":"#FF475733",pointerEvents:"none"}}>
      <span style={{fontFamily:F.body,fontSize:13,fontWeight:600,color:isRight?"#2ED573":"#FF4757"}}>{isRight?(done?"↩ Mark not done":"✓ Mark done"):"Delete"}</span>
    </div>;
  }
  const currentQ=step>=0?askQuestions[step]:null;

  const F = FONT;

  // Memoized on the actual primitives used below (not on T/F themselves --
  // those are fresh object literals every render) so this multi-hundred-line
  // stylesheet string, injected via <style>{css}</style>, only gets rebuilt
  // (and reparsed by the browser) when the theme or font actually changes,
  // not on every task edit or other unrelated render.
  // Glass cards that get the cursor highlight, matched by their inline border
  // the same way as the other glass rules in the css below.
  const glassCardSel=`[style*="border: 1px solid ${T.border.replace(/,/g,", ")}"][style*="border-radius"]:not([style*="gradient"])`;
  const css=useMemo(()=>`
    @import url('https://fonts.googleapis.com/css2?family=${F.google}&display=swap');
    *{box-sizing:border-box;}
    /* Form controls don't inherit the page font by default -- without this, any
       button/input without an explicit fontFamily fell back to the system font. */
    button,input,select,textarea{font-family:inherit;}
    body{margin:0;background:${T.bg};transition:background 0.4s;font-family:${F.body};}
    html{background:${T.bg};}
    .app-shell{min-height:100svh;min-height:100dvh;}
    .tc{transition:all 0.22s cubic-bezier(.34,1.2,.64,1);}
    /* Hover effects only where there's a real hover (mouse/trackpad) -- on touch
       screens :hover sticks after a tap, leaving cards stuck "lifted". */
    @media (hover:hover){
      .tc:hover{transform:translateY(-2px);filter:brightness(1.05);}
      .chip:hover{transform:scale(1.05);filter:brightness(1.1);}
    }
    .pop{animation:pop 0.28s cubic-bezier(.34,1.4,.64,1) forwards;}
    @keyframes pop{from{opacity:0;transform:translateY(8px) scale(.97)}to{opacity:1;transform:none}}
    .search-pop{animation:pop .3s cubic-bezier(.2,.8,.3,1) backwards;}
    .sec-body{animation:secIn .2s ease-out;}
    @keyframes secIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
    .clamp2{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
    /* iOS zooms the page into any focused field under 16px. */
    @media (pointer:coarse){.edit-field{font-size:16px!important;}}
    .sli{animation:sli 0.22s ease forwards;}
    @keyframes sli{from{opacity:0;transform:translateX(-5px)}to{opacity:1;transform:none}}
    .chip{cursor:pointer;border:none;border-radius:999px;padding:7px 15px;font-family:'DM Mono',monospace;font-size:12px;transition:all 0.13s;}
    .chip:active{transform:scale(.97);}
    input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.6);}
    /* Keyboard focus ring. !important so it also beats the inline
       outline:none on inputs -- :focus-visible only matches keyboard focus
       (and text fields), so mouse and touch users don't see it on click. */
    :focus-visible{outline:2px solid ${T.accent}!important;outline-offset:2px;}
    .search-bar input:focus-visible{outline:none!important;}
    .search-bar:has(input:focus-visible){outline:2px solid ${T.accent};outline-offset:2px;}
    [data-selected]{outline:2px solid ${T.accent};outline-offset:-1px;}
    .sr-only{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}
    /* Task titles are role="button" spans (so they can be reached and opened
       from the keyboard) that look like plain text. Declared before .strike so
       the strike-through line still applies. */
    .title-btn{all:unset;cursor:pointer;overflow-wrap:anywhere;}
    /* Completing a task: the check draws itself in on a little pop, and the
       title's strike-through draws left to right. .strike is a background line
       rather than text-decoration so it can animate; box-decoration-break
       repeats it on every line of a wrapped title. */
    .check-draw polyline{stroke-dashoffset:1;animation:checkDraw .36s .07s cubic-bezier(.65,0,.35,1) forwards;}
    @keyframes checkDraw{to{stroke-dashoffset:0}}
    .check-pop{animation:checkPop .38s cubic-bezier(.34,1.56,.64,1);}
    @keyframes checkPop{0%{transform:scale(.7)}100%{transform:scale(1)}}
    .strike{text-decoration:none!important;background-image:linear-gradient(currentColor,currentColor);background-repeat:no-repeat;background-position:0 55%;background-size:100% 1.5px;-webkit-box-decoration-break:clone;box-decoration-break:clone;}
    .strike-anim{animation:strikeDraw .42s .19s cubic-bezier(.65,0,.35,1) both;}
    @keyframes strikeDraw{from{background-size:0% 1.5px}}
    @media (prefers-reduced-motion:reduce){.check-draw polyline{animation:none;stroke-dashoffset:0;}.check-pop,.strike-anim,.search-pop,.sec-body{animation:none;}}
    .rb{font-family:'DM Mono',monospace;font-size:10px;font-weight:500;border-radius:999px;padding:2px 8px;}
    .tog{width:38px;height:20px;border-radius:999px;border:none;cursor:pointer;transition:background 0.2s;position:relative;flex-shrink:0;}
    .sl{font-family:'DM Mono',monospace;font-size:10px;letter-spacing:.08em;text-transform:uppercase;padding:10px 0 6px;}
    ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:transparent}::-webkit-scrollbar-thumb{background:${T.border};border-radius:99px}
    .glass-tab:active{transform:scale(0.92);}
    ${liquidGlass?`
    /* Liquid glass. The page gets a soft, fixed glow layer behind everything
       so the translucent surfaces have something to show through. Cards are
       matched by their inline glass border (React serializes inline styles,
       so the rgba() spacing below is the browser's normalized form) and get
       a specular top-edge highlight plus a soft drop shadow; floating ones
       (menus, toasts, bars) also get a real backdrop blur and a stronger
       tint so text underneath them doesn't bleed through. Anything with its
       own inline box-shadow keeps it. */
    .app-shell{position:relative;isolation:isolate;}
    .app-shell::before{content:"";position:fixed;inset:0;z-index:-1;pointer-events:none;background:${T.light
      ?"radial-gradient(circle at 12% 8%,rgba(255,255,255,0.95),transparent 42%),radial-gradient(circle at 88% 30%,rgba(0,0,0,0.06),transparent 45%),radial-gradient(circle at 30% 85%,rgba(0,0,0,0.05),transparent 45%),radial-gradient(circle at 80% 95%,rgba(255,255,255,0.8),transparent 40%)"
      :"radial-gradient(circle at 12% 8%,rgba(255,255,255,0.08),transparent 42%),radial-gradient(circle at 88% 30%,rgba(255,255,255,0.05),transparent 45%),radial-gradient(circle at 30% 85%,rgba(255,255,255,0.045),transparent 45%)"};}
    [style*="border: 1px solid ${T.border.replace(/,/g,", ")}"][style*="border-radius"]{box-shadow:${T.light
      ?"inset 0 1px 0 rgba(255,255,255,0.9),0 4px 18px rgba(0,0,0,0.06)"
      :"inset 0 1px 0 rgba(255,255,255,0.07),0 6px 22px rgba(0,0,0,0.35)"};}
    [style*="position: absolute"][style*="border: 1px solid ${T.border.replace(/,/g,", ")}"],
    [style*="position: fixed"][style*="border: 1px solid ${T.border.replace(/,/g,", ")}"]{
      background:${T.light?"rgba(255,255,255,0.72)":"rgba(30,30,30,0.66)"}!important;
      backdrop-filter:blur(24px) saturate(180%);-webkit-backdrop-filter:blur(24px) saturate(180%);}
    /* Pointer highlight: a soft glow (a faint sheen in light mode) on the glass
       card under the mouse or finger (and any glass card containing it),
       positioned by --glass-x/--glass-y, which the effect below sets on those
       cards relative to their own box. Registered as non-inheriting so a nested
       card never picks up its parent's position. Follows the mouse, or a finger
       while it's on the screen -- never device tilt. Cards with their own
       inline gradient keep it untouched. */
    @property --glass-x{syntax:"<length>";inherits:false;initial-value:-9999px;}
    @property --glass-y{syntax:"<length>";inherits:false;initial-value:-9999px;}
    ${glassCardSel}{
      background-image:radial-gradient(circle 220px at var(--glass-x,-9999px) var(--glass-y,-9999px),${T.light?"rgba(0,0,0,0.07)":"rgba(255,255,255,0.13)"},transparent 70%)!important;}
    `:""}
    .pomo-ring{animation:ring 1s linear infinite;}
    @keyframes ring{from{stroke-dashoffset:0}to{stroke-dashoffset:283}}
    .app-inner{max-width:580px;margin:0 auto;padding:20px 14px;width:100%;box-sizing:border-box;}
    @media (min-width:900px){
      .dl-wide .app-inner{max-width:920px;}
      .dl-sidebar .app-inner{max-width:1080px;padding:24px 28px;}
      .dl-sidebar .app-body{display:flex;align-items:flex-start;gap:24px;}
      .dl-sidebar .app-sidebar{width:168px;flex-shrink:0;position:sticky;top:24px;}
      .dl-sidebar .app-main{flex:1;min-width:0;}
      .dl-sidebar .app-sidebar .tab-bar{flex-direction:column;background:none!important;border:none!important;padding:0!important;gap:6px!important;box-shadow:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;}
      .dl-sidebar .app-sidebar .tab-bar .glass-lens,.dl-sidebar .app-sidebar .tab-bar .glass-sheen{display:none;}
      .dl-sidebar .app-sidebar .tab-bar button[aria-pressed="true"]{background:${T.card}!important;}
      .dl-sidebar .app-sidebar .tab-bar button{flex:none!important;justify-content:center!important;padding:12px!important;}
    }
    @media (max-width:600px){
      input,textarea{font-size:16px!important;}
    }
  `,[T.bg,T.card,T.border,T.light,T.accent,liquidGlass,glassCardSel,F.google,F.body]);

  // Feeds the Liquid Glass pointer highlight (see the css above): the mouse or
  // finger position, relative to each glass card it's over, as CSS variables on
  // those cards -- at most once per frame. The card is found from the point
  // itself (not the event target, which stays fixed for the length of a touch).
  // Mouse/pen use pointer events and clear when leaving the window; touch uses
  // touch events, since those keep firing while the page scrolls under the
  // finger (pointer events cancel), and clears shortly after the finger lifts.
  useEffect(()=>{
    if(!liquidGlass)return;
    let lit:HTMLElement[]=[];
    let raf=0,x=0,y=0,clearTimer=0;
    const unlight=(els:HTMLElement[])=>els.forEach(el=>{el.style.removeProperty("--glass-x");el.style.removeProperty("--glass-y");});
    const update=()=>{
      raf=0;
      const next:HTMLElement[]=[];
      for(let el=document.elementFromPoint(x,y)?.closest<HTMLElement>(glassCardSel)??null;el;el=el.parentElement?.closest<HTMLElement>(glassCardSel)??null)next.push(el);
      unlight(lit.filter(el=>!next.includes(el)));
      for(const el of next){const r=el.getBoundingClientRect();el.style.setProperty("--glass-x",(x-r.left)+"px");el.style.setProperty("--glass-y",(y-r.top)+"px");}
      lit=next;
    };
    const at=(cx:number,cy:number)=>{clearTimeout(clearTimer);x=cx;y=cy;if(!raf)raf=requestAnimationFrame(update);};
    const clear=()=>{clearTimeout(clearTimer);cancelAnimationFrame(raf);raf=0;unlight(lit);lit=[];};
    const move=(e:PointerEvent)=>{if(e.pointerType!=="touch")at(e.clientX,e.clientY);};
    const touch=(e:TouchEvent)=>{const t=e.touches[0];if(t)at(t.clientX,t.clientY);};
    // Scrolling moves cards under a finger that's holding still, so re-aim.
    const scroll=()=>{if(lit.length&&!raf)raf=requestAnimationFrame(update);};
    const leave=(e:PointerEvent)=>{if(e.pointerType!=="touch")clear();};
    const lift=(e:TouchEvent)=>{if(e.touches.length)return;clearTimeout(clearTimer);clearTimer=window.setTimeout(clear,250);};
    window.addEventListener("pointermove",move,{passive:true});
    window.addEventListener("touchstart",touch,{passive:true});
    window.addEventListener("touchmove",touch,{passive:true});
    window.addEventListener("touchend",lift,{passive:true});
    window.addEventListener("touchcancel",lift,{passive:true});
    window.addEventListener("scroll",scroll,{passive:true});
    document.documentElement.addEventListener("pointerleave",leave);
    window.addEventListener("blur",clear);
    return()=>{
      window.removeEventListener("pointermove",move);window.removeEventListener("touchstart",touch);window.removeEventListener("touchmove",touch);
      window.removeEventListener("touchend",lift);window.removeEventListener("touchcancel",lift);window.removeEventListener("scroll",scroll);
      document.documentElement.removeEventListener("pointerleave",leave);window.removeEventListener("blur",clear);clear();
    };
  },[liquidGlass,glassCardSel]);

  // Session timer -- elapsed time from a fixed start, not a per-second
  // counter, so time worked while the tab is in the background or the screen
  // is locked (when browsers slow or pause timers) still counts.
  const sessionStartRef=useRef(0);
  useEffect(()=>{
    if(!sessionActive)return;
    const tick=()=>setSessionSecs(Math.floor((Date.now()-sessionStartRef.current)/1000));
    sessionInterval.current=setInterval(tick,1000);
    document.addEventListener("visibilitychange",tick);
    return()=>{clearInterval(sessionInterval.current);document.removeEventListener("visibilitychange",tick);};
  },[sessionActive]);

  function startSession(){sessionStartRef.current=Date.now();setSessionSecs(0);setSessionActive(true);}
  // Logged onto the task itself (and so synced like any other task field),
  // not kept in throwaway modal state -- "sessions today" used to reset every
  // time the modal was closed and reopened.
  function endSession(){
    setSessionActive(false);
    if(!selectedTask||sessionSecs<5){setSessionSecs(0);return;}
    const mins=Math.max(1,Math.round(sessionSecs/60));
    const id=selectedTask.id;
    setTasks(prev=>prev.map(t=>t.id===id?{...t,sessions:addSession(t.sessions,{mins,at:Date.now()})}:t));
    setSessionSecs(0);
  }

  // If the open task disappears from under the detail panel -- deleted on
  // another device, or signed out -- close it (and stop any session on it,
  // which would have nowhere to be logged) rather than showing a stale copy
  // whose edits go nowhere, with the page behind still made inert.
  useEffect(()=>{
    if(!selectedTask||tasks.some(t=>t.id===selectedTask.id))return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedTask(null);setSessionActive(false);setSessionSecs(0);
  },[tasks,selectedTask]);

  // "Take me there" on an Inbox update (WhatsNewItem.go): opens the place
  // ("settings", "tasks", "task", "calendar", "history", "import", "menu", "profile", "focus") and then
  // highlights the data-tour anchor, if any. Shows where things are rather than
  // doing them -- e.g. it points at Select instead of starting a selection.
  function goTo(dest:string){
    const [place,anchor]=dest.split(":");
    setOpenUpdate(null);
    // "menu" opens the title menu itself; everything else closes it.
    setTitleMenuOpen(place==="menu");
    if(place==="history"||place==="import"||place==="calendar")setActiveTab(place);
    if(place==="settings"){
      setActiveTab("options");
      // Open the dropdown holding the anchor first.
      const section=({layout:"looks","liquid-glass":"looks","anim-speed":"looks","date-time":"datetime","focus-timer":"focus","new-task-questions":"questions",subjects:"subjects",reminders:"reminders"} as Record<string,string>)[anchor];
      if(section)setOpenSettings(prev=>prev.includes(section)?prev:[...prev,section]);
    }
    if(place==="tasks")setActiveTab("tasks");
    if(place==="profile")setShowProfile(true);
    if(place==="focus")setFocusModeAnimated(true);
    if(place==="task"){
      // A real task to show the feature on -- a repeating one for Skip, which
      // only repeating tasks have.
      setActiveTab("tasks");
      const open=tasks.filter(t=>!t.done&&!t.archived);
      const t=(anchor==="task-skip"&&open.find(x=>x.recurrence&&x.recurrence!=="none"))||open[0]||tasks[0];
      if(t)setSelectedTask(t);
    }
    if(anchor)flashTarget(anchor,T.accent);
  }
  // The Calendar's "+ Add homework due <day>": the usual add-task questions on
  // the Tasks tab, with that day already picked -- the due-date question opens
  // straight on "what time?", or, if that question is turned off, the task
  // just gets the date.
  function addHomeworkOn(date:string){
    setActiveTab("tasks");
    startAdding();
    setNewTask(t=>({...t,dueDate:date}));
    if(askQuestions.some(q=>q.type==="date"))setPendingDueDate(date);
  }
  // Props shared by every Settings dropdown.
  const sec=(id:string)=>({id,open:openSettings.includes(id),onToggle:toggleSettingsSection,T,F});
  const inboxSec=(id:string)=>({id,open:openInbox.includes(id),onToggle:toggleInboxSection,T,F});

  // ─── LAYOUT RENDERERS ─────────────────────────────────────────────────────────
  function renderTasks(tasks:Task[]) {
    const pending=allSorted.filter(t=>!t.done);
    // Shared props for the (module-scope) MiniCard -- spread at each call site
    // below instead of repeating this whole list three times.
    const miniCardProps={T,F,subjectColors,colorCodeUrgency,now,h24,dragTaskId,dragOffsetY,
      onOpen:(t:Task)=>{setSelectedTask(t);},
      onToggleDone:toggleDone,onDelete:deleteTask,
      swipeClickGuard,swipeHandlers,swipeContentStyle,renderSwipeReveal,
      startDrag,onDragMove,endDrag,
      selectionMode,onToggleSelect:toggleSelected};
    const mc=(t:Task)=>({...miniCardProps,isSelected:selectedIds.includes(t.id),justDone:justDone.includes(t.id),onMoveBy:moveTaskBy});
    // The other layouts' rows in select mode: tapping a row selects it instead
    // of opening it, and its done-check shows (and toggles) selection.
    const openOrSelect=(t:Task)=>{if(selectionMode)toggleSelected(t.id);else setSelectedTask(t);};
    const chk=(t:Task)=>selectionMode?{on:selectedIds.includes(t.id),color:T.accent}:{on:t.done,color:"#2ED573"};

    if (layout==="checklist") return (
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {tasks.map((t,i)=>{const pr=getPriority(t.dueDate,t.estMins,t.priorityOverride);return(
          <div key={t.id} data-task-id={t.id} style={{position:"relative",overflow:"hidden",borderRadius:10}}>
            {renderSwipeReveal(t.id)}
            <div className="tc" onClick={swipeClickGuard(()=>openOrSelect(t))} data-selected={selectionMode&&selectedIds.includes(t.id)||undefined} {...(selectionMode?{}:swipeHandlers(t.id))} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",background:T.card,borderRadius:10,border:`1px solid ${T.border}`,cursor:"pointer",...swipeContentStyle(t.id)}}>
              <span style={{fontFamily:F.body,fontSize:11,color:T.textFaint,minWidth:18}}>{String(i+1).padStart(2,"0")}</span>
              <button aria-label={selectionMode?(selectedIds.includes(t.id)?`Deselect ${t.title}`:`Select ${t.title}`):t.done?`Mark ${t.title} not done`:`Mark ${t.title} done`} onClick={e=>{e.stopPropagation();if(selectionMode)toggleSelected(t.id);else toggleDone(t.id);}} style={{width:20,height:20,border:`2px solid ${chk(t).on?chk(t).color:T.textFaint}`,borderRadius:4,background:chk(t).on?chk(t).color:"none",cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",padding:0,transition:"all 0.2s"}}>
                {chk(t).on&&<CheckMark size={12} color={selectionMode?contrastColor(T.accent):undefined} animate={!selectionMode&&justDone.includes(t.id)}/>}
              </button>
              <span role="button" tabIndex={0} onKeyDown={activateOnKey} className={"title-btn"+(t.done?(justDone.includes(t.id)?" strike strike-anim":" strike"):"")} aria-haspopup="dialog" style={{fontFamily:F.body,fontSize:13,flex:1,color:t.done?T.textFaint:T.text}}>{t.title}</span>
              {!t.done&&<span style={{fontFamily:F.body,fontSize:10,color:ink(priColor(pr,colorCodeUrgency),T.light)}}>{daysUntil(t.dueDate)}</span>}
              {!selectionMode&&<button aria-label={`Delete ${t.title}`} style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:14,lineHeight:1}} onClick={e=>{e.stopPropagation();deleteTask(t.id);}}>×</button>}
            </div>
          </div>
        );})}
      </div>
    );

    if (layout==="board") return (
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(165px,1fr))",gap:10}}>
        {tasks.map(t=>{const pr=getPriority(t.dueDate,t.estMins,t.priorityOverride);const sc=subjectColors[t.subject]||T.accent;return(
          <div key={t.id} data-task-id={t.id} className="tc" onClick={()=>openOrSelect(t)} data-selected={selectionMode&&selectedIds.includes(t.id)||undefined} style={{background:T.card,borderRadius:12,padding:"13px",border:`1px solid ${T.border}`,position:"relative",overflow:"hidden",display:"flex",flexDirection:"column",gap:7,cursor:"pointer"}}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:priColor(pr,colorCodeUrgency),borderRadius:"12px 12px 0 0"}}/>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              {t.subject&&<span style={{background:sc+"22",color:ink(sc,T.light),borderRadius:999,padding:"2px 8px",fontFamily:F.body,fontSize:10}}>{t.subject}</span>}
              {!selectionMode&&<button aria-label={`Delete ${t.title}`} style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13,lineHeight:1,marginLeft:"auto"}} onClick={e=>{e.stopPropagation();deleteTask(t.id);}}>×</button>}
            </div>
            <span role="button" tabIndex={0} onKeyDown={activateOnKey} className="title-btn" aria-haspopup="dialog" style={{display:"block",fontFamily:F.heading,fontSize:14,color:t.done?T.textFaint:T.text,textDecoration:t.done?"line-through":"none",lineHeight:1.3}}>{t.title}</span>
            {t.dueDate&&<div style={{fontFamily:F.body,fontSize:10,color:T.textMuted}}>{formatDate(t.dueDate)}{!t.done?<span style={{color:ink(priColor(pr,colorCodeUrgency),T.light)}}> · {daysUntil(t.dueDate)}</span>:null}</div>}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:"auto"}}>
              {t.estMins>0&&<span style={{fontFamily:F.body,fontSize:10,color:T.textMuted}}>{formatDuration(t.estMins)}</span>}
              <button aria-label={selectionMode?(selectedIds.includes(t.id)?`Deselect ${t.title}`:`Select ${t.title}`):t.done?`Mark ${t.title} not done`:`Mark ${t.title} done`} onClick={e=>{e.stopPropagation();if(selectionMode)toggleSelected(t.id);else toggleDone(t.id);}} style={{background:chk(t).on?chk(t).color:"none",border:`2px solid ${chk(t).on?chk(t).color:T.textFaint}`,borderRadius:"50%",width:17,height:17,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0}}>
                {chk(t).on&&<CheckMark size={9} color={selectionMode?contrastColor(T.accent):undefined} animate={!selectionMode&&justDone.includes(t.id)}/>}
              </button>
            </div>
          </div>
        );})}
      </div>
    );

    if (layout==="kanban") {
      const cols=[{key:"high",label:"Urgent",tasks:filteredTasks.filter(t=>!t.done&&getPriority(t.dueDate,t.estMins,t.priorityOverride)==="high")},{key:"medium",label:"Soon",tasks:filteredTasks.filter(t=>!t.done&&getPriority(t.dueDate,t.estMins,t.priorityOverride)==="medium")},{key:"low",label:"Later",tasks:filteredTasks.filter(t=>!t.done&&getPriority(t.dueDate,t.estMins,t.priorityOverride)==="low")},{key:"done",label:"✓ Done",tasks:filteredTasks.filter(t=>t.done)}];
      return(
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10}}>
          {cols.map(col=>(
            <div key={col.key} style={{background:T.surface,borderRadius:12,padding:"12px",border:`1px solid ${T.border}`}}>
              <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginBottom:10,fontWeight:500}}>{col.label} ({col.tasks.length})</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {col.tasks.map(t=>(
                  <div key={t.id} data-task-id={t.id} className="tc" onClick={()=>openOrSelect(t)} data-selected={selectionMode&&selectedIds.includes(t.id)||undefined} style={{background:T.card,borderRadius:8,padding:"9px 10px",border:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:7,cursor:"pointer"}}>
                    <button aria-label={selectionMode?(selectedIds.includes(t.id)?`Deselect ${t.title}`:`Select ${t.title}`):t.done?`Mark ${t.title} not done`:`Mark ${t.title} done`} onClick={e=>{e.stopPropagation();if(selectionMode)toggleSelected(t.id);else toggleDone(t.id);}} style={{background:chk(t).on?chk(t).color:"none",border:`1.5px solid ${chk(t).on?chk(t).color:T.textFaint}`,borderRadius:"50%",width:14,height:14,cursor:"pointer",flexShrink:0,padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                      {chk(t).on&&<CheckMark size={9} color={selectionMode?contrastColor(T.accent):undefined} animate={!selectionMode&&justDone.includes(t.id)}/>}
                    </button>
                    <span role="button" tabIndex={0} onKeyDown={activateOnKey} className={"title-btn"+(t.done?(justDone.includes(t.id)?" strike strike-anim":" strike"):"")} aria-haspopup="dialog" style={{fontFamily:F.body,fontSize:12,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:t.done?T.textFaint:T.text}}>{t.title}</span>
                    {!selectionMode&&<button aria-label={`Delete ${t.title}`} style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:12,lineHeight:1}} onClick={e=>{e.stopPropagation();deleteTask(t.id);}}>×</button>}
                  </div>
                ))}
                {col.tasks.length===0&&<div style={{fontFamily:F.body,fontSize:11,color:T.textFaint,textAlign:"center",padding:"10px 0"}}>Empty</div>}
              </div>
            </div>
          ))}
        </div>
      );
    }

    if (layout==="progress") return (
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {tasks.map(t=>{
          const pr=getPriority(t.dueDate,t.estMins,t.priorityOverride);const sc=subjectColors[t.subject]||T.accent;
          // Real progress: share of subtasks checked off (a done task is 100%).
          const subs=t.subtasks||[]; const doneSubs=subs.filter(s=>s.done).length;
          const pct=t.done?100:subs.length?Math.round(doneSubs/subs.length*100):0;
          return(
            <div key={t.id} data-task-id={t.id} className="tc" onClick={()=>openOrSelect(t)} data-selected={selectionMode&&selectedIds.includes(t.id)||undefined} style={{background:T.card,borderRadius:12,padding:"13px 15px",border:`1px solid ${T.border}`,cursor:"pointer"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <button aria-label={selectionMode?(selectedIds.includes(t.id)?`Deselect ${t.title}`:`Select ${t.title}`):t.done?`Mark ${t.title} not done`:`Mark ${t.title} done`} onClick={e=>{e.stopPropagation();if(selectionMode)toggleSelected(t.id);else toggleDone(t.id);}} style={{background:chk(t).on?chk(t).color:"none",border:`2px solid ${chk(t).on?chk(t).color:T.textFaint}`,borderRadius:"50%",width:18,height:18,cursor:"pointer",padding:0,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                    {chk(t).on&&<CheckMark size={10} color={selectionMode?contrastColor(T.accent):undefined} animate={!selectionMode&&justDone.includes(t.id)}/>}
                  </button>
                  <span role="button" tabIndex={0} onKeyDown={activateOnKey} className={"title-btn"+(t.done?(justDone.includes(t.id)?" strike strike-anim":" strike"):"")} aria-haspopup="dialog" style={{fontFamily:F.heading,fontSize:14,color:t.done?T.textFaint:T.text}}>{t.title}</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  {t.subject&&<span style={{background:sc+"22",color:ink(sc,T.light),borderRadius:999,padding:"1px 7px",fontFamily:F.body,fontSize:10}}>{t.subject}</span>}
                  {!selectionMode&&<button aria-label={`Delete ${t.title}`} style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13,lineHeight:1}} onClick={e=>{e.stopPropagation();deleteTask(t.id);}}>×</button>}
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{flex:1,height:7,background:T.border,borderRadius:999}}>
                  <div style={{width:`${pct}%`,height:"100%",background:t.done?"#2ED573":priColor(pr,colorCodeUrgency),borderRadius:999,transition:"width 0.5s"}}/>
                </div>
                {(t.done||subs.length>0)&&<span style={{fontFamily:F.body,fontSize:10,color:T.textFaint,flexShrink:0}}>{t.done?"Done":`${doneSubs}/${subs.length}`}</span>}
                {t.estMins>0&&<span style={{fontFamily:F.body,fontSize:10,color:T.textMuted,flexShrink:0}}>{formatDuration(t.estMins)}</span>}
                {!t.done&&<span style={{fontFamily:F.body,fontSize:10,color:ink(priColor(pr,colorCodeUrgency),T.light),flexShrink:0}}>{daysUntil(t.dueDate)}</span>}
              </div>
            </div>
          );
        })}
      </div>
    );

    if (layout==="pyramid") {
      const highT=tasks.filter(t=>!t.done&&getPriority(t.dueDate,t.estMins,t.priorityOverride)==="high");
      const medT=tasks.filter(t=>!t.done&&getPriority(t.dueDate,t.estMins,t.priorityOverride)==="medium");
      const lowT=tasks.filter(t=>!t.done&&getPriority(t.dueDate,t.estMins,t.priorityOverride)==="low");
      const doneT=tasks.filter(t=>t.done);
      return(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {[{tasks:highT,color:ink(priColor("high",colorCodeUrgency),T.light),label:"High Priority",w:"100%"},{tasks:medT,color:ink(priColor("medium",colorCodeUrgency),T.light),label:"Medium Priority",w:"85%"},{tasks:lowT,color:ink(priColor("low",colorCodeUrgency),T.light),label:"Low Priority",w:"65%"},{tasks:doneT,color:T.textFaint,label:"✓ Done",w:"45%"}].map(tier=>(
            tier.tasks.length>0&&(
              <div key={tier.label} style={{margin:"0 auto",width:tier.w}}>
                <div style={{fontFamily:F.body,fontSize:10,color:tier.color,marginBottom:5,textAlign:"center"}}>{tier.label}</div>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  {tier.tasks.map(t=>(
                    <div key={t.id} data-task-id={t.id} className="tc" onClick={()=>openOrSelect(t)} data-selected={selectionMode&&selectedIds.includes(t.id)||undefined} style={{background:T.card,borderRadius:9,padding:"9px 12px",border:`1px solid ${tier.color}44`,display:"flex",alignItems:"center",gap:8,cursor:"pointer"}}>
                      <button aria-label={selectionMode?(selectedIds.includes(t.id)?`Deselect ${t.title}`:`Select ${t.title}`):t.done?`Mark ${t.title} not done`:`Mark ${t.title} done`} onClick={e=>{e.stopPropagation();if(selectionMode)toggleSelected(t.id);else toggleDone(t.id);}} style={{background:chk(t).on?chk(t).color:"none",border:`1.5px solid ${chk(t).on?chk(t).color:T.textFaint}`,borderRadius:"50%",width:15,height:15,cursor:"pointer",flexShrink:0,padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        {chk(t).on&&<CheckMark size={9} color={selectionMode?contrastColor(T.accent):undefined} animate={!selectionMode&&justDone.includes(t.id)}/>}
                      </button>
                      <span role="button" tabIndex={0} onKeyDown={activateOnKey} className={"title-btn"} aria-haspopup="dialog" style={{fontFamily:F.body,fontSize:12,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:t.done?T.textFaint:T.text}}>{t.title}</span>
                      {t.subject&&<span style={{fontFamily:F.body,fontSize:10,color:T.textMuted,flexShrink:0}}>{t.subject}</span>}
                      {!selectionMode&&<button aria-label={`Delete ${t.title}`} style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13}} onClick={e=>{e.stopPropagation();deleteTask(t.id);}}>×</button>}
                    </div>
                  ))}
                </div>
              </div>
            )
          ))}
        </div>
      );
    }

    // default: list -- this is also the only layout "Group Tasks By" applies to,
    // since the other layouts (kanban, progress, pyramid...) already
    // have their own built-in grouping and combining the two would conflict.
    if (groupBy!=="none") {
      const groups=new Map<string,Task[]>();
      const order:string[]=[];
      const keyFor=(t:Task)=>{
        if (groupBy==="subject") return t.subject||"No subject";
        if (groupBy==="priority") return getPriority(t.dueDate,t.estMins,t.priorityOverride);
        return t.dueDate||"Anytime"; // dueDate; undated tasks group as "Anytime"
      };
      for (const t of tasks) {
        const k=keyFor(t);
        if (!groups.has(k)) { groups.set(k,[]); order.push(k); }
        groups.get(k)!.push(t);
      }
      if (groupBy==="priority") order.sort((a,b)=>({high:0,medium:1,low:2} as Record<string,number>)[a]-({high:0,medium:1,low:2} as Record<string,number>)[b]);
      if (groupBy==="dueDate") order.sort((a,b)=>a==="Anytime"?1:b==="Anytime"?-1:a.localeCompare(b));
      const labelFor=(k:string)=>{
        if (groupBy==="priority") return k==="high"?"High priority":k==="medium"?"Medium priority":"Low priority";
        if (groupBy==="dueDate") return k==="Anytime"?k:formatDate(k);
        return k; // subject
      };
      return <div style={{display:"flex",flexDirection:"column",gap:16}}>
        {order.map(k=>(
          <div key={k}>
            <div className="sl" style={{color:T.textMuted,paddingTop:0}}>{labelFor(k)} ({groups.get(k)!.length})</div>
            <div role="list" aria-label={labelFor(k)} style={{display:"flex",flexDirection:"column",gap:10}}>
              {groups.get(k)!.map(t=><MiniCard key={t.id} task={t} rank={pending.indexOf(t)} swipeable {...mc(t)}/>)}
            </div>
          </div>
        ))}
      </div>;
    }
    return <div role="list" aria-label="Tasks" style={{display:"flex",flexDirection:"column",gap:10}}>{tasks.map(t=><MiniCard key={t.id} task={t} rank={pending.indexOf(t)} reorderable swipeable {...mc(t)}/>)}</div>;
  }


  const pomMin=Math.floor(pomodoroSecs/60); const pomSec=pomodoroSecs%60;
  const pomPct=Math.min(1,pomodoroSecs/((pomodoroPhase==="work"?pomodoroWorkMins:pomodoroBreakMins)*60));
  const onBreak=pomodoroPhase==="break";
  function renderPomodoroCard(){
    return (
      <div style={{background:T.card,borderRadius:12,padding:"16px",border:`1px solid ${T.border}`,textAlign:"center"}}>
        <div className="sl" style={{color:onBreak?"#2ED573":T.textMuted,textAlign:"left"}}>{onBreak?"Break":"Pomodoro Timer"}</div>
        <div style={{position:"relative",width:100,height:100,margin:"10px auto"}}>
          <svg width="100" height="100" style={{transform:"rotate(-90deg)"}}>
            <circle cx="50" cy="50" r="45" fill="none" stroke={T.border} strokeWidth="6"/>
            <circle cx="50" cy="50" r="45" fill="none" stroke={onBreak?"#2ED573":T.accent} strokeWidth="6" strokeDasharray="283" strokeDashoffset={283*(1-pomPct)} strokeLinecap="round" style={{transition:"stroke-dashoffset 1s linear"}}/>
          </svg>
          <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",textAlign:"center"}}>
            <div style={{fontFamily:F.body,fontSize:18,color:T.text,fontWeight:500}}>{String(pomMin).padStart(2,"0")}:{String(pomSec).padStart(2,"0")}</div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"center"}}>
          <button onClick={()=>{setPomodoroActive(a=>!a);setBreakEnded(false);}} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:9,padding:"8px 18px",fontFamily:F.body,fontSize:12,cursor:"pointer"}}>{pomodoroActive?"Pause":onBreak?"Start break":"Start"}</button>
          <button onClick={resetPomodoro} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:9,padding:"8px 14px",color:T.textMuted,fontFamily:F.body,fontSize:12,cursor:"pointer"}}>{onBreak?"Skip break":"Reset"}</button>
        </div>
      </div>
    );
  }

  function renderPomodoroToast(){
    const shell:React.CSSProperties={position:"fixed",left:"50%",bottom:undoToast!=null&&!focusMode?76:20,transform:"translateX(-50%)",zIndex:1600,display:"flex",alignItems:"center",gap:10,background:T.card,border:`1px solid ${T.border}`,borderRadius:999,padding:"10px 10px 10px 16px",boxShadow:"0 6px 24px rgba(0,0,0,0.3)",maxWidth:"calc(100vw - 32px)"};
    // Outside Focus Mode, the end of a break shows its suggestion here; in
    // Focus Mode it's a card above the task instead (renderBreakSuggestion).
    if(breakEnded&&!focusMode&&nextSuggestion) return (
      <div role="status" style={shell}>
        <span style={{fontFamily:F.body,fontSize:12,color:T.text,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>Break's over, {suggestionIsContinue?"keep going on":"next up:"} {nextSuggestion.title}</span>
        <button onClick={startSuggested} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:999,padding:"6px 14px",fontSize:12,fontWeight:500,cursor:"pointer",flexShrink:0}}>Start</button>
        <button onClick={()=>setBreakEnded(false)} aria-label="Dismiss" style={{background:"none",border:"none",color:T.textMuted,fontSize:15,cursor:"pointer",flexShrink:0,padding:"0 4px"}}>×</button>
      </div>
    );
    if(!pomodoroDone)return null;
    return (
      <div role="status" style={shell}>
        <span style={{fontFamily:F.body,fontSize:12,color:T.text}}>{autoStartBreaks?`Pomodoro done. ${pomodoroBreakMins}-minute break started`:"Pomodoro done. Take a short break"}</span>
        <button onClick={()=>setPomodoroDone(false)} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:999,padding:"6px 14px",fontSize:12,fontWeight:500,cursor:"pointer",flexShrink:0}}>OK</button>
      </div>
    );
  }

  // Focus Mode's "break's over" card: one tap starts the next focus session on
  // the suggested task; "Pick another" opens the task picker instead.
  function renderBreakSuggestion(){
    if(!breakEnded)return null;
    return (
      <div className="pop" role="status" style={{background:T.card,borderRadius:14,padding:"14px 16px",border:"1px solid #2ED57355"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,marginBottom:nextSuggestion?8:0}}>
          <span style={{fontFamily:F.body,fontSize:12,color:ink("#2ED573",T.light),fontWeight:500}}>Break's over</span>
          <button onClick={()=>setBreakEnded(false)} aria-label="Dismiss" style={{background:"none",border:"none",color:T.textMuted,fontSize:15,cursor:"pointer",padding:"0 2px",lineHeight:1}}>×</button>
        </div>
        {nextSuggestion?<>
          <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginBottom:2}}>{suggestionIsContinue?"Keep going on":"Next up"}</div>
          <div style={{fontFamily:F.heading,fontSize:17,color:T.text,marginBottom:12,overflowWrap:"anywhere"}}>{nextSuggestion.title}</div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={startSuggested} style={{flex:1,background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:9,padding:"9px 12px",fontFamily:F.body,fontSize:12,cursor:"pointer"}}>Start {pomodoroWorkMins} min</button>
            <button onClick={()=>{setBreakEnded(false);setFocusPickerOpen(true);}} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:9,padding:"9px 12px",color:T.textMuted,fontFamily:F.body,fontSize:12,cursor:"pointer"}}>Pick another</button>
          </div>
        </>:<div style={{fontFamily:F.body,fontSize:12,color:T.textMuted,marginTop:6}}>Nothing left on your list. Nice.</div>}
      </div>
    );
  }

  // Sync outer page background to theme
  useEffect(()=>{
    document.body.style.background=T.bg;
    document.body.style.transition="background 0.4s";
    return()=>{ document.body.style.background=""; };
  },[T.bg]);

  // Focus Mode: a stripped, full-screen view -- just the first pending task
  // in the user's own order (same one the list badges "do first") and the (reused, not forked) Pomodoro timer. No tab bar, no
  // other tasks, no settings. Plain useState above, nothing to persist.
  if(focusMode){
    return (
      <main className="app-shell" style={{background:T.bg,fontFamily:F.body,color:T.text,minHeight:"100dvh",display:"flex",flexDirection:"column",padding:20,transition:"background 0.3s,color 0.3s"}}>
        <style>{css}</style>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <h1 style={{fontFamily:F.heading,fontSize:20,color:T.accent,margin:0,fontWeight:400}}>Focus Mode</h1>
          <button onClick={()=>setFocusModeAnimated(false)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:9,padding:"8px 14px",color:T.textMuted,fontFamily:F.body,fontSize:12,cursor:"pointer"}}>Exit</button>
        </div>
        <div style={{flex:1,display:"flex",flexDirection:"column",gap:16,justifyContent:"center",maxWidth:420,margin:"0 auto",width:"100%"}}>
          {renderBreakSuggestion()}
          {focusTask?(
            <div className="pop" style={{background:T.gradientCard,borderRadius:16,padding:"20px",border:`1px solid ${T.accent}44`}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                <span className="rb" style={{background:T.accent+"33",color:T.accent}}>{focusTask===topTask?"up next":"focusing on"}</span>
                {focusTask.subject&&<span style={{background:(subjectColors[focusTask.subject]||T.accent)+"22",color:ink(subjectColors[focusTask.subject]||T.accent,T.light),borderRadius:999,padding:"2px 8px",fontFamily:F.body,fontSize:10}}>{focusTask.subject}</span>}
                <button data-tour="change-task" onClick={()=>setFocusPickerOpen(o=>!o)} style={{marginLeft:"auto",background:"none",border:`1px solid ${T.border}`,borderRadius:999,padding:"2px 10px",color:T.textMuted,fontSize:10,cursor:"pointer"}}>{focusPickerOpen?"Close":"Change task"}</button>
              </div>
              {focusPickerOpen&&(
                <div style={{display:"flex",flexDirection:"column",gap:4,marginBottom:12,maxHeight:180,overflowY:"auto"}}>
                  {allSorted.filter(t=>!t.done&&!t.archived).map(t=>(
                    <button key={t.id} onClick={()=>{setFocusTaskId(t.id);setFocusPickerOpen(false);}}
                      style={{textAlign:"left",background:t.id===focusTask.id?T.accent+"22":T.surface,border:`1px solid ${t.id===focusTask.id?T.accent:T.border}`,borderRadius:8,padding:"7px 10px",color:T.text,fontSize:12,cursor:"pointer"}}>
                      {t.title}{t.subject&&<span style={{color:T.textFaint}}> · {t.subject}</span>}
                    </button>
                  ))}
                </div>
              )}
              <div style={{fontFamily:F.heading,fontSize:22,color:T.text,marginBottom:8}}>{focusTask.title}</div>
              <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                {focusTask.dueDate&&<span style={{fontFamily:F.body,fontSize:12,color:T.textMuted}}>{formatDate(focusTask.dueDate)}{focusTask.dueTime?` ${formatTime(focusTask.dueTime,h24)}`:""}</span>}
                {focusTask.estMins>0&&<span style={{fontFamily:F.body,fontSize:12,color:T.textMuted}}>{formatDuration(focusTask.estMins)}</span>}
              </div>
              <button onClick={()=>toggleDone(focusTask.id)} style={{marginTop:14,background:"#2ED57322",color:ink("#2ED573",T.light),border:"1px solid #2ED57344",borderRadius:11,padding:"11px",fontFamily:F.body,fontSize:13,cursor:"pointer",width:"100%"}}>Mark done</button>
            </div>
          ):(
            <div style={{textAlign:"center",color:T.textFaint,fontFamily:F.body,fontSize:13}}>Nothing left to focus on</div>
          )}
          {renderPomodoroCard()}
        </div>
        {renderPomodoroToast()}
      </main>
    );
  }

  return (
    <div className={"app-shell dl-"+desktopLayout} style={{background:T.bg,fontFamily:F.body,color:T.text,transition:"background 0.3s,color 0.3s"}}>
      <style>{css}</style>
      {/* inert while the task sheet is open, so screen readers and Tab stay in
          the dialog instead of wandering through the list behind it. */}
      <div className="app-inner" inert={selectedTask!=null||searchOpen||openUpdate!=null||undefined}>
        {/* Header */}
        <header style={{position:"relative",display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:5}}>
          <h1 className="sr-only">DuePlanner</h1>
          <div ref={titleMenuRef} style={{position:"relative"}}>
            <button onClick={()=>setTitleMenuOpen(o=>!o)} aria-expanded={titleMenuOpen} aria-label="DuePlanner menu" style={{background:"none",border:"none",padding:0,cursor:"pointer",textAlign:"left",display:"block"}}>
              <div style={{fontFamily:F.heading,fontSize:28,lineHeight:1,color:T.accent}}>Due<span style={{color:T.text}}>Planner</span></div>
              <div style={{fontFamily:F.body,fontSize:9,color:T.textFaint,marginTop:2}}>by due. studios{fbUser&&!online&&<span title="Offline. Changes will sync when you're back online" style={{color:ink("#FFA502",T.light),marginLeft:6}}>· offline</span>}</div>
            </button>
            {titleMenuOpen&&(
              <div role="group" aria-label="DuePlanner menu" style={{position:"absolute",top:"calc(100% + 8px)",left:0,zIndex:200,width:280,background:T.card,border:`1px solid ${T.border}`,borderRadius:14,boxShadow:"0 10px 34px rgba(0,0,0,0.4)",overflow:"hidden"}}>
                <button onClick={()=>{setShowProfile(true);setTitleMenuOpen(false);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",background:"none",border:"none",padding:"12px 14px",cursor:"pointer",textAlign:"left",borderBottom:`1px solid ${T.border}`,color:T.text}}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4" stroke={T.text} strokeWidth="2"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={T.text} strokeWidth="2" strokeLinecap="round"/></svg>
                  <span style={{flex:1,minWidth:0}}>
                    <span style={{display:"block",fontFamily:F.body,fontSize:13,color:T.text}}>Profile</span>
                    {syncStatus&&!syncError&&<span style={{display:"block",fontFamily:F.body,fontSize:10,color:online?T.textFaint:"#FFA502",marginTop:2}}>{syncStatus}</span>}
                  </span>
                  {syncError&&<span title="Sync issue. Open Profile for details" style={{fontFamily:F.body,fontSize:11,color:ink("#FF4757",T.light)}}>⚠ Sync issue</span>}
                </button>
                <button onClick={()=>{setActiveTab("inbox");setTitleMenuOpen(false);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",background:"none",border:"none",padding:"12px 14px",cursor:"pointer",textAlign:"left",borderBottom:`1px solid ${T.border}`,color:T.text}}>
                  <IconBell/>
                  <span style={{fontFamily:F.body,fontSize:13,color:T.text,flex:1}}>Inbox</span>
                  {unreadRecaps.length>0&&<span aria-label={`${unreadRecaps.length} unread`} style={{background:T.accent,color:contrastColor(T.accent),borderRadius:999,padding:"1px 7px",fontFamily:F.body,fontSize:10,fontWeight:600}}>{unreadRecaps.length}</span>}
                </button>
                <button onClick={()=>{setActiveTab("history");setTitleMenuOpen(false);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",background:"none",border:"none",padding:"12px 14px",cursor:"pointer",textAlign:"left",borderBottom:`1px solid ${T.border}`,color:T.text}}>
                  <IconHistory/>
                  <span style={{fontFamily:F.body,fontSize:13,color:T.text}}>History</span>
                </button>
                <button onClick={()=>{setActiveTab("import");setTitleMenuOpen(false);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",background:"none",border:"none",padding:"12px 14px",cursor:"pointer",textAlign:"left",borderBottom:`1px solid ${T.border}`,color:T.text}}>
                  <IconImport/>
                  <span style={{fontFamily:F.body,fontSize:13,color:T.text}}>Import/Export</span>
                </button>
                <button onClick={()=>{setActiveTab("options");setTitleMenuOpen(false);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",background:"none",border:"none",padding:"12px 14px",cursor:"pointer",textAlign:"left",color:T.text}}>
                  <IconSettings/>
                  <span style={{fontFamily:F.body,fontSize:13,color:T.text}}>Settings</span>
                </button>
              </div>
            )}
          </div>
          <div ref={timeMenuRef} style={{position:"relative"}}>
            <button data-tour="time-left" onClick={()=>setTimeMenuOpen(o=>!o)} aria-haspopup="dialog" aria-expanded={timeMenuOpen} aria-label="Time left breakdown" style={{background:"none",border:"none",padding:0,cursor:"pointer",textAlign:"right",display:"block"}}>
              <div style={{fontFamily:F.body,fontSize:9,color:T.textFaint}}>Time left</div>
              <div style={{fontFamily:F.heading,fontSize:20,color:effectiveThemeMode==="dark"?"#fff":"#000"}}>{fmtMins(totalMins)}</div>
            </button>
            {timeMenuOpen&&(
              <div role="dialog" aria-label="Time left breakdown" style={{position:"absolute",top:"calc(100% + 8px)",right:0,zIndex:200,width:250,maxWidth:"calc(100vw - 28px)",background:T.card,border:`1px solid ${T.border}`,borderRadius:14,boxShadow:"0 10px 34px rgba(0,0,0,0.4)",padding:"12px 14px"}}>
                <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>By due date</div>
                {timeByDue.length===0
                  ?<div style={{fontFamily:F.body,fontSize:12,color:T.textFaint}}>Nothing left to do</div>
                  :<div style={{display:"flex",flexDirection:"column",gap:7}}>
                    {timeByDue.map(b=>(
                      <div key={b.key} style={{display:"flex",alignItems:"center",gap:8}}>
                        <span style={{fontFamily:F.body,fontSize:12,color:b.key==="overdue"?"#FF4757":T.text,flex:1}}>{b.label}</span>
                        <span style={{fontFamily:F.body,fontSize:11,color:T.textMuted}}>{b.count} {b.count===1?"task":"tasks"}</span>
                        <span style={{fontFamily:F.body,fontSize:12,color:T.text,width:52,textAlign:"right"}}>{fmtMins(b.mins)}</span>
                      </div>
                    ))}
                  </div>}
                {timeBySubject.length>0&&<>
                  <div style={{height:1,background:T.borderFaint,margin:"12px 0"}}/>
                  <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>By subject</div>
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {timeBySubject.map(r=>{const c=r.name?(subjectColors[r.name]||T.accent):T.textMuted;return(
                      <div key={r.name}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{width:8,height:8,borderRadius:"50%",background:c,flexShrink:0}}/>
                          <span style={{fontFamily:F.body,fontSize:12,color:r.name?T.text:T.textMuted,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name||"No subject"}</span>
                          <span style={{fontFamily:F.body,fontSize:12,color:T.text,flexShrink:0}}>{fmtMins(r.mins)}</span>
                          <span style={{fontFamily:F.body,fontSize:11,color:T.textMuted,width:34,textAlign:"right",flexShrink:0}}>{r.pct}%</span>
                        </div>
                        <div style={{height:3,borderRadius:99,background:T.cardAlt,marginTop:5,marginLeft:16,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${r.pct}%`,background:c,borderRadius:99}}/>
                        </div>
                        {r.spent>0&&<div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:4,marginLeft:16}}>{fmtMins(r.spent)} worked of {fmtMins(r.mins)} planned</div>}
                      </div>
                    );})}
                  </div>
                </>}
                {noEstimateCount>0&&(
                  <button onClick={()=>{setFilter("noest");setActiveTab("tasks");setTimeMenuOpen(false);}} style={{display:"block",width:"100%",marginTop:12,background:"none",border:"none",padding:0,cursor:"pointer",textAlign:"left",fontFamily:F.body,fontSize:11,color:T.textMuted}}>
                    {noEstimateCount} {noEstimateCount===1?"task has":"tasks have"} no estimate, so the total is low. Show them ›
                  </button>
                )}
              </div>
            )}
          </div>
        </header>
        <div aria-hidden="true" style={{height:1,background:`linear-gradient(90deg,${T.accent},transparent)`,marginBottom:16}}/>

        <div className="app-body">
        <nav className="app-sidebar" aria-label="Main">
        {/* Tabs */}
        {/* touch-action:pan-y tells the browser this element only wants
            vertical touch gestures, not horizontal ones -- a hint some
            browsers factor into their own gesture-conflict resolution. It
            is genuinely the ceiling of what a webpage can do here: a
            browser's own chrome-level gesture (e.g. Arc's swipe-anywhere
            tab switcher) lives outside the page's DOM entirely, the same
            sandboxing that stops a page from closing the browser window or
            touching the address bar, so this can reduce but can't
            guarantee-eliminate a conflict with it. */}
        {(()=>{
          // Liquid-glass styling, modeled on Apple's iOS 26 tab bar: a
          // translucent, saturation-boosted blur for the bar itself, a
          // specular top-edge highlight + soft sheen gradient to give it
          // thickness, and a separate raised "lens" pill that slides between
          // tabs on a slightly springy curve instead of each button just
          // swapping its own background.
          // With the Liquid Glass setting off, this falls back to the original
          // flat pill: opaque surface, and each active button just gets its
          // own card-colored background (no sheen, no sliding lens).
          const dark=effectiveThemeMode==="dark";
          const tabIds=["tasks","calendar","focus"] as const;
          const activeIdx=tabIds.indexOf(activeTab as typeof tabIds[number]);
          return (
        <div className="tab-bar" style={!liquidGlass
          ?{position:"relative",display:"flex",gap:3,marginBottom:16,background:T.surface+"cc",backdropFilter:"blur(20px)",WebkitBackdropFilter:"blur(20px)",border:`1px solid ${T.border}`,borderRadius:999,padding:4,touchAction:"pan-y"}
          :{position:"relative",display:"flex",gap:0,marginBottom:16,padding:5,borderRadius:999,touchAction:"pan-y",
          background:dark?"rgba(38,38,38,0.45)":"rgba(255,255,255,0.55)",
          backdropFilter:"blur(24px) saturate(180%)",WebkitBackdropFilter:"blur(24px) saturate(180%)",
          border:`1px solid ${dark?"rgba(255,255,255,0.10)":"rgba(255,255,255,0.85)"}`,
          boxShadow:dark
            ?"inset 0 1px 0 rgba(255,255,255,0.14), inset 0 -1px 0 rgba(0,0,0,0.45), 0 10px 30px rgba(0,0,0,0.45), 0 1px 3px rgba(0,0,0,0.3)"
            :"inset 0 1px 0 rgba(255,255,255,1), inset 0 -1px 0 rgba(0,0,0,0.05), 0 10px 30px rgba(0,0,0,0.10), 0 1px 3px rgba(0,0,0,0.08)"}}>
          {liquidGlass&&<>
          <div className="glass-sheen" aria-hidden="true" style={{position:"absolute",inset:0,borderRadius:"inherit",pointerEvents:"none",
            background:`linear-gradient(180deg, rgba(255,255,255,${dark?0.07:0.5}) 0%, rgba(255,255,255,0) 55%)`}}/>
          <div className="glass-lens" aria-hidden="true" style={{position:"absolute",top:5,bottom:5,left:5,width:`calc((100% - 10px) / ${tabIds.length})`,borderRadius:999,pointerEvents:"none",
            background:dark?"rgba(255,255,255,0.12)":"rgba(255,255,255,0.92)",
            boxShadow:dark
              ?"inset 0 1px 0 rgba(255,255,255,0.22), inset 0 0 0 0.5px rgba(255,255,255,0.08), 0 2px 8px rgba(0,0,0,0.35)"
              :"inset 0 1px 0 #fff, 0 0 0 0.5px rgba(0,0,0,0.05), 0 3px 10px rgba(0,0,0,0.10)",
            transform:`translateX(${Math.max(activeIdx,0)*100}%)`,opacity:activeIdx<0?0:1,
            transition:"transform 0.45s cubic-bezier(.34,1.3,.64,1), opacity 0.2s"}}/>
          </>}
          {tabIds.map(id=>{
            const labels:Record<string,string>={tasks:"Tasks",calendar:"Calendar",focus:"Focus"};
            const icons:Record<string,()=>React.JSX.Element>={tasks:IconTasks,calendar:IconCalendar,focus:IconFocus};
            const Icon=icons[id];
            const active=activeTab===id;
            return <button key={id} data-tour={`tab-${id}`} className="glass-tab" onClick={()=>id==="focus"?setFocusModeAnimated(true):setActiveTab(id)} aria-label={labels[id]} aria-pressed={id==="focus"?false:active} title={labels[id]}
              style={{position:"relative",zIndex:1,flex:1,display:"flex",alignItems:"center",justifyContent:"center",background:!liquidGlass&&active?T.card:"transparent",color:active?T.accent:T.textMuted,border:"none",borderRadius:999,padding:"10px 0",cursor:"pointer",transition:"color 0.2s, transform 0.18s cubic-bezier(.34,1.4,.64,1)"}}>
              <Icon/>
              {id==="focus"&&pomodoroActive&&<span style={{marginLeft:6,fontSize:11,fontVariantNumeric:"tabular-nums"}}>{String(pomMin).padStart(2,"0")}:{String(pomSec).padStart(2,"0")}</span>}
            </button>;
          })}
        </div>
          );
        })()}
        </nav>
        <main className="app-main" style={selectionMode?{paddingBottom:130}:undefined}>

        {/* TASKS TAB */}
        {activeTab==="tasks"&&<>
          {/* Suggestion -- hidden once there's no pending homework left (nothing
              to suggest), when turned off in Settings, or when its × hid this
              particular suggestion (see hiddenSuggestionFor). */}
          {topTask&&(showSuggestion&&hiddenSuggestionFor!==topTask.id?(
            <div style={{background:T.gradientCard,borderRadius:12,padding:"10px 12px",marginBottom:16,border:`1px solid ${T.accent}33`,position:"relative",overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:7,minWidth:0}}>
                  <span aria-hidden="true" style={{fontSize:12,marginTop:1}}>✦</span>
                  <span style={{fontFamily:F.body,fontSize:12,color:T.text,lineHeight:1.4,whiteSpace:"pre-line"}}>{suggestion}</span>
                </div>
                <button onClick={()=>setHiddenSuggestionFor(topTask.id)} aria-label="Hide this suggestion" title="Hide for now. It comes back when another task becomes most urgent" style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:16,lineHeight:1,padding:"0 2px",flexShrink:0}}>×</button>
              </div>
            </div>
          ):null)}

          {/* Search */}
          {/* Opens the floating search panel (SearchOverlay); hidden while it's
              open, so the bar looks like it lifted off from here. */}
          <button ref={searchTriggerRef} data-tour="search" onClick={()=>setSearchOpen(true)} aria-haspopup="dialog" aria-expanded={searchOpen}
            style={{display:"flex",alignItems:"center",gap:9,width:"100%",marginBottom:10,background:T.card,border:`1px solid ${T.border}`,borderRadius:10,color:T.textFaint,padding:"0 13px",height:42,fontFamily:F.body,fontSize:13,cursor:"text",textAlign:"left",visibility:searchOpen?"hidden":undefined}}>
            <IconSearch/>Search tasks...
          </button>

          {/* Filters + layout picker */}
          <div style={{display:"flex",gap:6,marginBottom:12,alignItems:"center",flexWrap:"wrap"}}>
            {["all","pending","done","archived"].map(f=><button key={f} onClick={()=>{if(f!==filter)captureTaskRects();setFilter(f);}} aria-pressed={filter===f} style={{background:filter===f?T.accent:"none",color:filter===f?contrastColor(T.accent):T.textMuted,border:`1px solid ${filter===f?T.accent:T.border}`,borderRadius:999,padding:"4px 12px",fontFamily:F.body,fontSize:11,cursor:"pointer"}}>{f[0].toUpperCase()+f.slice(1)}</button>)}
            {filter==="noest"&&<button onClick={()=>{captureTaskRects();setFilter("all");}} aria-label="Clear no-estimate filter" style={{background:T.accent,color:contrastColor(T.accent),border:`1px solid ${T.accent}`,borderRadius:999,padding:"4px 12px",fontFamily:F.body,fontSize:11,cursor:"pointer"}}>No estimate ×</button>}
            {selectionMode&&(()=>{
              const ids=filteredTasks.map(t=>t.id), all=ids.length>0&&ids.every(id=>selectedIds.includes(id));
              return <button onClick={()=>setSelectedIds(all?[]:ids)} style={{background:"none",border:`1px solid ${T.border}`,color:T.textMuted,borderRadius:999,padding:"4px 12px",fontFamily:F.body,fontSize:11,cursor:"pointer"}}>{all?"Select none":`Select all (${ids.length})`}</button>;
            })()}
            {(selectionMode
              ? <button onClick={exitSelectionMode} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:999,padding:"4px 12px",fontFamily:F.body,fontSize:11,cursor:"pointer"}}>Cancel</button>
              : <button data-tour="select" onClick={()=>setSelectionMode(true)} style={{background:"none",border:`1px solid ${T.border}`,color:T.textMuted,borderRadius:999,padding:"4px 12px",fontFamily:F.body,fontSize:11,cursor:"pointer"}}>Select</button>
            )}
            <div style={{marginLeft:"auto",fontFamily:F.body,fontSize:10,color:T.textFaint}}>{visibleTasks.filter(t=>!t.done&&!t.archived).length} pending</div>
          </div>

          {renderTasks(filteredTasks)}
          {filteredTasks.length===0&&<div style={{textAlign:"center",color:T.textFaint,fontFamily:F.body,fontSize:12,padding:"32px 0"}}>{filter==="archived"?"No archived tasks":filter==="done"?"No completed tasks yet":filter==="pending"?"Nothing pending. Nice work!":filter==="noest"?"Every open task has an estimate":"Nothing here yet. Add some homework below"}</div>}
          <div style={{marginTop:14}}>
            {!adding?(
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10,paddingTop:10}}>
                <button data-tour="add" onClick={startAdding} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:14,padding:"13px 28px",fontFamily:F.heading,fontSize:17,cursor:"pointer",boxShadow:`0 4px 20px ${T.accentGlow}`,transition:"all 0.2s"}}>+ Add homework</button>
                {templates.length>0&&<div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,textTransform:"uppercase",letterSpacing:"0.08em"}}>or start from a template</div>}
                {templates.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:6,justifyContent:"center",maxWidth:340}}>
                  {templates.map(tpl=>(
                    <span key={tpl.id} style={{display:"inline-flex",alignItems:"center",background:T.card,border:`1px solid ${T.border}`,borderRadius:999}}>
                      <button onClick={()=>startFromTemplate(tpl)} title={`New task from template "${tpl.name}"`} style={{background:"none",border:"none",color:T.textMuted,cursor:"pointer",padding:"7px 4px 7px 14px",fontSize:12}}>{tpl.name}</button>
                      <button onClick={()=>setTemplates(prev=>prev.filter(x=>x.id!==tpl.id))} aria-label={`Delete template "${tpl.name}"`} title="Delete template" style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",padding:"7px 12px 7px 4px",fontSize:13,lineHeight:1}}>×</button>
                    </span>
                  ))}
                </div>}
              </div>
            ):(
              <div style={{background:T.card,borderRadius:16,padding:"18px",border:`1px solid ${T.borderAccent}`,position:"relative"}}>
                <button onClick={()=>setAdding(false)} aria-label="Cancel" title="Cancel" style={{position:"absolute",top:10,right:10,background:"none",border:"none",color:T.textFaint,fontSize:20,lineHeight:1,cursor:"pointer",padding:4}}>×</button>
                <div style={{display:"flex",gap:5,marginBottom:14,justifyContent:"center"}}>
                  {[...Array(askQuestions.length+1)].map((_,i)=><div key={i} style={{width:i===step+1?20:6,height:6,borderRadius:999,background:i<=step+1?T.accent:T.border,transition:"all 0.3s"}}/>)}
                </div>
                <div>
                  {step===-1?(
                    <div>
                      <div style={{fontFamily:F.heading,fontSize:17,marginBottom:12,color:T.accent}}>What's the assignment?</div>
                      <form onSubmit={handleTitleSubmit} style={{display:"flex",gap:8}}>
                        <input ref={inputRef} aria-label="What's the assignment?" defaultValue={newTask.title||""} maxLength={500} placeholder="e.g. Chapter 3 reading..." autoFocus style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,color:T.text,padding:"10px 13px",fontFamily:F.body,fontSize:13,flex:1,outline:"none"}}/>
                        <button type="submit" aria-label="Next" style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:10,padding:"10px 16px",cursor:"pointer"}}>→</button>
                      </form>
                    </div>
                  ):currentQ?(
                    <div>
                      <div style={{fontFamily:F.heading,fontSize:17,marginBottom:12,color:T.accent}}>{currentQ.label}</div>
                      {currentQ.type==="select"&&<div style={{display:"flex",flexWrap:"wrap",gap:7}}>{subjects.map(opt=><button key={opt} className="chip" style={{background:subjectColors[opt]?subjectColors[opt]+"22":T.cardAlt,color:subjectColors[opt]||T.text,border:`1px solid ${subjectColors[opt]||T.border}`}} onClick={()=>handleAnswer(opt)}>{opt}</button>)}</div>}
                      {currentQ.type==="date"&&(pendingDueDate===null?(
                        <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                          {[{l:"Today",d:0},{l:"Tomorrow",d:1},{l:"3 days",d:3},{l:"Next week",d:7}].map(({l,d})=>{const dt=new Date();dt.setDate(dt.getDate()+d);return<button key={l} className="chip" style={{background:T.cardAlt,color:T.text,border:`1px solid ${T.border}`}} onClick={()=>handleDateInput(localDateStr(dt))}>{l}</button>;})}
                          <input ref={inputRef} aria-label={currentQ?.label} type="date" defaultValue="" onChange={e=>{inputValRef.current=e.target.value;}} onKeyDown={e=>e.key==="Enter"&&inputRef.current?.value&&handleDateInput(inputRef.current.value)} style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,color:T.text,padding:"7px 11px",fontFamily:F.body,fontSize:12,flex:1,minWidth:120,outline:"none"}}/>
                          <button style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:10,padding:"7px 13px",cursor:"pointer"}} onClick={()=>inputRef.current?.value&&handleDateInput(inputRef.current.value)}>→</button>
                        </div>
                      ):(
                        <div>
                          <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginBottom:10}}>Due {formatDate(pendingDueDate)}. What time?</div>
                          <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:12}}>
                            {[{l:"Any time",v:""},{l:formatTime("09:00",h24),v:"09:00"},{l:formatTime("15:00",h24),v:"15:00"},{l:formatTime("23:59",h24),v:"23:59"}].map(({l,v})=>(
                              <button key={l} className="chip" style={{background:T.cardAlt,color:T.text,border:`1px solid ${T.border}`}} onClick={()=>confirmDueTime(v)}>{l}</button>
                            ))}
                          </div>
                          <div style={{display:"flex",gap:7}}>
                            <input ref={inputRef} aria-label={currentQ?.label} type="time" defaultValue="" style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:10,color:T.text,padding:"7px 11px",fontFamily:F.body,fontSize:12,flex:1,outline:"none"}}/>
                            <button style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:10,padding:"7px 13px",cursor:"pointer"}} onClick={()=>confirmDueTime(inputRef.current?.value||"")}>→</button>
                          </div>
                          <button onClick={()=>setPendingDueDate(null)} style={{background:"none",border:"none",color:T.textFaint,fontFamily:F.body,fontSize:11,cursor:"pointer",marginTop:10,padding:0}}>‹ Back to date</button>
                        </div>
                      ))}
                      {currentQ.type==="time"&&(
                        <div>
                          {/* Quick picks */}
                          <div style={{display:"flex",flexWrap:"wrap",gap:7,marginBottom:14}}>
                            {[{l:"15 min",m:15},{l:"30 min",m:30},{l:"45 min",m:45},{l:"1 hour",m:60},{l:"1.5 hrs",m:90},{l:"2 hrs",m:120}].map(({l,m})=>(
                              <button key={l} className="chip" onClick={()=>handleAnswer(String(m))}
                                style={{background:T.cardAlt,color:T.text,border:`1px solid ${T.border}`}}>{l}</button>
                            ))}
                          </div>
                          {/* Custom time picker */}
                          <div style={{background:T.surface,borderRadius:12,padding:"14px",border:`1px solid ${T.border}`}}>
                            <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.08em"}}>Custom time</div>
                            <div style={{display:"flex",alignItems:"center",gap:8,justifyContent:"center"}}>
                              {/* Hours */}
                              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                                <button onClick={()=>setTimeHours(h=>Math.min(23,h+1))} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:7,width:36,height:28,cursor:"pointer",color:T.text,fontSize:14}}>▲</button>
                                <div style={{fontFamily:F.heading,fontSize:28,color:T.text,minWidth:44,textAlign:"center",lineHeight:1}}>{String(timeHours).padStart(2,"0")}</div>
                                <button onClick={()=>setTimeHours(h=>Math.max(0,h-1))} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:7,width:36,height:28,cursor:"pointer",color:T.text,fontSize:14}}>▼</button>
                                <div style={{fontFamily:F.body,fontSize:9,color:T.textFaint}}>hrs</div>
                              </div>
                              <div style={{fontFamily:F.heading,fontSize:28,color:T.textMuted,marginBottom:16}}>:</div>
                              {/* Minutes */}
                              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                                <button onClick={()=>setTimeMins(m=>m>=55?0:m+5)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:7,width:36,height:28,cursor:"pointer",color:T.text,fontSize:14}}>▲</button>
                                <div style={{fontFamily:F.heading,fontSize:28,color:T.text,minWidth:44,textAlign:"center",lineHeight:1}}>{String(timeMins).padStart(2,"0")}</div>
                                <button onClick={()=>setTimeMins(m=>m<=0?55:m-5)} style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:7,width:36,height:28,cursor:"pointer",color:T.text,fontSize:14}}>▼</button>
                                <div style={{fontFamily:F.body,fontSize:9,color:T.textFaint}}>min</div>
                              </div>
                            </div>
                            {/* Preview + confirm */}
                            <div style={{marginTop:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                              <div style={{fontFamily:F.body,fontSize:12,color:T.textMuted}}>
                                {formatDuration(timeHours*60+timeMins)||"Pick a duration"}
                              </div>
                              <button onClick={()=>handleAnswer(String(timeHours*60+timeMins))} disabled={timeHours*60+timeMins===0}
                                style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:9,padding:"8px 18px",fontFamily:F.body,fontSize:12,cursor:timeHours*60+timeMins===0?"default":"pointer",opacity:timeHours*60+timeMins===0?0.4:1,fontWeight:500}}>
                                Set time →
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                      {currentQ.type==="recurrence"&&<div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                        {[{l:"Doesn't repeat",v:"none"},{l:"Daily",v:"daily"},{l:"Weekly",v:"weekly"},{l:"Monthly",v:"monthly"}].map(({l,v})=>(
                          <button key={v} className="chip" style={{background:T.cardAlt,color:T.text,border:`1px solid ${T.border}`}} onClick={()=>handleAnswer(v)}>{l}</button>
                        ))}
                      </div>}
                    </div>
                  ):null}
                  {newTask.title&&<div style={{marginTop:12,padding:"9px 13px",background:T.bg,borderRadius:10,border:`1px solid ${T.border}`}}>
                    <div style={{fontFamily:F.body,fontSize:9,color:T.textFaint,marginBottom:2}}>Adding</div>
                    <div style={{fontFamily:F.heading,fontSize:14,color:T.text}}>{newTask.title}</div>
                    <div style={{display:"flex",gap:8,marginTop:3,flexWrap:"wrap"}}>
                      {newTask.subject&&<span style={{color:ink(subjectColors[newTask.subject]||T.accent,T.light),fontFamily:F.body,fontSize:10}}>{newTask.subject}</span>}
                      {newTask.dueDate&&<span style={{color:T.textMuted,fontFamily:F.body,fontSize:10}}>{formatDate(newTask.dueDate)}{newTask.dueTime?` at ${formatTime(newTask.dueTime,h24)}`:""}</span>}
                      {newTask.recurrence&&newTask.recurrence!=="none"&&<span style={{color:T.textMuted,fontFamily:F.body,fontSize:10}}>↻ {newTask.recurrence}</span>}
                    </div>
                  </div>}
                </div>
                {step>-1&&<div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginTop:16}}>
                  <button onClick={goBackStep} aria-label="Go back" title="Go back" style={{background:T.cardAlt,border:`1px solid ${T.border}`,color:T.textMuted,fontSize:15,cursor:"pointer",padding:"7px 16px",borderRadius:10}}>‹ Back</button>
                  <button onClick={goForwardStep} aria-label="Skip" title="Skip" style={{background:T.cardAlt,border:`1px solid ${T.border}`,color:T.textMuted,fontSize:15,cursor:"pointer",padding:"7px 16px",borderRadius:10}}>Skip ›</button>
                </div>}
              </div>
            )}
          </div>
        </>}

        {/* OPTIONS TAB */}
        {/* CALENDAR TAB */}
        {activeTab==="calendar"&&<CalendarView tasks={tasks} T={T} F={F} subjectColors={subjectColors} colorCodeUrgency={colorCodeUrgency}
          weekStart={weekStart} h24={h24} now={now}
          onOpenTask={t=>setSelectedTask(t)} onToggleDone={toggleDone} onAddOn={addHomeworkOn}/>}
        {/* Inbox, History and Import/Export: full screens opened from the title
            menu, like Settings (they used to be dropdowns inside the menu). */}
        {activeTab==="inbox"&&(
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <ScreenHeader title="Inbox" onBack={()=>setActiveTab("tasks")} T={T} F={F}/>
            <SettingsSection {...inboxSec("inbox-messages")} title={`Messages${recapItems.length?` (${recapItems.length})`:""}`}>
                      <div style={{display:"flex",flexDirection:"column",gap:12}}>
                        {recapItems.length===0
                          ? <div style={{fontFamily:F.body,fontSize:11,color:T.textFaint,lineHeight:1.5}}>No messages yet. A recap arrives here when a day, week, month or year ends, if you finished or worked on something in it.</div>
                          : recapItems.map(item=>{
                          const unread=unreadRecaps.includes(item.id);
                          return (
                          <div key={item.id} style={{display:"flex",gap:4,alignItems:"flex-start"}}>
                            <button data-update-id={item.id} onClick={e=>openMessage(item.id,e.currentTarget)} aria-haspopup="dialog" aria-label={`${unread?"Unread: ":""}${item.headline}, ${formatDate(item.date)}`}
                              style={{flex:1,minWidth:0,background:"none",border:"none",borderRadius:8,padding:"4px 6px",margin:"-4px -6px",cursor:"pointer",textAlign:"left",color:"inherit",visibility:openUpdate?.id===item.id&&!openUpdate.closing?"hidden":undefined}}>
                              <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:8}}>
                                <span style={{fontFamily:F.body,fontSize:12,fontWeight:600,color:T.accent}}>
                                  {unread&&<span aria-hidden="true" style={{display:"inline-block",width:7,height:7,borderRadius:"50%",background:T.accent,marginRight:7,verticalAlign:"middle"}}/>}
                                  {item.headline}
                                </span>
                                <span style={{fontFamily:F.body,fontSize:10,color:T.textFaint,flexShrink:0}}>{formatDate(item.date)}</span>
                              </div>
                              <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:1}}>{item.kind}</div>
                              <div className="clamp2" style={{fontFamily:F.body,fontSize:11,color:unread?T.text:T.textMuted,marginTop:2,lineHeight:1.4}}>{item.description}</div>
                            </button>
                            <button onClick={()=>dismissMessage(item.id)} aria-label={`Dismiss ${item.headline}`} title="Dismiss" style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:14,lineHeight:1,padding:"0 0 0 2px",flexShrink:0}}>×</button>
                          </div>
                          );})}
                      </div>
            </SettingsSection>
            <SettingsSection {...inboxSec("inbox-updates")} title={`Updates${whatsNew.length?` (${whatsNew.length})`:""}`}>
                      {/* Filter by the update's kind, same chips as the Tasks tab's filters */}
                      {updateKinds.length>1&&<div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
                        {["all",...updateKinds].map(k=><button key={k} onClick={()=>setUpdateKind(k)} aria-pressed={activeKind===k} style={{background:activeKind===k?T.accent:"none",color:activeKind===k?contrastColor(T.accent):T.textMuted,border:`1px solid ${activeKind===k?T.accent:T.border}`,borderRadius:999,padding:"4px 12px",fontFamily:F.body,fontSize:11,cursor:"pointer"}}>{k==="all"?"All":k}</button>)}
                      </div>}
                      <div style={{display:"flex",flexDirection:"column",gap:12}}>
                        {shownUpdates.length===0
                          ? <div style={{fontFamily:F.body,fontSize:11,color:T.textFaint}}>Nothing here</div>
                          : shownUpdates.map(item=>(
                          <div key={item.id} style={{display:"flex",gap:4,alignItems:"flex-start"}}>
                            {/* Opens the update in a floating panel (UpdateDetail); hidden
                                while open, so the panel looks like it grew out of here. */}
                            <button data-update-id={item.id} onClick={e=>setOpenUpdate({id:item.id,origin:e.currentTarget})} aria-haspopup="dialog"
                              style={{flex:1,minWidth:0,background:"none",border:"none",borderRadius:8,padding:"4px 6px",margin:"-4px -6px",cursor:"pointer",textAlign:"left",color:"inherit",visibility:openUpdate?.id===item.id&&!openUpdate.closing?"hidden":undefined}}>
                              <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:8}}>
                                <span style={{fontFamily:F.body,fontSize:12,fontWeight:600,color:T.accent}}>{item.headline}</span>
                                <span style={{fontFamily:F.body,fontSize:10,color:T.textFaint,flexShrink:0}}>{formatDate(item.date)}</span>
                              </div>
                              <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:1}}>{item.kind}</div>
                              <div className="clamp2" style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginTop:2,lineHeight:1.4}}>{item.description}</div>
                            </button>
                            <button onClick={()=>dismissWhatsNew(item.id)} aria-label={`Dismiss ${item.headline}`} title="Dismiss" style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:14,lineHeight:1,padding:"0 0 0 2px",flexShrink:0}}>×</button>
                          </div>
                        ))}
                      </div>
            </SettingsSection>
          </div>
        )}
        {activeTab==="history"&&(
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <ScreenHeader title="History" onBack={()=>setActiveTab("tasks")} T={T} F={F}/>
            <div data-tour="undo-redo" style={{background:T.card,borderRadius:12,padding:"14px",border:`1px solid ${T.border}`}}>
                      <div style={{display:"flex",gap:8}}>
                        <button onClick={undo} disabled={undoStack.length===0} title={undoStack.length?`Undo: ${describeAction(undoStack[undoStack.length-1])}`:"Nothing to undo"} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,background:T.cardAlt,border:`1px solid ${T.border}`,borderRadius:9,padding:"8px 0",cursor:undoStack.length?"pointer":"default",opacity:undoStack.length?1:0.4,color:T.text,fontFamily:F.body,fontSize:12}}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-1"/></svg>
                          Undo
                        </button>
                        <button onClick={redo} disabled={redoStack.length===0} title={redoStack.length?`Redo: ${describeAction(redoStack[redoStack.length-1])}`:"Nothing to redo"} style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:6,background:T.cardAlt,border:`1px solid ${T.border}`,borderRadius:9,padding:"8px 0",cursor:redoStack.length?"pointer":"default",opacity:redoStack.length?1:0.4,color:T.text,fontFamily:F.body,fontSize:12}}>
                          Redo
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 14 20 9l-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h1"/></svg>
                        </button>
                      </div>
            </div>
            <div style={{background:T.card,borderRadius:12,padding:"14px",border:`1px solid ${T.border}`}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
                        <span data-tour="trash" style={{fontFamily:F.body,fontSize:11,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.06em"}}>Recently deleted{trash.length?` (${trash.length})`:""}</span>
                        {trash.length>0&&<button onClick={()=>{if(confirmEmptyTrash){setTrash([]);setConfirmEmptyTrash(false);}else setConfirmEmptyTrash(true);}} onBlur={()=>setConfirmEmptyTrash(false)} title={confirmEmptyTrash?"Tap again to delete these for good":"Delete everything here for good"} style={{background:confirmEmptyTrash?"#FF475722":"none",border:"none",borderRadius:6,color:confirmEmptyTrash?"#FF4757":T.textFaint,fontSize:11,cursor:"pointer",padding:confirmEmptyTrash?"2px 8px":0}}>{confirmEmptyTrash?"Delete for good?":"Empty"}</button>}
                      </div>
                      {trash.length===0
                        ? <div style={{fontFamily:F.body,fontSize:11,color:T.textFaint}}>Nothing here. Deleted tasks stay for 30 days.</div>
                        : <div style={{display:"flex",flexDirection:"column",gap:4}}>
                          {trash.map(e=>(
                            <div key={e.task.id} style={{display:"flex",alignItems:"center",gap:8,background:T.surface,borderRadius:8,padding:"6px 8px"}}>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontFamily:F.body,fontSize:12,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.task.title}</div>
                                <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint}}>Deleted {formatDate(localDateStr(new Date(e.deletedAt)))}</div>
                              </div>
                              <button onClick={()=>restoreFromTrash(e.task.id)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:7,color:T.text,fontSize:11,cursor:"pointer",padding:"4px 10px",flexShrink:0}}>Restore</button>
                            </div>
                          ))}
                        </div>}
            </div>
          </div>
        )}
        {activeTab==="import"&&(
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            <ScreenHeader title="Import/Export" onBack={()=>setActiveTab("tasks")} T={T} F={F}/>
            <div style={{background:T.card,borderRadius:12,padding:"14px",border:`1px solid ${T.border}`}}>
                      <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Import from Syllabus</div>
                      <div style={{fontFamily:F.body,fontSize:11,color:T.textFaint,marginBottom:10,lineHeight:1.5}}>
                        Paste your syllabus below. Lines with a date (e.g. "Sept 20", "9/20", "2026-09-20") are picked up as assignments. Review and uncheck anything that isn't one before adding.
                      </div>
                      <textarea
                        value={importText}
                        onChange={e=>{setImportText(e.target.value);setImportPreview(null);setImportedCount(null);}}
                        placeholder="Paste your syllabus text here..."
                        style={{width:"100%",minHeight:100,maxHeight:200,background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,color:T.text,padding:"10px 12px",fontFamily:F.body,fontSize:13,outline:"none",resize:"vertical",overflowY:"auto",marginBottom:10}}
                      />
                      <div style={{marginBottom:10}}>
                        <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>Add as subject</div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
                          {subjects.map(s=>{
                            const active=importSubjectEff===s;
                            return <button key={s} className="chip" onClick={()=>setImportSubject(s)} style={{background:active?(subjectColors[s]||T.accent)+"33":"none",color:active?(subjectColors[s]||T.accent):T.textMuted,border:`1.5px solid ${active?(subjectColors[s]||T.accent):T.border}`}}>{s}</button>;
                          })}
                        </div>
                      </div>
                      <button onClick={scanSyllabus} disabled={!importText.trim()} style={{width:"100%",background:importText.trim()?T.accent:T.surface,color:importText.trim()?contrastColor(T.accent):T.textFaint,border:"none",borderRadius:10,padding:"11px",fontFamily:F.body,fontSize:13,fontWeight:500,cursor:importText.trim()?"pointer":"default"}}>
                        Scan for assignments
                      </button>
                      {importedCount!==null&&<div style={{fontFamily:F.body,fontSize:12,color:ink("#2ED573",T.light),marginTop:10,textAlign:"center"}}>✓ Added {importedCount} task{importedCount===1?"":"s"}</div>}
                      {importPreview&&(
                        <div style={{marginTop:12}}>
                          <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginBottom:8}}>
                            Found {importPreview.length} assignment{importPreview.length===1?"":"s"}
                          </div>
                          {importPreview.length===0?(
                            <div style={{textAlign:"center",color:T.textFaint,fontFamily:F.body,fontSize:12,padding:"16px 0"}}>No dated lines found. Try a different format.</div>
                          ):(<>
                            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12,maxHeight:200,overflowY:"auto"}}>
                              {importPreview.map((it,i)=>(
                                <div key={i} role="checkbox" aria-checked={it.checked} tabIndex={0} onClick={()=>toggleImportItem(i)} onKeyDown={e=>{if(e.key===" "||e.key==="Enter"){e.preventDefault();toggleImportItem(i);}}} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 11px",background:T.surface,borderRadius:9,cursor:"pointer",opacity:it.checked?1:0.45}}>
                                  <div style={{width:18,height:18,border:`2px solid ${it.checked?T.accent:T.textFaint}`,borderRadius:5,background:it.checked?T.accent:"none",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                                    {it.checked&&<span style={{color:contrastColor(T.accent),fontSize:11,fontWeight:"bold"}}>✓</span>}
                                  </div>
                                  <div style={{flex:1,minWidth:0}}>
                                    <div style={{fontFamily:F.body,fontSize:12,color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{it.title}</div>
                                    {it.dueDate&&<div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:1}}>{formatDate(it.dueDate)}</div>}
                                  </div>
                                </div>
                              ))}
                            </div>
                            <button onClick={commitImport} disabled={!importPreview.some(it=>it.checked)} style={{width:"100%",background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:10,padding:"11px",fontFamily:F.body,fontSize:13,fontWeight:500,cursor:"pointer"}}>
                              + Add {importPreview.filter(it=>it.checked).length} task{importPreview.filter(it=>it.checked).length===1?"":"s"}
                            </button>
                          </>)}
                        </div>
                      )}
            </div>
            <div style={{background:T.card,borderRadius:12,padding:"14px",border:`1px solid ${T.border}`}}>
                      <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:8}}>Backup &amp; export</div>
                      <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                        <button data-tour="import-backup" onClick={()=>importFileRef.current?.click()} style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,padding:"9px 4px",cursor:"pointer",color:T.textMuted,fontFamily:F.body,fontSize:11}}>Import backup (JSON)</button>
                        <input ref={importFileRef} type="file" accept="application/json,.json" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)importBackupJSON(f);e.target.value="";}}/>
                        <button onClick={exportAllDataJSON} style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,padding:"9px 4px",cursor:"pointer",color:T.textMuted,fontFamily:F.body,fontSize:11}}>Export all (JSON)</button>
                        <button onClick={exportTasksCSV} style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,padding:"9px 4px",cursor:"pointer",color:T.textMuted,fontFamily:F.body,fontSize:11}}>Export tasks (CSV)</button>
                      </div>
                      {importBackupNote&&<div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginTop:8}}>{importBackupNote}</div>}
            </div>
          </div>
        )}
        {activeTab==="options"&&(
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {/* Settings is opened from the title menu, not the tab bar, so it
                names itself and offers a way back instead of leaving the tab
                bar with nothing highlighted and no hint where you are. */}
            <ScreenHeader title="Settings" onBack={()=>setActiveTab("tasks")} T={T} F={F}/>

            {/* Looks */}
            <SettingsSection title="Looks" gap={20} {...sec("looks")}>
              {/* Appearance mode */}
              <div>
                <div className="sl" style={{color:T.textMuted,paddingTop:0}}>Appearance</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7}}>
                  {([{k:"light",l:"Light",e:"○"},{k:"dark",l:"Dark",e:"●"},{k:"auto",l:"System",e:"◐"}] as const).map(({k,l,e})=>(
                    <button key={k} onClick={()=>setThemeMode(k)} aria-pressed={themeMode===k} style={{background:themeMode===k?T.accent+"22":T.surface,border:`1.5px solid ${themeMode===k?T.accent:T.border}`,borderRadius:9,padding:"9px 8px",cursor:"pointer",color:themeMode===k?T.accent:T.textMuted,fontFamily:F.body,fontSize:11,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                      <span style={{fontSize:15}}>{e}</span>
                      <span style={{fontWeight:500}}>{l}</span>
                    </button>
                  ))}
                </div>
                {themeMode==="auto"&&<div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:8,textAlign:"center"}}>Following your device, currently {effectiveThemeMode}</div>}
              </div>
              {/* Layouts */}
              <div data-tour="layout">
                <div className="sl" style={{color:T.textMuted,paddingTop:0}}>Layout ({Object.keys(LAYOUTS).length})</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7}}>
                  {(Object.entries(LAYOUTS) as [LayoutName,{name:string;emoji:string;desc:string}][]).map(([key,l])=>{
                    const active=layout===key;
                    const ic=T.accent;
                    const dim=active?ic:T.textFaint;
                    const icons:Record<string,React.JSX.Element>={
                      list:<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="4" width="18" height="3" rx="1.5" fill={dim}/><rect x="2" y="9.5" width="18" height="3" rx="1.5" fill={dim}/><rect x="2" y="15" width="18" height="3" rx="1.5" fill={dim}/></svg>,
                      board:<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="2" width="8" height="8" rx="2" fill={dim}/><rect x="12" y="2" width="8" height="8" rx="2" fill={dim}/><rect x="2" y="12" width="8" height="8" rx="2" fill={dim}/><rect x="12" y="12" width="8" height="8" rx="2" fill={dim}/></svg>,
                      checklist:<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="4" width="5" height="5" rx="1.5" stroke={dim} strokeWidth="1.5"/><path d="M3.5 6.5l1.2 1.2L6.5 5" stroke={active?ic:T.textFaint} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/><rect x="9" y="5.5" width="11" height="2" rx="1" fill={dim}/><rect x="2" y="13" width="5" height="5" rx="1.5" stroke={dim} strokeWidth="1.5"/><rect x="9" y="14.5" width="11" height="2" rx="1" fill={dim}/></svg>,
                      kanban:<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="2" width="5" height="18" rx="1.5" fill={dim} opacity="0.4"/><rect x="9" y="2" width="5" height="13" rx="1.5" fill={dim} opacity="0.7"/><rect x="16" y="2" width="5" height="9" rx="1.5" fill={dim}/></svg>,
                      progress:<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="2" y="4" width="18" height="3.5" rx="1.75" fill={dim} opacity="0.2"/><rect x="2" y="4" width="14" height="3.5" rx="1.75" fill={dim}/><rect x="2" y="10" width="18" height="3.5" rx="1.75" fill={dim} opacity="0.2"/><rect x="2" y="10" width="9" height="3.5" rx="1.75" fill={dim}/><rect x="2" y="16" width="18" height="3.5" rx="1.75" fill={dim} opacity="0.2"/><rect x="2" y="16" width="16" height="3.5" rx="1.75" fill={dim}/></svg>,
                      pyramid:<svg width="22" height="22" viewBox="0 0 22 22" fill="none"><rect x="7" y="3" width="8" height="4" rx="1.5" fill={dim}/><rect x="4" y="9" width="14" height="4" rx="1.5" fill={dim} opacity="0.7"/><rect x="1" y="15" width="20" height="4" rx="1.5" fill={dim} opacity="0.4"/></svg>,
                    };
                    return(
                      <button key={key} aria-pressed={active} onClick={()=>setLayout(key)}
                        style={{background:active?T.accent+"22":"none",border:`1.5px solid ${active?T.accent:T.border}`,borderRadius:11,padding:"10px 7px",cursor:"pointer",color:active?T.accent:T.textMuted,fontFamily:F.body,fontSize:11,display:"flex",flexDirection:"column",alignItems:"center",gap:5,transition:"all 0.14s"}}>
                        {icons[key]}
                        <span style={{fontWeight:500,fontSize:10}}>{l.name}</span>
                        <span style={{fontSize:9,opacity:0.6}}>{l.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Desktop layout */}
              <div>
                <div className="sl" style={{color:T.textMuted,paddingTop:0}}>Desktop Layout</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7}}>
                  {[{k:"narrow",l:"Narrow",d:"Centered column"},{k:"wide",l:"Wide",d:"Roomier column"},{k:"sidebar",l:"Sidebar",d:"Nav on the left"}].map(({k,l,d})=>(
                    <button key={k} onClick={()=>setDesktopLayout(k)} aria-pressed={desktopLayout===k} style={{background:desktopLayout===k?T.accent+"22":T.surface,border:`1.5px solid ${desktopLayout===k?T.accent:T.border}`,borderRadius:9,padding:"9px 8px",cursor:"pointer",color:desktopLayout===k?T.accent:T.textMuted,fontFamily:F.body,fontSize:11,display:"flex",flexDirection:"column",alignItems:"center",gap:2,textAlign:"center"}}>
                      <span style={{fontWeight:500}}>{l}</span>
                      <span style={{fontSize:9,opacity:0.7}}>{d}</span>
                    </button>
                  ))}
                </div>
                <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:8,textAlign:"center"}}>
                  Only changes anything on wider screens. Phones always get the narrow view
                </div>
              </div>
              {/* Urgency color coding */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                <div><div className="sl" style={{color:T.textMuted,paddingTop:0}}>Urgency Color Coding</div><div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:-4}}>Red for urgent, green for not urgent</div></div>
                <Toggle on={colorCodeUrgency} onChange={setColorCodeUrgency} T={T} label="Urgency Color Coding"/>
              </div>
              {/* Liquid glass */}
              <div data-tour="liquid-glass" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                <div><div className="sl" style={{color:T.textMuted,paddingTop:0}}>Liquid Glass</div><div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:-4}}>Translucent, glassy cards and tab bar</div></div>
                <Toggle on={liquidGlass} onChange={setLiquidGlass} T={T} label="Liquid Glass"/>
              </div>
              {/* Animation speed */}
              <div data-tour="anim-speed">
                <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:10}}>
                  <label htmlFor="anim-speed" className="sl" style={{color:T.textMuted,paddingTop:0}}>Animation speed</label>
                  <span style={{fontFamily:F.body,fontSize:11,color:T.text}}>{animSpeed}×{animSpeed===1?" (normal)":""}</span>
                </div>
                <input id="anim-speed" type="range" min={ANIM_SPEED.min} max={ANIM_SPEED.max} step={ANIM_SPEED.step} value={animSpeed}
                  onChange={e=>setAnimSpeed(clampSpeed(e.target.value))} aria-valuetext={`${animSpeed} times normal speed`}
                  style={{width:"100%",accentColor:T.accent,margin:"2px 0 4px",cursor:"pointer"}}/>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",fontFamily:F.body,fontSize:10,color:T.textFaint}}>
                  <span>Slower</span>
                  {animSpeed!==1&&<button onClick={()=>setAnimSpeed(1)} style={{background:"none",border:"none",padding:0,cursor:"pointer",fontFamily:F.body,fontSize:10,color:T.textMuted,textDecoration:"underline"}}>Reset</button>}
                  <span>Faster</span>
                </div>
              </div>
            </SettingsSection>
            {/* Date & time */}
            <SettingsSection title="Date & time" tour="date-time" {...sec("datetime")}>
              <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginBottom:6}}>Time format</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:12}}>
                {([["12h","12-hour (3:05 PM)"],["24h","24-hour (15:05)"]] as const).map(([k,l])=>(
                  <button key={k} onClick={()=>setTimeFormat(k)} aria-pressed={timeFormat===k} style={{background:timeFormat===k?T.accent+"22":T.surface,border:`1.5px solid ${timeFormat===k?T.accent:T.border}`,borderRadius:9,padding:"8px 6px",cursor:"pointer",color:timeFormat===k?T.accent:T.textMuted,fontFamily:F.body,fontSize:11}}>{l}</button>
                ))}
              </div>
              <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginBottom:6}}>Week starts on</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                {([[0,"Sunday"],[1,"Monday"]] as const).map(([k,l])=>(
                  <button key={k} onClick={()=>setWeekStart(k)} aria-pressed={weekStart===k} style={{background:weekStart===k?T.accent+"22":T.surface,border:`1.5px solid ${weekStart===k?T.accent:T.border}`,borderRadius:9,padding:"8px 6px",cursor:"pointer",color:weekStart===k?T.accent:T.textMuted,fontFamily:F.body,fontSize:11}}>{l}</button>
                ))}
              </div>
            </SettingsSection>
            {/* Focus timer (Pomodoro) */}
            <SettingsSection title="Focus timer" tour="focus-timer" {...sec("focus")}>
              <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginBottom:6}}>Focus length</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:7,marginBottom:12}}>
                {[15,25,45,60].map(v=>(
                  <button key={v} onClick={()=>changePomodoroLength("work",v)} aria-pressed={pomodoroWorkMins===v} style={{background:pomodoroWorkMins===v?T.accent+"22":T.surface,border:`1.5px solid ${pomodoroWorkMins===v?T.accent:T.border}`,borderRadius:9,padding:"8px 4px",cursor:"pointer",color:pomodoroWorkMins===v?T.accent:T.textMuted,fontFamily:F.body,fontSize:11}}>{v} min</button>
                ))}
              </div>
              <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginBottom:6}}>Break length</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:7,marginBottom:12}}>
                {[5,10,15,20].map(v=>(
                  <button key={v} onClick={()=>changePomodoroLength("break",v)} aria-pressed={pomodoroBreakMins===v} style={{background:pomodoroBreakMins===v?T.accent+"22":T.surface,border:`1.5px solid ${pomodoroBreakMins===v?T.accent:T.border}`,borderRadius:9,padding:"8px 4px",cursor:"pointer",color:pomodoroBreakMins===v?T.accent:T.textMuted,fontFamily:F.body,fontSize:11}}>{v} min</button>
                ))}
              </div>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                <div><div style={{fontFamily:F.body,fontSize:12,color:T.text}}>Start breaks automatically</div><div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:1}}>When a focus session ends. After a break, you get a suggestion for what to work on next.</div></div>
                <Toggle on={autoStartBreaks} onChange={setAutoStartBreaks} T={T} label="Start breaks automatically"/>
              </div>
            </SettingsSection>
            {/* New task questions: which add-task questions are asked, in what order */}
            <SettingsSection title="New task questions" tour="new-task-questions" {...sec("questions")}>
              <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginBottom:10}}>Asked in this order after the title. Anything you turn off can still be filled in later with Edit.</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:T.surface,borderRadius:9,border:`1px solid ${T.border}`}}>
                  <span style={{fontFamily:F.body,fontSize:10,color:T.textFaint,minWidth:14}}>1</span>
                  <span style={{fontFamily:F.body,fontSize:12,color:T.textMuted,flex:1}}>Title</span>
                  <span style={{fontFamily:F.body,fontSize:10,color:T.textFaint}}>Always asked</span>
                </div>
                {addQuestionPrefs.map((p,i)=>{
                  const q=QUESTIONS.find(x=>x.key===p.key)!;
                  const pos=p.on?addQuestionPrefs.slice(0,i).filter(x=>x.on).length+2:null;
                  const first=i===0, last=i===addQuestionPrefs.length-1;
                  const arrow={background:"none",border:`1px solid ${T.border}`,borderRadius:7,width:28,height:28,color:T.textMuted,fontSize:12,padding:0,display:"flex",alignItems:"center",justifyContent:"center"};
                  return(
                    <div key={p.key} data-question={p.key} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 8px 6px 10px",background:T.surface,borderRadius:9,border:`1px solid ${T.border}`,opacity:p.on?1:0.6}}>
                      <span style={{fontFamily:F.body,fontSize:10,color:T.textFaint,minWidth:14}}>{pos??"–"}</span>
                      <span style={{fontFamily:F.body,fontSize:12,color:p.on?T.text:T.textMuted,flex:1}}>{q.name}</span>
                      <button onClick={()=>setSavedAddQuestions(moveQuestion(addQuestionPrefs,i,-1))} disabled={first} aria-label={`Move ${q.name} earlier`} style={{...arrow,opacity:first?0.35:1,cursor:first?"default":"pointer"}}>↑</button>
                      <button onClick={()=>setSavedAddQuestions(moveQuestion(addQuestionPrefs,i,1))} disabled={last} aria-label={`Move ${q.name} later`} style={{...arrow,opacity:last?0.35:1,cursor:last?"default":"pointer"}}>↓</button>
                      <Toggle on={p.on} onChange={on=>setSavedAddQuestions(addQuestionPrefs.map(x=>x.key===p.key?{...x,on}:x))} T={T} label={`Ask ${q.name}`}/>
                    </div>
                  );
                })}
              </div>
            </SettingsSection>
            {/* Subjects -- lives here (not in Profile) so it works signed out too */}
            <SettingsSection title="Subjects" tour="subjects" {...sec("subjects")}>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {subjects.map(s=>{
                  const confirming=pendingSubjectDelete===s;
                  if(editingSubject?.old===s) return (
                    <form key={s} onSubmit={e=>{e.preventDefault();if(updateSubject(s,editingSubject.name,editingSubject.color))setEditingSubject(null);}} style={{display:"flex",flexDirection:"column",gap:8,background:T.surface,borderRadius:9,padding:"10px 12px"}}>
                      <input autoFocus value={editingSubject.name} onChange={e=>setEditingSubject({...editingSubject,name:e.target.value})} aria-label="Subject name" maxLength={200}
                        style={{background:T.card,border:`1px solid ${T.border}`,borderRadius:8,color:T.text,padding:"7px 10px",fontSize:12,outline:"none"}}/>
                      <div role="radiogroup" aria-label="Subject color" style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {SUBJECT_COLOR_PALETTE.map(c=>(
                          <button key={c} type="button" role="radio" aria-checked={editingSubject.color===c} aria-label={c} onClick={()=>setEditingSubject({...editingSubject,color:c})}
                            style={{width:22,height:22,borderRadius:"50%",background:c,border:editingSubject.color===c?`2px solid ${T.text}`:"2px solid transparent",cursor:"pointer",padding:0}}/>
                        ))}
                      </div>
                      {subjects.some(x=>x!==s&&x.toLowerCase()===editingSubject.name.trim().toLowerCase())&&<div style={{fontFamily:F.body,fontSize:10,color:ink("#FF4757",T.light)}}>There's already a subject with that name</div>}
                      <div style={{display:"flex",gap:6,justifyContent:"flex-end"}}>
                        <button type="button" onClick={()=>setEditingSubject(null)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:8,color:T.textMuted,fontSize:11,cursor:"pointer",padding:"5px 12px"}}>Cancel</button>
                        <button type="submit" style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:8,fontSize:11,cursor:"pointer",padding:"5px 12px"}}>Save</button>
                      </div>
                    </form>
                  );
                  return (
                    <div key={s} style={{display:"flex",alignItems:"center",gap:10,background:T.surface,borderRadius:9,padding:"9px 12px"}}>
                      <div style={{width:10,height:10,borderRadius:"50%",background:subjectColors[s]||T.accent,flexShrink:0}}/>
                      <span style={{flex:1,fontFamily:F.body,fontSize:12,color:T.text,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{s}</span>
                      <button onClick={()=>{setPendingSubjectDelete(null);setEditingSubject({old:s,name:s,color:subjectColors[s]||SUBJECT_COLOR_PALETTE[0]});}} aria-label={`Edit ${s}`} title="Rename or change color"
                        style={{background:"none",border:"none",color:T.textFaint,fontSize:13,cursor:"pointer",lineHeight:1,padding:"0 4px"}}>✎</button>
                      {/* Two-tap delete instead of a browser confirm() dialog */}
                      <button onClick={()=>{if(confirming){removeSubject(s);setPendingSubjectDelete(null);}else setPendingSubjectDelete(s);}} aria-label={confirming?`Confirm deleting ${s}`:`Delete ${s}`} title={confirming?"Tap again to delete (tasks keep their subject)":"Delete subject"}
                        style={{background:confirming?"#FF475722":"none",border:"none",borderRadius:6,color:confirming?"#FF4757":T.textFaint,fontSize:confirming?11:15,cursor:"pointer",lineHeight:1,padding:confirming?"4px 8px":"0 4px"}}>{confirming?"Delete?":"×"}</button>
                    </div>
                  );
                })}
              </div>
              <form onSubmit={e=>{e.preventDefault();addSubject(newSubjectText);setNewSubjectText("");}} style={{display:"flex",gap:8,marginTop:8}}>
                <input value={newSubjectText} maxLength={200} onChange={e=>setNewSubjectText(e.target.value)} placeholder={subjects.length>=LIMITS.subjects?`Limit of ${LIMITS.subjects} subjects reached`:"Add a subject..."} disabled={subjects.length>=LIMITS.subjects} style={{flex:1,minWidth:0,background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,color:T.text,padding:"9px 12px",fontSize:12,outline:"none"}}/>
                <button type="submit" disabled={!newSubjectText.trim()} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:9,padding:"9px 14px",cursor:newSubjectText.trim()?"pointer":"default",opacity:newSubjectText.trim()?1:0.5,fontSize:12,fontWeight:500}}>Add</button>
              </form>
            </SettingsSection>
            {/* Task list: grouping, what shows, auto-archive */}
            <SettingsSection title="Task list" gap={18} {...sec("tasklist")}>
            {/* Group by */}
              <div>
              <div className="sl" style={{color:T.textMuted,paddingTop:0}}>Group Tasks By</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                {Object.entries(GROUP_BY).map(([key,g])=>(
                  <button key={key} onClick={()=>setGroupBy(key)} aria-pressed={groupBy===key} style={{background:groupBy===key?T.accent+"22":T.surface,border:`1.5px solid ${groupBy===key?T.accent:T.border}`,borderRadius:9,padding:"9px 11px",cursor:"pointer",color:groupBy===key?T.accent:T.textMuted,fontFamily:F.body,fontSize:11,display:"flex",alignItems:"center",gap:7}}>{g.name}</button>
                ))}
              </div>
            </div>
            {/* Toggles */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
              <div><div style={{fontFamily:F.body,fontSize:12,color:T.text}}>Show smart suggestion</div><div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:1}}>Your most urgent task, at the top of the list</div></div>
              <Toggle on={showSuggestion} onChange={setShowSuggestion} T={T} label="Show smart suggestion"/>
            </div>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
              <div><div style={{fontFamily:F.body,fontSize:12,color:T.text}}>Show completed tasks</div><div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:1}}>Keep done tasks visible</div></div>
              <Toggle on={showDone} onChange={setShowDone} T={T} label="Show completed tasks"/>
            </div>
            {/* Auto-archive */}
              <div>
              <div className="sl" style={{color:T.textMuted,paddingTop:0}}>Auto-Archive Completed Tasks</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:7}}>
                {[{l:"Never",v:0},{l:"1 day",v:1},{l:"7 days",v:7},{l:"30 days",v:30}].map(({l,v})=>(
                  <button key={l} onClick={()=>setAutoArchiveDays(v)} aria-pressed={autoArchiveDays===v} style={{background:autoArchiveDays===v?T.accent+"22":T.surface,border:`1.5px solid ${autoArchiveDays===v?T.accent:T.border}`,borderRadius:9,padding:"9px 4px",cursor:"pointer",color:autoArchiveDays===v?T.accent:T.textMuted,fontFamily:F.body,fontSize:11}}>{l}</button>
                ))}
              </div>
              <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:8}}>
                Done tasks move to Archived after this long. You can still archive any task manually from its detail view.
              </div>
            </div>
            </SettingsSection>
            {/* Reminders */}
            <SettingsSection title="Reminders" tour="reminders" {...sec("reminders")}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                <div><div style={{fontFamily:F.body,fontSize:12,color:T.text}}>Due date reminders</div><div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:1}}>Notify for tasks due today or overdue</div></div>
                <Toggle on={notificationsEnabled} onChange={toggleNotifications} T={T} label="Due date reminders"/>
              </div>
              {notificationNote&&<div style={{fontFamily:F.body,fontSize:10,color:ink("#FF4757",T.light),marginTop:8}}>{notificationNote}</div>}
              {notificationsEnabled&&<div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:8}}>Only fires while this tab is open or when you reopen it, not true background push.</div>}
              {notificationsEnabled&&(
                <div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${T.border}`}}>
                  <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Remind me</div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {REMINDER_OFFSETS.map(o=>(
                      <button key={o.key} onClick={()=>toggleOffset(o.key)} style={{display:"flex",alignItems:"center",gap:8,background:"none",border:"none",padding:0,cursor:"pointer",textAlign:"left"}}>
                        <div style={{width:16,height:16,border:`2px solid ${enabledOffsets.includes(o.key)?T.accent:T.textFaint}`,borderRadius:4,background:enabledOffsets.includes(o.key)?T.accent:"none",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                          {enabledOffsets.includes(o.key)&&<span style={{color:contrastColor(T.accent),fontSize:10,fontWeight:"bold"}}>✓</span>}
                        </div>
                        <span style={{fontFamily:F.body,fontSize:12,color:T.text}}>{o.label}</span>
                      </button>
                    ))}
                  </div>
                  <div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:8}}>
                    Only applies to tasks with a specific due time set (not just a date).
                  </div>
                </div>
              )}
            </SettingsSection>
            <a href="https://forms.gle/oPuAWx6jNHvm75xi8" target="_blank" rel="noopener noreferrer" style={{display:"block",boxSizing:"border-box",textAlign:"center",textDecoration:"none",background:"none",border:`1px solid ${T.border}`,borderRadius:9,color:T.textMuted,fontFamily:F.body,fontSize:11,padding:"9px 14px",cursor:"pointer",width:"100%"}}>Send feedback / report a bug</a>
            {(()=>{const n=tasks.filter(t=>t.done&&!t.archived).length;return(
            <button disabled={n===0} onClick={()=>deleteTasks(tasks.filter(t=>t.done&&!t.archived).map(t=>t.id))} title="Deletes completed tasks that aren't archived. You can undo this" style={{background:"none",border:`1px solid #FF475744`,borderRadius:9,color:ink("#FF4757",T.light),fontFamily:F.body,fontSize:11,padding:"9px 14px",cursor:n?"pointer":"default",opacity:n?1:0.45,width:"100%"}}>{n?`Clear ${plural(n)} completed`:"No completed tasks to clear"}</button>);})()}
            {fbUser&&(
              <SettingsSection title="Danger Zone" danger {...sec("danger")}>
                {!showDeleteAccountConfirm ? (
                  <button onClick={()=>{setShowDeleteAccountConfirm(true);setDeleteConfirmText("");setDeleteAccountError(null);}} style={{background:"none",border:`1px solid #FF475744`,borderRadius:9,color:ink("#FF4757",T.light),fontFamily:F.body,fontSize:11,padding:"9px 14px",cursor:"pointer",width:"100%"}}>Delete my account & all data</button>
                ) : (
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,lineHeight:1.5}}>
                      This permanently deletes your account, every task, and all settings, on this device and in the cloud. This can't be undone. Type <b>DELETE</b> to confirm.
                    </div>
                    <input value={deleteConfirmText} onChange={e=>setDeleteConfirmText(e.target.value)} placeholder="DELETE" style={{background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,color:T.text,padding:"9px 12px",fontFamily:F.body,fontSize:13,outline:"none"}}/>
                    {deleteAccountError&&<div style={{fontFamily:F.body,fontSize:11,color:ink("#FF4757",T.light)}}>{deleteAccountError}</div>}
                    <div style={{display:"flex",gap:7}}>
                      <button onClick={()=>setShowDeleteAccountConfirm(false)} style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,padding:"9px 4px",cursor:"pointer",color:T.textMuted,fontFamily:F.body,fontSize:11}}>Cancel</button>
                      <button disabled={deleteConfirmText!=="DELETE"||deleteAccountBusy} onClick={deleteAccountForever} style={{flex:1,background:deleteConfirmText==="DELETE"?"#FF4757":T.surface,border:"none",borderRadius:9,padding:"9px 4px",cursor:deleteConfirmText==="DELETE"?"pointer":"not-allowed",color:deleteConfirmText==="DELETE"?"#fff":T.textFaint,fontFamily:F.body,fontSize:11,opacity:deleteAccountBusy?0.6:1}}>{deleteAccountBusy?"Deleting…":"Delete forever"}</button>
                    </div>
                  </div>
                )}
              </SettingsSection>
            )}
            <div style={{textAlign:"center",fontFamily:F.body,fontSize:9,color:T.textFaint,paddingTop:4}}>DuePlanner v{__APP_VERSION__} · <a href="/privacy.html" target="_blank" rel="noopener noreferrer" style={{color:T.textFaint}}>Privacy policy</a></div>
          </div>
        )}
        </main>
        </div>
      </div>
      <div className="sr-only" aria-live="polite">{srMessage}</div>
      {openUpdate&&(()=>{
        // A recap steps through the recaps, an update through the shown updates.
        const list=openUpdate.id.startsWith("recap-")?recapItems:shownUpdates;
        const index=list.findIndex(w=>w.id===openUpdate.id);
        return index<0?null:<UpdateDetail items={list} index={index} T={T} F={F} origin={openUpdate.origin}
          onIndex={i=>{const id=list[i].id;openMessage(id,document.querySelector<HTMLElement>(`[data-update-id="${id}"]`));}}
          onDismiss={dismissMessage}
          onGo={goTo}
          onClosing={()=>setOpenUpdate(u=>u&&{...u,closing:true})}
          onClose={()=>{const o=openUpdate.origin;setOpenUpdate(null);requestAnimationFrame(()=>o?.isConnected&&o.focus({preventScroll:true}));}}/>;
      })()}
      {searchOpen&&<SearchOverlay tasks={tasks} T={T} F={F} subjectColors={subjectColors} colorCodeUrgency={colorCodeUrgency}
        origin={searchTriggerRef}
        onOpenTask={t=>{setSearchOpen(false);setSelectedTask(t);}}
        onClose={()=>{setSearchOpen(false);requestAnimationFrame(()=>searchTriggerRef.current?.focus());}}/>}
      {selectedTask&&<ErrorBoundary fallback={()=>(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div style={{background:T.card,borderRadius:12,padding:24,maxWidth:320,textAlign:"center",display:"flex",flexDirection:"column",gap:12,border:`1px solid ${T.border}`}}>
            <div style={{color:T.text,fontFamily:F.body,fontSize:14}}>This task couldn't be displayed.</div>
            <button onClick={()=>{setSelectedTask(null);}} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:9,padding:"9px 16px",fontFamily:F.body,fontSize:13,cursor:"pointer"}}>Close</button>
          </div>
        </div>
      )}>
        <TaskModal
          key={selectedTask.id}
          h24={h24}
          task={tasks.find(t=>t.id===selectedTask.id)||selectedTask}
          T={T} F={F} subjects={subjects} subjectColors={subjectColors} colorCodeUrgency={colorCodeUrgency} now={now}
          sessionActive={sessionActive} sessionSecs={sessionSecs}
          allTags={allTags}
          onClose={()=>{setSelectedTask(null);}}
          onStartSession={startSession} onEndSession={endSession}
          onToggleDone={()=>{if(sessionActive)endSession();toggleDone(selectedTask.id);setSelectedTask(null);}}
          onDelete={()=>{if(sessionActive)endSession();deleteTask(selectedTask.id);setSelectedTask(null);}}
          onUpdateSubtasks={subtasks=>updateSubtasks(selectedTask.id,subtasks)}
          onArchive={()=>{if(sessionActive)endSession();archiveTask(selectedTask.id);setSelectedTask(null);}}
          onRestore={()=>unarchiveTask(selectedTask.id)}
          onDuplicate={()=>{if(sessionActive)endSession();const copy=duplicateTask(selectedTask.id);if(copy)setSelectedTask(copy);}}
          onUpdateTask={patch=>editTask(selectedTask.id,patch)}
          onSnooze={kind=>snoozeTask(selectedTask.id,kind)}
          onSkipOccurrence={()=>skipOccurrence(selectedTask.id)}
          onSetPriorityOverride={override=>setPriorityOverride(selectedTask.id,override)}
          onSetTags={tags=>setTaskTags(selectedTask.id,tags)}
          onSaveAsTemplate={name=>saveAsTemplate(tasks.find(t=>t.id===selectedTask.id)||selectedTask,name)}
        />
      </ErrorBoundary>}
      {showProfile&&<ProfileModal
        T={T} F={F}
        fbUser={fbUser} authPending={authPending} signInError={signInError} syncError={syncError} syncStatus={syncStatus}
        visibleTasks={visibleTasks.filter(t=>!t.archived)} totalMins={totalMins}
        subjects={subjects} subjectColors={subjectColors} colorCodeUrgency={colorCodeUrgency}
        setShowProfile={setShowProfile}
        signInWithFirebase={signInWithFirebase}
        signOutFirebase={signOutFirebase}
      />}
      {renderPomodoroToast()}
      {/* Undo toast (any undoable change) -- bottom-center; lifted above the
          bulk-action bar when that's showing. */}
      {undoToast!=null&&(
        <div role="status" style={{position:"fixed",left:"50%",bottom:selectionMode&&selectedIds.length>0?130:20,transform:"translateX(-50%)",zIndex:1500,display:"flex",alignItems:"center",gap:10,background:T.card,border:`1px solid ${T.border}`,borderRadius:999,padding:"10px 10px 10px 16px",boxShadow:"0 6px 24px rgba(0,0,0,0.3)",maxWidth:"calc(100vw - 32px)"}}>
          <span style={{fontFamily:F.body,fontSize:12,color:T.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",maxWidth:200}}>{undoToast}</span>
          <button onClick={undo} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:999,padding:"6px 14px",fontFamily:F.body,fontSize:12,fontWeight:500,cursor:"pointer",flexShrink:0}}>Undo</button>
        </div>
      )}
      {/* Bulk action bar -- only reachable via the "Select" toggle (any layout).
          Two rows so it stays short on a phone: the count and one-tap
          actions, then the three "set a field" menus side by side. */}
      {selectionMode&&selectedIds.length>0&&(()=>{
        const pill:React.CSSProperties={background:T.surface,color:T.textMuted,border:`1px solid ${T.border}`,borderRadius:9,padding:"7px 8px",fontFamily:F.body,fontSize:11,cursor:"pointer",minWidth:0,width:"100%"};
        return (
        <div role="toolbar" aria-label="Bulk actions" style={{position:"fixed",left:"50%",bottom:20,transform:"translateX(-50%)",zIndex:1500,display:"flex",flexDirection:"column",gap:8,background:T.card,border:`1px solid ${T.border}`,borderRadius:16,padding:"10px 12px",boxShadow:"0 6px 24px rgba(0,0,0,0.3)",width:"min(520px, calc(100vw - 32px))",boxSizing:"border-box"}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span style={{fontFamily:F.body,fontSize:12,color:T.text,fontWeight:500,marginRight:"auto",whiteSpace:"nowrap"}}>{selectedIds.length} selected</span>
            <button onClick={()=>bulkMarkDone(selectedIds)} style={{background:"#2ED57322",color:ink("#2ED573",T.light),border:"1px solid #2ED57344",borderRadius:9,padding:"7px 10px",fontFamily:F.body,fontSize:11,cursor:"pointer"}}>✓ Done</button>
            <button onClick={()=>bulkArchive(selectedIds)} style={{background:T.surface,color:T.textMuted,border:`1px solid ${T.border}`,borderRadius:9,padding:"7px 10px",fontFamily:F.body,fontSize:11,cursor:"pointer"}}>Archive</button>
            <button onClick={()=>bulkDelete(selectedIds)} style={{background:"#FF475711",color:ink("#FF4757",T.light),border:"1px solid #FF475733",borderRadius:9,padding:"7px 10px",fontFamily:F.body,fontSize:11,cursor:"pointer"}}>Delete</button>
          </div>
          {bulkDate!=null
            ? <form onSubmit={e=>{e.preventDefault();if(bulkDate)bulkSetDue(selectedIds,bulkDate);}} style={{display:"flex",gap:6,alignItems:"center"}}>
                <input type="date" autoFocus aria-label="New due date" value={bulkDate} onChange={e=>setBulkDate(e.target.value)} onKeyDown={e=>{if(e.key==="Escape")setBulkDate(null);}}
                  style={{...pill,color:T.text,flex:1,padding:"6px 8px"}}/>
                <button type="submit" disabled={!bulkDate} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:9,padding:"7px 12px",fontFamily:F.body,fontSize:11,cursor:bulkDate?"pointer":"default",opacity:bulkDate?1:0.5}}>Set</button>
                <button type="button" onClick={()=>setBulkDate(null)} aria-label="Cancel picking a date" style={{background:"none",border:"none",color:T.textMuted,fontSize:15,cursor:"pointer",padding:"0 4px"}}>×</button>
              </form>
            : <div style={{display:"grid",gridTemplateColumns:"repeat(3,minmax(0,1fr))",gap:6}}>
                <select value="" aria-label="Set subject" onChange={e=>{if(e.target.value)bulkSetSubject(selectedIds,e.target.value);}} style={pill}>
                  <option value="" disabled>Subject</option>
                  {subjects.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
                <select value="" aria-label="Set due date" onChange={e=>{const v=e.target.value;if(v==="pick")setBulkDate("");else if(v==="none")bulkSetDue(selectedIds,"");else if(v)bulkSetDue(selectedIds,dateInDays(Number(v)));}} style={pill}>
                  <option value="" disabled>Due date</option>
                  <option value="0">Today</option>
                  <option value="1">Tomorrow</option>
                  <option value="7">Next week</option>
                  <option value="pick">Pick a date...</option>
                  <option value="none">No due date</option>
                </select>
                <select value="" aria-label="Set priority" onChange={e=>{const v=e.target.value;if(v)bulkSetPriority(selectedIds,v==="auto"?null:v as Priority);}} style={pill}>
                  <option value="" disabled>Priority</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                  <option value="low">Low</option>
                  <option value="auto">Automatic</option>
                </select>
              </div>}
        </div>
        );
      })()}
    </div>
  );
}
