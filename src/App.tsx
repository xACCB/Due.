import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { flushSync } from "react-dom";
import { signInWithPopup, signInWithRedirect, getRedirectResult, signOut as fbSignOut, onAuthStateChanged, deleteUser } from "firebase/auth";
import type { User } from "firebase/auth";
import { doc, getDoc, getDocFromServer, setDoc, updateDoc, deleteField, collection, getDocs, writeBatch, onSnapshot } from "firebase/firestore";
import type { QueryDocumentSnapshot } from "firebase/firestore";
import type { Priority, Subtask, Task, TaskTemplate, HistoryAction } from "./types";
import { LAYOUTS, GROUP_BY, DEFAULT_SUBJECTS, DEFAULT_SUBJECT_COLORS, SUBJECT_COLOR_PALETTE, priColor, REMINDER_OFFSETS, QUESTIONS, QUESTION_KEYS, askedQuestions, SCREEN_TITLES } from "./constants";
import type { LayoutName } from "./constants";
import { WHATS_NEW, kindRank, LEGACY_WHATSNEW_IDS } from "./whatsNew";
import type { WhatsNewItem } from "./whatsNew";
import { LEGACY_EXAMPLE_TASKS, isUntouchedExample, buildSuggestion, dateInDays, snoozeTarget, setDone } from "./lib/tasks";
import type { SnoozeKind } from "./lib/tasks";
import { trashEntries, pruneTrash, localRecords } from "./lib/trash";
import type { TrashEntry } from "./lib/trash";
import { secondsLeft, secondsSince, stopwatchTotal, pomodoroFinishMinutes, pomodoroCreditMinutes, lengthChangeResetsTimer, sessionMinutes, withSession } from "./lib/timers";
import { dailySummary, offsetReminders } from "./lib/reminders";
import type { SentReminders } from "./lib/reminders";
import { tasksCsv, readBackup, withImportedSubjects, withImportedColors, withImportedTemplates, withSyllabusTasks } from "./lib/backup";
import { heldOpen, isSettled, withHeldOpen, allTagsOf, sortTasks, filterTasks, groupTasks, prioritySplit, timeLeft } from "./lib/taskViews";
import { patchTask, patchTasks, withoutTasks, skipPatch, snoozePatch, dueDatePatch, duplicateOf, freshSubtasks, withNewTask, templateFromTask, taskFromTemplate, withTrashed, withoutTrashed, restoredInto, movedOrder, withOrder, subjectToAdd, subjectRename, renamedSubjects, recolouredSubjects, withoutSubjectColor, tasksRenamedSubject, trashRenamedSubject, templatesRenamedSubject } from "./lib/taskActions";
import { THEMES } from "./themes";
import type { ThemeName, ThemeObj } from "./themes";
import { localDateStr, todayISO } from "./lib/dates";
import { normalizeFocusShow, focusShowFor, showsPomodoro, showsStopwatch, formatStopwatch, stopwatchMinutes } from "./lib/stopwatch";
import { ANIM_SPEED, clampSpeed, setAnimationSpeed, scaledMs } from "./lib/animSpeed";
import { newRecaps, mergeRecaps, recapMessage } from "./lib/recaps";
import type { Recap } from "./lib/recaps";
import { parseSyllabus } from "./lib/syllabus";
import { contrastColor, getPriority, formatDate, formatTime, daysUntil, formatDuration, countdown, formatAgo, ink } from "./lib/format";
import { DUE_BUCKETS, dueBucket, mostUrgent } from "./lib/timeLeft";
import { subjectGroups } from "./lib/sidebarSubjects";
import { releaseVelocity } from "./lib/spring";
import { reconcile, same } from "./lib/sync";
import type { SyncRecord, CloudRecord } from "./lib/sync";
import { addTaskWrite, addTaskWriteFromActual } from "./lib/taskWrites";
import { diffTasks, applyTaskStates } from "./lib/history";
import { downloadFile } from "./lib/download";
import { LIMITS } from "./lib/limits";
import { describeDevice, deviceAction, listDevices, pruneDevices } from "./lib/devices";
import type { DeviceEntry, DeviceMap } from "./lib/devices";
import { usePersistedState } from "./hooks/usePersistedState";
import { usePullToReload } from "./hooks/usePullToReload";
import { normalizeQuestionPrefs, moveQuestion } from "./lib/addQuestions";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { auth, db, googleProvider, isStorageBlockedError, STORAGE_BLOCKED_MESSAGE } from "./firebase";
import { FONT } from "./fonts";
import { IconTasks, IconImport, IconCalendar, IconFocus, IconSidebar, IconBell, IconHistory, IconSearch, IconSettings, CheckMark } from "./components/icons";
import { activateOnKey, isWideScreen, flashTarget, notify, playChime } from "./lib/dom";
import { thisDeviceId, isStandalone } from "./lib/thisDevice";
import { TaskModal } from "./components/TaskModal";
import { SidebarRow, SidebarSubjects, ScreenHeader } from "./components/Sidebar";
import { SettingsSection, Toggle } from "./components/SettingsSection";
import { SearchOverlay } from "./components/SearchOverlay";
import { UpdateDetail } from "./components/UpdateDetail";
import { TimeDetail } from "./components/GrowCard";
import { CalendarView, DueDeck } from "./components/CalendarView";
import { MiniCard } from "./components/MiniCard";
import { ProfileModal } from "./components/ProfileModal";
import { buildCss } from "./styles";

// A tasks/ or trash/ doc as a cloud record. updatedAt/deletedAt are sync
// metadata, not task fields, so they're split off here.
function cloudRecord(d:QueryDocumentSnapshot,deleted:boolean):CloudRecord<Task>|null{
  const {updatedAt,deletedAt,...task}=d.data();
  if(typeof task.id!=="number"||typeof task.title!=="string")return null; // shape guard, see profile sync
  const rec:CloudRecord<Task>={task:task as Task,updatedAt:typeof updatedAt==="number"?updatedAt:0};
  if(deleted)rec.deletedAt=typeof deletedAt==="number"?deletedAt:0;
  return rec;
}

// A timestamp for the card glide's capture (see captureTaskRects). Module scope
// for the same React Compiler purity reason as dateInDays above.
function glideClock():number{ return performance.now(); }
// Wall-clock time for the Focus stopwatch, at module scope for the same lint.
function wallClock():number{ return Date.now(); }


export default function HomeworkPlanner() {
  const [tasks,setTasks]=useState<Task[]>(()=>{
    try{
      const s=localStorage.getItem("hw-tasks");
      let loaded:Task[]=s?JSON.parse(s):[];
      // One-time: drop the old example tasks if they're still as seeded.
      if(!localStorage.getItem("hw-examples-removed")){
        loaded=loaded.filter(t=>!isUntouchedExample(t));
        localStorage.setItem("hw-examples-removed","1");
      }
      // Backfill order for tasks saved before drag-to-reorder existed.
      return loaded.map((t,i)=>t.order===undefined?{...t,order:i}:t);
    }catch{return [];}
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
  // Calendar tab: only the month's own days (true) or six full weeks with the
  // neighbouring months' days faded in (false). Local-only.
  const [calendarMonthOnly,setCalendarMonthOnly]=usePersistedState<boolean>("hw-calendar-month-only",true);
  // Calendar tab: the month grid or the deck of due-date cards. Local-only.
  const [storedCalendarView,setCalendarView]=usePersistedState<string>("hw-calendar-view","month");
  const calendarView=storedCalendarView==="deck"?"deck":"month";
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
      // What's owed is worked out in src/lib/reminders.ts; this effect only
      // shows it and remembers what was sent.
      if(localStorage.getItem("hw-last-notified")!==today){
        const summary=dailySummary(tasks,today,enabledOffsets);
        if(summary){
          localStorage.setItem("hw-last-notified",today);
          notify(summary.title,{body:summary.body});
        }
      }
      if(enabledOffsets.length===0)return;
      let sent:SentReminders={};
      try{sent=JSON.parse(localStorage.getItem("hw-sent-reminders")||"{}");}catch{/* ignore */}
      const owed=offsetReminders(tasks,enabledOffsets,sent,Date.now(),h24);
      for(const note of owed.notes)notify(note.title,{body:note.body});
      if(owed.changed)localStorage.setItem("hw-sent-reminders",JSON.stringify(owed.sent));
    }
    checkDue();
    document.addEventListener("visibilitychange",checkDue);
    // Offset reminders need to fire close to a specific time, not just when
    // the tab regains focus, so also re-check periodically while it's open.
    const interval=setInterval(checkDue,60000);
    return ()=>{document.removeEventListener("visibilitychange",checkDue);clearInterval(interval);};
  },[notificationsEnabled,tasks,enabledOffsets,h24]);

  // The old Desktop Layout setting (narrow / wide / icon sidebar) is gone: wide
  // screens always get the sidebar now. Its saved choice is cleared once.
  useEffect(()=>{localStorage.removeItem("hw-desktoplayout");},[]);
  // Red/orange/green priority coloring, toggleable off in favor of one neutral
  // gray (NEUTRAL_PRIORITY_COLOR) everywhere urgency is shown -- default on.
  const [colorCodeUrgency,setColorCodeUrgency]=usePersistedState("hw-colorcode-urgency",true);
  // Liquid Glass (a translucent look, with a glow that followed the pointer) was
  // removed at the user's request. Its saved choice is cleared once.
  useEffect(()=>{localStorage.removeItem("hw-liquid-glass");},[]);
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
  // What Focus Mode shows under the task: the Pomodoro, the stopwatch, both or
  // neither (Settings -> Focus timer; local-only like the lengths above).
  const [storedFocusShow,setFocusShow]=usePersistedState<string>("hw-focus-show","all");
  const focusShow=normalizeFocusShow(storedFocusShow);
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
  // Which Inbox and Import/Export dropdowns are open. Not remembered: they start
  // closed and close again when you leave the screen (see lastTab).
  const [openInbox,setOpenInbox]=useState<string[]>([]);
  function toggleInboxSection(id:string){setOpenInbox(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);}
  function dismissWhatsNew(id:string){setDismissedWhatsNew(prev=>[...prev,id]);}
  // The Inbox update open in the floating panel (UpdateDetail), by id, and the
  // row it grew out of (to grow back into on close).
  const [openUpdate,setOpenUpdate]=useState<{id:string;origin:HTMLElement|null;closing?:boolean}|null>(null);
  const [subjectColors,setSubjectColors]=useState<Record<string,string>>(()=>{try{const s=localStorage.getItem("hw-subjectcolors");return {...DEFAULT_SUBJECT_COLORS,...(s?JSON.parse(s):{})};}catch{return DEFAULT_SUBJECT_COLORS;}});
  useEffect(()=>{localStorage.setItem("hw-subjectcolors",JSON.stringify(subjectColors));},[subjectColors]);
  const [templates,setTemplates]=usePersistedState<TaskTemplate[]>("hw-templates",[]);
  function saveAsTemplate(task:Task,name:string){
    setTemplates(prev=>[...prev,templateFromTask(task,name)]);
  }
  function addSubject(name:string){
    const added=subjectToAdd(name,subjects,subjectColors);
    if(!added)return;
    setSubjects(prev=>[...prev,added.name]);
    setSubjectColors(prev=>({...prev,[added.name]:added.color}));
  }
  // Rename and/or recolor a subject; a rename carries over to every task
  // (including Recently deleted) and template using it. False if the new name
  // is empty or taken.
  function updateSubject(old:string,name:string,color:string):boolean{
    const trimmed=subjectRename(old,name,subjects);
    if(trimmed==null)return false;
    setSubjects(prev=>renamedSubjects(prev,old,trimmed));
    setSubjectColors(prev=>recolouredSubjects(prev,old,trimmed,color));
    if(trimmed!==old){
      setTasks(prev=>tasksRenamedSubject(prev,old,trimmed));
      setTrash(prev=>trashRenamedSubject(prev,old,trimmed));
      setTemplates(prev=>templatesRenamedSubject(prev,old,trimmed));
    }
    return true;
  }
  function removeSubject(name:string){
    setSubjects(prev=>prev.filter(s=>s!==name));
    setSubjectColors(prev=>withoutSubjectColor(prev,name));
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
      // account, leave local state (tasks added while signed out) alone so
      // the save effect pushes it up as the first write.
      if(cloud.size===0&&isNewAccountForUid===uid&&baseRef.current.size===0){ mergeLocalOnSignIn.current=false; setTasksSyncedForUid(uid); return; }
      const local=localRecords(tasksRef.current,trashRef.current);
      if(mergeLocalOnSignIn.current){
        // Explicit sign-in: keep tasks created while signed out (marking them
        // as unsaved local changes) instead of letting the cloud replace them.
        const isStarter=(t:Task)=>!t.done&&LEGACY_EXAMPLE_TASKS.some(d=>d.id===t.id&&d.title===t.title);
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
  // The account's device list, as last heard from the cloud (see the Devices
  // effect further down). signingOut is set while this device signs itself
  // out, so removing its own entry isn't mistaken for another device doing it.
  const [deviceList,setDeviceList]=useState<{uid:string;map:DeviceMap}|null>(null);
  const deviceRegistering=useRef(false);
  const signingOut=useRef(false);
  async function signOutFirebase(){
    signingOut.current=true;
    clearTimeout(tasksSaveTimer.current);
    // Capped: offline, a write only resolves once it reaches the server, and
    // Firestore keeps it queued anyway -- sign-out shouldn't hang on that.
    try{ await Promise.race([pendingTasksWrite.current?.(),new Promise(r=>setTimeout(r,3000))]); }catch{/* already surfaced via syncError */}
    // Take this device off the account's device list. Best effort and capped
    // like the flush above; it fails harmlessly if the device isn't listed.
    if(fbUser){
      try{ await Promise.race([updateDoc(doc(db,"users",fbUser.uid,"meta","devices"),{[`d.${thisDeviceId()}`]:deleteField()}),new Promise(r=>setTimeout(r,2000))]); }catch{/* not listed, or no list */}
    }
    await fbSignOut(auth);
    try{localStorage.removeItem("hw-device-registered");}catch{/* storage unavailable */}
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
    setDeviceList(null);
  }
  // Profile -> Devices: sign one other device out, or all of them. Removing an
  // entry is the whole mechanism (see src/lib/devices.ts).
  function signOutDevice(id:string){
    if(!fbUser||id===thisDeviceId())return;
    updateDoc(doc(db,"users",fbUser.uid,"meta","devices"),{[`d.${id}`]:deleteField()}).catch(e=>console.error(e));
  }
  function signOutOtherDevices(){
    if(!fbUser||deviceList?.uid!==fbUser.uid)return;
    const id=thisDeviceId(), mine=deviceList.map[id];
    if(!mine)return; // not confirmed in the list yet: nothing safe to keep
    setDoc(doc(db,"users",fbUser.uid,"meta","devices"),{d:{[id]:mine}}).catch(e=>console.error(e));
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
      // The device list too (other devices then sign themselves out). On its
      // own and allowed to fail, so it can never block deleting the account.
      try{ await writeBatch(db).delete(doc(db,"users",fbUser.uid,"meta","devices")).commit(); }catch{/* no list */}
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
  // "task" is a task opened from the sidebar, shown as a whole screen (the
  // selectedTask, in TaskModal's page form) rather than as the sheet.
  const [activeTab,setActiveTab]=useState("tasks");
  const sheetTaskOpen=selectedTask!=null&&activeTab!=="task";
  // The sidebar (profile, search, every screen). On wide screens it's always
  // there unless folded away (sidebarFolded, remembered on this device); on
  // narrow ones it's a drawer (drawerOpen) opened from the dp mark or a swipe
  // in from the left edge. Which of the two applies is decided by the css.
  const [sidebarFolded,setSidebarFolded]=usePersistedState("hw-sidebar-folded",false);
  const [drawerOpen,setDrawerOpen]=useState(false);
  const sidebarRef=useRef<HTMLElement>(null);
  const sidebarOpenerRef=useRef<HTMLButtonElement>(null);
  function openSidebar(){if(isWideScreen())setSidebarFolded(false);else setDrawerOpen(true);}
  function closeSidebar(){if(isWideScreen())setSidebarFolded(true);else setDrawerOpen(false);}
  // The sidebar's subjects: which are unfolded (remembered on this device), and
  // the one Home is filtered to, if any ("" is "No subject"; see subjectFilterOn).
  const [openSubjects,setOpenSubjects]=usePersistedState<string[]>("hw-sidebar-subjects-open",[]);
  const [subjectFilter,setSubjectFilter]=useState<string|null>(null);
  useEffect(()=>{
    if(!drawerOpen)return;
    const nav=sidebarRef.current, opener=sidebarOpenerRef.current;
    nav?.querySelector("button")?.focus({preventScroll:true});
    function onKeyDown(e:KeyboardEvent){if(e.key==="Escape")setDrawerOpen(false);}
    // Widening the window turns the drawer into the fixed sidebar.
    const mq=window.matchMedia("(min-width:900px)");
    function onWide(){if(mq.matches)setDrawerOpen(false);}
    document.addEventListener("keydown",onKeyDown);
    mq.addEventListener("change",onWide);
    return ()=>{
      document.removeEventListener("keydown",onKeyDown);
      mq.removeEventListener("change",onWide);
      if(nav?.contains(document.activeElement))opener?.focus({preventScroll:true});
    };
  },[drawerOpen]);
  // "time left" breakdown popover in the header: closes on an outside click or Escape.
  const [timeMenuOpen,setTimeMenuOpen]=useState(false);
  const timeMenuRef=useRef<HTMLDivElement>(null);
  // The Time left row opened as a card: a due-date group or a subject.
  const [openTime,setOpenTime]=useState<{kind:"due"|"subject";key:string;origin:HTMLElement}|null>(null);
  useEffect(()=>{
    if(!timeMenuOpen)return;
    // A card opened from a row (data-keeps-menu, see GrowCard) sits outside the
    // dropdown; taps and Escape inside it must not close the dropdown under it.
    const keeps=(t:EventTarget|null)=>t instanceof Element&&!!t.closest("[data-keeps-menu]");
    function onPointerDown(e:PointerEvent){if(keeps(e.target))return;if(timeMenuRef.current&&!timeMenuRef.current.contains(e.target as Node))setTimeMenuOpen(false);}
    function onKeyDown(e:KeyboardEvent){if(e.key==="Escape"&&!keeps(e.target))setTimeMenuOpen(false);}
    document.addEventListener("pointerdown",onPointerDown);
    document.addEventListener("keydown",onKeyDown);
    return ()=>{document.removeEventListener("pointerdown",onPointerDown);document.removeEventListener("keydown",onKeyDown);};
  },[timeMenuOpen]);
  // Which Settings dropdowns are open (SettingsSection ids), remembered on this
  // device so returning to Settings doesn't mean reopening everything.
  // Which Settings dropdowns are open. They all close when you leave Settings
  // (at the user's request), so it isn't remembered; the old saved list
  // ("hw-settings-open") is cleared once.
  const [openSettings,setOpenSettings]=useState<string[]>([]);
  useEffect(()=>{localStorage.removeItem("hw-settings-open");},[]);
  // Reset while rendering when the screen changes (React's pattern for
  // adjusting state to a changed value), not in an effect.
  // The same goes for the Inbox's and Import/Export's dropdowns (openInbox).
  const [lastTab,setLastTab]=useState(activeTab);
  if(activeTab!==lastTab){
    setLastTab(activeTab);
    if(lastTab==="options")setOpenSettings([]);
    if(lastTab==="inbox"||lastTab==="import")setOpenInbox([]);
    // Left the task page some other way than navTo(): don't let its task pop up as the sheet.
    if(lastTab==="task")setSelectedTask(null);
  }
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
    setTasks(prev=>withSyllabusTasks(prev,toAdd,subject));
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
  const SWIPE_THRESHOLD=64;
  const SWIPE_FLICK=600; // px/s
  // Undo/redo action history. Actions apply immediately (so Firestore sync,
  // which just diffs against `tasks`, doesn't need special-casing) and keep
  // what's needed to reverse them: "delete" keeps the removed tasks; "change"
  // keeps each affected task's full state before and after (see changeTasks).
  // A new action always clears redoStack, same as any standard undo/redo history.
  const [undoStack,setUndoStack]=useState<HistoryAction[]>([]);
  const [redoStack,setRedoStack]=useState<HistoryAction[]>([]);
  const [undoToast,setUndoToast]=useState<string|null>(null);
  function addToTrash(list:Task[]){
    const added=trashEntries(list);
    setTrash(prev=>withTrashed(prev,added));
  }
  function removeFromTrash(ids:number[]){
    setTrash(prev=>withoutTrashed(prev,ids));
  }
  function restoreFromTrash(id:number){
    const entry=trash.find(e=>e.task.id===id);
    if(!entry)return;
    setTasks(prev=>restoredInto(prev,entry));
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
  // solidBorder and borderFaint date from Liquid Glass (removed), when `border`
  // could be an rgba() value: solidBorder is always a real hex, borderFaint a
  // lighter divider. Still the ones to use for those two jobs.
  const T:ThemeObj={...base,solidBorder:base.border,borderFaint:base.border+"33",accentGlow:base.accent+"44",gradientCard:`linear-gradient(135deg,${base.cardAlt},${base.card})`,accent:base.accent as typeof base.accent};
  // Mirrors just the resolved background color (not the whole theme) to its own
  // key, read synchronously by a tiny inline script in index.html before React
  // hydrates -- prevents a flash of the browser's default white background for
  // returning dark-theme users, without duplicating the THEMES palette there.
  useEffect(()=>{try{localStorage.setItem("hw-bg",T.bg);}catch{/* storage unavailable */}},[T.bg]);
  // Pull down at the top of the page to reload, in the installed app (a browser
  // tab already has its own). Off while anything is open over the page.
  usePullToReload(isStandalone()&&!sheetTaskOpen&&!searchOpen&&openUpdate==null&&openTime==null&&!showProfile&&!drawerOpen,T.card,T.text,T.solidBorder);
  // The drawer follows a sideways swipe: in from the left edge opens it, a
  // swipe left anywhere closes it. Only acts on release, and only when the
  // movement was clearly sideways, so it can't fight scrolling or the task
  // cards' own swipes (those start further in than the edge strip).
  const drawerSwipeOff=sheetTaskOpen||searchOpen||openUpdate!=null||openTime!=null||showProfile;
  useEffect(()=>{
    if(drawerSwipeOff)return;
    let sx=0,sy=0,tracking=false;
    function onStart(e:TouchEvent){
      const t=e.touches[0];
      tracking=e.touches.length===1&&!isWideScreen()&&(drawerOpen||t.clientX<=16);
      sx=t.clientX;sy=t.clientY;
    }
    function onEnd(e:TouchEvent){
      if(!tracking)return;
      tracking=false;
      const t=e.changedTouches[0], dx=t.clientX-sx, dy=t.clientY-sy;
      if(Math.abs(dx)<48||Math.abs(dx)<Math.abs(dy)*1.5)return;
      if(!drawerOpen&&dx>0)setDrawerOpen(true);
      else if(drawerOpen&&dx<0)setDrawerOpen(false);
    }
    document.addEventListener("touchstart",onStart,{passive:true});
    document.addEventListener("touchend",onEnd,{passive:true});
    return ()=>{document.removeEventListener("touchstart",onStart);document.removeEventListener("touchend",onEnd);};
  },[drawerOpen,drawerSwipeOff]);


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
    const tick=()=>setPomodoroSecs(secondsLeft(endAt,Date.now()));
    const t=setInterval(tick,500);
    document.addEventListener("visibilitychange",tick);
    return()=>{clearInterval(t);document.removeEventListener("visibilitychange",tick);};
  },[pomodoroActive,pomodoroPhase]);
  // Focus Mode's stopwatch. Clock-based like the Pomodoro: it counts up from
  // the moment it was started (plus whatever earlier runs banked), so a
  // background tab or locked screen doesn't lose time. It keeps running
  // outside Focus Mode; swElapsed is just what's on screen.
  const [swStartedAt,setSwStartedAt]=useState<number|null>(null);
  const [swBanked,setSwBanked]=useState(0);
  const [swElapsed,setSwElapsed]=useState(0);
  useEffect(()=>{
    if(swStartedAt==null)return;
    const tick=()=>setSwElapsed(stopwatchTotal(swBanked,swStartedAt,Date.now()));
    const t=setInterval(tick,250);
    document.addEventListener("visibilitychange",tick);
    return()=>{clearInterval(t);document.removeEventListener("visibilitychange",tick);};
  },[swStartedAt,swBanked]);
  function toggleStopwatch(){
    if(swStartedAt==null){setSwStartedAt(wallClock());return;}
    const total=stopwatchTotal(swBanked,swStartedAt,wallClock());
    setSwBanked(total);setSwElapsed(total);setSwStartedAt(null);
  }
  function resetStopwatch(){setSwStartedAt(null);setSwBanked(0);setSwElapsed(0);}
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
  // Seconds of the current focus session already logged to a task (see creditPomodoro).
  const pomCredited=useRef(0);
  const nextSuggestionRef=useRef<string|null>(null);
  useEffect(()=>{
    if(!pomodoroActive||pomodoroSecs>0)return;
    playChime();
    if(pomodoroPhase==="work"){
      // A finished focus session counts as a work session on the focus task:
      // the whole length, less anything already logged along the way (see
      // creditPomodoro).
      const logId=pomodoroTaskRef.current;
      const mins=pomodoroFinishMinutes(pomodoroWorkMins,pomCredited.current);
      pomCredited.current=0;
      if(logId!=null&&mins>0)setTasks(prev=>withSession(prev,logId,mins,Date.now()));
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
  // Focus time counts toward the task like the task timer's sessions do, even
  // when a Pomodoro isn't finished: whatever part of the current focus session
  // hasn't been logged yet goes to `taskId` as a work session (whole minutes;
  // under half a minute is dropped). pomCredited is how many seconds of this
  // focus session are already logged, so nothing is counted twice. Called when
  // the Pomodoro is reset, when the focus task changes or is marked done, and
  // by the finish effect for the remainder.
  function creditPomodoro(taskId:number|null){
    if(pomodoroPhase!=="work"||taskId==null)return;
    const mins=pomodoroCreditMinutes(pomodoroWorkMins,pomodoroSecs,pomCredited.current);
    if(mins<1)return;
    pomCredited.current+=mins*60;
    setTasks(prev=>withSession(prev,taskId,mins,wallClock()));
    setLastWorkedTaskId(taskId);
  }
  function resetPomodoro(){creditPomodoro(pomodoroTaskRef.current);pomCredited.current=0;setPomodoroActive(false);setPomodoroPhase("work");setPomodoroSecs(pomodoroWorkMins*60);}
  // Changing a length only moves the timer if it's sitting untouched at the
  // start of that phase -- a paused session keeps its remaining time.
  function changePomodoroLength(phase:"work"|"break",mins:number){
    const cur=phase==="work"?pomodoroWorkMins:pomodoroBreakMins;
    if(lengthChangeResetsTimer(pomodoroActive,pomodoroPhase,phase,pomodoroSecs,cur))setPomodoroSecs(mins*60);
    (phase==="work"?setPomodoroWorkMins:setPomodoroBreakMins)(mins);
  }

  const visibleTasks=tasks;
  // Every tag used on any task, deduplicated -- powers the "quick add" suggestion
  // chips in TaskModal's tag editor instead of retyping tags you've already used.
  const allTags=allTagsOf(tasks);
  // Pending tasks sort by their manual drag order; done tasks always sink to the
  // bottom -- except ones in justDone, which stay put until they settle.
  const allSorted=sortTasks(visibleTasks,justDone);
  const sidebarGroups=useMemo(()=>subjectGroups(tasks,subjects),[tasks,subjects]);
  // The subject filter only counts while that subject is still in the sidebar
  // (it may have been renamed or deleted, or "No subject" emptied), so Home
  // can't get stuck filtered to something there's no row left to un-pick.
  const subjectFilterOn=subjectFilter!=null&&sidebarGroups.some(g=>g.name===subjectFilter)?subjectFilter:null;
  const filteredTasks=filterTasks(allSorted,{filter,subject:subjectFilterOn,showDone,justDone});
  const topTask=allSorted.find(t=>!t.done&&!t.archived);
  // The suggestion card above the list. A task just checked off still counts
  // as open for it until that task settles (justDone): otherwise the card
  // changed, appeared or vanished at the tick, moving the whole list once
  // then, and again when the completed card glides away.
  const suggestionTask=allSorted.find(t=>heldOpen(t,justDone)&&!t.archived);
  const suggestion=buildSuggestion(withHeldOpen(tasks,justDone));
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
  // The header's "Time left": totals for the open tasks, split by subject and
  // by when they're due (src/lib/taskViews.ts).
  const {totalMins,bySubject:timeBySubject,byDue:timeByDue,noEstimateCount}=timeLeft(visibleTasks,localDateStr(new Date(now)));
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
  // ---- Devices (Profile -> Devices). Each signed-in device keeps one entry in
  // users/{uid}/meta/devices and watches that doc. deviceAction() decides what
  // a server-confirmed snapshot means for this device; the rules for staying
  // safe are all here:
  // - Only a snapshot straight from the server counts (not the cache, not one
  //   still holding our own unsaved write), so being offline can't sign anyone out.
  // - "hw-device-registered" (this account's uid) is written only once the
  //   server has accepted this device's entry. Without it a missing entry
  //   means "add me", never "I was signed out" -- so a first write that never
  //   arrived (offline, or these rules not deployed yet) can't sign anyone out.
  // - If the list can't be read at all, nothing happens: there's simply no list.
  // Declared down here, below everything signOutFirebase touches, for the React
  // Compiler's forward-reference check (see CLAUDE.md).
  const signOutRef=useRef(signOutFirebase);
  useEffect(()=>{signOutRef.current=signOutFirebase;});
  useEffect(()=>{
    if(!fbUser)return;
    signingOut.current=false;
    const uid=fbUser.uid, id=thisDeviceId(), ref=doc(db,"users",uid,"meta","devices");
    return onSnapshot(ref,{includeMetadataChanges:true},snap=>{
      const map=(snap.data()?.d||{}) as DeviceMap;
      setDeviceList({uid,map});
      if(snap.metadata.fromCache||snap.metadata.hasPendingWrites||signingOut.current)return;
      let registered=false;
      try{registered=localStorage.getItem("hw-device-registered")===uid;}catch{/* storage unavailable: stays "add me" */}
      const action=deviceAction(registered,map[id],Date.now());
      if(action==="register"&&!deviceRegistering.current){
        deviceRegistering.current=true;
        const at=Date.now();
        const d:Record<string,unknown>={[id]:{name:describeDevice(navigator.userAgent,navigator.maxTouchPoints||0,isStandalone()),createdAt:at,lastSeen:at} satisfies DeviceEntry};
        for(const old of pruneDevices(map,id,LIMITS.devices))d[old]=deleteField();
        // Resolves only when the server has accepted it; only then is this device "registered".
        setDoc(ref,{d},{merge:true})
          .then(()=>{if(auth.currentUser?.uid===uid)localStorage.setItem("hw-device-registered",uid);})
          .catch(()=>{/* refused or storage unavailable: try again next time */})
          .finally(()=>{deviceRegistering.current=false;});
      }
      if(action==="touch")updateDoc(ref,{[`d.${id}.lastSeen`]:Date.now()}).catch(()=>{/* best effort */});
      if(action==="signOut"){
        signingOut.current=true;
        signOutRef.current()
          .then(()=>{setSignInError("This device was signed out from another device. Sign in again to keep syncing.");setShowProfile(true);})
          .catch(e=>console.error(e));
      }
    },()=>{/* the list can't be read (e.g. offline with nothing cached): no list, and nothing else changes */});
  },[fbUser]);
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
    const task=taskFromTemplate(tpl);
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
    const subtasks=freshSubtasks(tplSubtasks);
    captureTaskRects();
    setTasks(prev=>withNewTask(prev,task,subtasks));
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
      // over about 1.3-1.8s, and sets down as it arrives, riding above the
      // cards it passes. The others just make room, quicker and without the
      // lift. The lift comes back down during the slide, not after it: landing
      // first and shrinking afterwards read as two separate moves.
      const lead=dist===farthest&&moves.length>1;
      if(lead){
        const duration=Math.min(1800,1100+dist*0.95);
        el.style.zIndex="3";
        // The slide is one eased move from start to finish. The lift is a
        // separate animation on `scale` laid over it, so there's no keyframe
        // in the middle of the slide for it to slow down at: with the lift as
        // a first segment of the same animation, the card rose, hesitated,
        // and then set off (plain to see at slower animation speeds).
        const anim=el.animate([{transform:from},{transform:"none"}],{duration,easing:"cubic-bezier(.45,0,.2,1)"});
        el.animate([{scale:"1",easing:"ease-out"},{scale:"1.025",offset:0.2,easing:"ease-in-out"},{scale:"1"}],{duration});
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
    setTasks(prev=>withoutTasks(prev,ids));
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
    const after=skipPatch(task,todayISO());
    changeTasks(prev=>patchTask(prev,id,after),`skip "${task.title}"`,
      `"${task.title}" skipped to ${formatDate(after.dueDate)}`);
  }
  function snoozeTask(id:number,kind:SnoozeKind){
    const task=tasks.find(t=>t.id===id);
    if(!task)return;
    const target=snoozeTarget(kind);
    const after=snoozePatch(task,target);
    changeTasks(prev=>patchTask(prev,id,after),`snooze "${task.title}"`,
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
    setTasks(prev=>patchTask(prev,id,{subtasks}));
  }
  function setPriorityOverride(id:number,override:Priority|null){
    setTasks(prev=>patchTask(prev,id,{priorityOverride:override??undefined}));
  }
  function setTaskTags(id:number,tags:string[]){
    setTasks(prev=>patchTask(prev,id,{tags}));
  }
  // A fresh copy: not done, no logged sessions, subtasks unchecked, and not
  // linked to the original's repeat chain.
  function duplicateTask(id:number):Task|null{
    const src=tasks.find(t=>t.id===id);
    if(!src)return null;
    const copy=duplicateOf(src,tasks);
    captureTaskRects();
    setTasks(prev=>[...prev,copy]);
    return copy;
  }
  function archiveTask(id:number){
    const task=tasks.find(t=>t.id===id);
    if(!task)return;
    changeTasks(prev=>patchTask(prev,id,{archived:true}),`archive "${task.title}"`,`"${task.title}" archived`);
  }
  function unarchiveTask(id:number){
    const task=tasks.find(t=>t.id===id);
    if(!task)return;
    changeTasks(prev=>patchTask(prev,id,{archived:false}),`restore "${task.title}"`,`"${task.title}" restored`);
  }
  // The task detail's Edit panel.
  function editTask(id:number,patch:Partial<Task>){
    const task=tasks.find(t=>t.id===id);
    if(!task)return;
    changeTasks(prev=>patchTask(prev,id,patch),`edit "${task.title}"`,`"${patch.title??task.title}" updated`);
  }
  function bulkMarkDone(ids:number[]){
    changeTasks(prev=>setDone(prev,ids,true),`complete ${plural(ids.length)}`,`${plural(ids.length)} completed`);
    exitSelectionMode();
  }
  function bulkArchive(ids:number[]){
    changeTasks(prev=>patchTasks(prev,ids,()=>({archived:true})),`archive ${plural(ids.length)}`,`${plural(ids.length)} archived`);
    exitSelectionMode();
  }
  function bulkDelete(ids:number[]){
    deleteTasks(ids);
    exitSelectionMode();
  }
  function bulkSetDue(ids:number[],dueDate:string){
    // Keeps each task's own due time; clearing the date clears the time too
    // (a time with no date means nothing), same as the Edit panel.
    changeTasks(prev=>patchTasks(prev,ids,dueDatePatch(dueDate)),
      `set the due date of ${plural(ids.length)}`,dueDate?`${plural(ids.length)} due ${formatDate(dueDate)}`:`Due date cleared on ${plural(ids.length)}`);
    exitSelectionMode();
  }
  function bulkSetPriority(ids:number[],p:Priority|null){
    changeTasks(prev=>patchTasks(prev,ids,()=>({priorityOverride:p??undefined})),
      `set the priority of ${plural(ids.length)}`,p?`${plural(ids.length)} set to ${p} priority`:`${plural(ids.length)} back to automatic priority`);
    exitSelectionMode();
  }
  function bulkSetSubject(ids:number[],subject:string){
    changeTasks(prev=>patchTasks(prev,ids,()=>({subject})),`move ${plural(ids.length)} to ${subject||"no subject"}`,`${plural(ids.length)} moved to ${subject||"no subject"}`);
    exitSelectionMode();
  }
  function exportAllDataJSON(){
    const data={
      exportedAt:new Date().toISOString(),
      tasks,subjects,subjectColors,templates,
      settings:{themeMode,layout,groupBy,colorCodeUrgency,showDone,showSuggestion,autoArchiveDays,notificationsEnabled,enabledOffsets,timeFormat,weekStart,pomodoroWorkMins,pomodoroBreakMins,autoStartBreaks},
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
      const read=readBackup(data,tasks,subjects);
      if(!read){
        setImportBackupNote("That file doesn't look like a DuePlanner export.");
        return;
      }
      const {fresh,skipped,extraSubjects,colors,templates:importedTemplates}=read;
      if(fresh.length)setTasks(prev=>[...prev,...fresh]);
      if(extraSubjects?.length)setSubjects(prev=>withImportedSubjects(prev,extraSubjects));
      if(colors)setSubjectColors(prev=>withImportedColors(prev,colors));
      if(importedTemplates)setTemplates(prev=>withImportedTemplates(prev,importedTemplates));
      setImportBackupNote(`Imported ${fresh.length} task${fresh.length===1?"":"s"}${skipped?` (${skipped} already here)`:""}.`);
    }catch{
      setImportBackupNote("Couldn't read that file. Pick a .json file from \"Export all (JSON)\".");
    }
  }
  function exportTasksCSV(){
    downloadFile(`dueplanner-tasks-${todayISO()}.csv`,tasksCsv(tasks),"text/csv");
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
    const moved=movedOrder(allSorted.filter(t=>!t.done).map(t=>t.id),id,delta);
    if(!moved)return;
    captureTaskRects("quick");
    setTasks(prev=>withOrder(prev,moved.order));
    setSrMessage(`Moved to position ${moved.position} of ${moved.count}`);
    requestAnimationFrame(()=>document.querySelector<HTMLElement>(`[data-task-id="${id}"] [data-reorder]`)?.focus());
  }

  // Tracks which row a pointer is currently down on, purely via refs, so a plain
  // tap causes zero state updates -- MiniCard is a nested component (recreated
  // every parent render), so a setState on pointerdown would remount the pressed
  // row mid-gesture and silently swallow the browser's native click event. State
  // (swipeId/swipeX) only gets touched once a gesture actually locks in as a swipe.
  const swipeActiveId=useRef<number|null>(null);
  // Recent (time, x) samples of the swipe, for its speed at release.
  const swipeSamples=useRef<{t:number;y:number}[]>([]);
  function onSwipeStart(id:number,e:React.PointerEvent){
    swipeActiveId.current=id;
    swipeSamples.current=[{t:e.timeStamp,y:e.clientX}];
    swipeStart.current={x:e.clientX,y:e.clientY};
    swipeLocked.current=false;
    swipeMoved.current=false;
  }
  function onSwipeMove(id:number,e:React.PointerEvent){
    if(swipeActiveId.current!==id)return;
    const dx=e.clientX-swipeStart.current.x;
    const dy=e.clientY-swipeStart.current.y;
    if(!swipeLocked.current){
      // Sideways wins as soon as it's the larger direction: a thumb swipe
      // arcs, and demanding a nearly flat line made most swipes get dropped.
      if(Math.abs(dx)>=6&&Math.abs(dx)>Math.abs(dy)){
        swipeLocked.current=true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        setSwipeId(id);
      } else if(Math.abs(dy)>=10&&Math.abs(dy)>=Math.abs(dx)){
        swipeActiveId.current=null; // vertical intent -- let the page scroll instead
        return;
      } else return;
    }
    swipeMoved.current=true;
    swipeSamples.current.push({t:e.timeStamp,y:e.clientX}); if(swipeSamples.current.length>8)swipeSamples.current.shift();
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
    // Past the threshold, or a quick flick in that direction (as iOS lists do).
    const v=releaseVelocity(swipeSamples.current);
    if(dx<=-SWIPE_THRESHOLD||(v<-SWIPE_FLICK&&dx<-24))deleteTask(id);
    else if(dx>=SWIPE_THRESHOLD||(v>SWIPE_FLICK&&dx>24))toggleDone(id);
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
    // "all", not just transform: in every layout but the List this lands on the
    // card itself, where a transform-only transition replaced the card's own
    // (.tc), so its hover lift eased but its brightness and colours snapped.
    return {transform:dx?`translateX(${dx}px)`:undefined,transition:active?"none":"all .2s ease-out",touchAction:"pan-y"};
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
  const css=useMemo(()=>buildCss({bg:T.bg,card:T.card,cardAlt:T.cardAlt,border:T.border,borderFaint:T.borderFaint,solidBorder:T.solidBorder,text:T.text,textMuted:T.textMuted,light:T.light,accent:T.accent},{body:F.body}),[T.bg,T.card,T.cardAlt,T.border,T.borderFaint,T.solidBorder,T.text,T.textMuted,T.light,T.accent,F.body]);


  // Session timer -- elapsed time from a fixed start, not a per-second
  // counter, so time worked while the tab is in the background or the screen
  // is locked (when browsers slow or pause timers) still counts.
  const sessionStartRef=useRef(0);
  useEffect(()=>{
    if(!sessionActive)return;
    const tick=()=>setSessionSecs(secondsSince(sessionStartRef.current,Date.now()));
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
    const mins=sessionMinutes(sessionSecs);
    if(!selectedTask||mins==null){setSessionSecs(0);return;}
    const id=selectedTask.id;
    setTasks(prev=>withSession(prev,id,mins,Date.now()));
    setSessionSecs(0);
  }
  // Leaving the task page ends (and logs) a session running on it; the sheet
  // doesn't need this, since it can't be closed mid-session. Declared below
  // endSession on purpose (see the React Compiler note in CLAUDE.md).
  function leaveTaskPage(){if(activeTab!=="task")return;if(sessionActive)endSession();setSelectedTask(null);}
  function navTo(tab:string){leaveTaskPage();setActiveTab(tab);setDrawerOpen(false);}
  function openTaskPage(t:Task){if(sessionActive&&selectedTask?.id!==t.id)endSession();setSelectedTask(t);setActiveTab("task");setDrawerOpen(false);}

  // If the open task disappears from under the detail panel -- deleted on
  // another device, or signed out -- close it (and stop any session on it,
  // which would have nowhere to be logged) rather than showing a stale copy
  // whose edits go nowhere, with the page behind still made inert.
  useEffect(()=>{
    if(!selectedTask||tasks.some(t=>t.id===selectedTask.id))return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedTask(null);setSessionActive(false);setSessionSecs(0);setActiveTab(t=>t==="task"?"tasks":t);
  },[tasks,selectedTask]);

  // "Take me there" on an Inbox update (WhatsNewItem.go): opens the place
  // ("settings", "tasks", "task", "calendar", "history", "import", "menu", "profile", "focus") and then
  // highlights the data-tour anchor, if any. Shows where things are rather than
  // doing them -- e.g. it points at Select instead of starting a selection.
  function goTo(dest:string){
    const [place,anchor]=dest.split(":");
    setOpenUpdate(null);
    // "menu" opens the sidebar itself, and so does an anchor on one of its rows
    // (tab-*); everything else closes the drawer.
    if(place==="menu"||anchor?.startsWith("tab-"))openSidebar();else setDrawerOpen(false);
    if(place==="history"||place==="import"||place==="calendar")setActiveTab(place);
    // A "Take me there" into Import/Export opens its dropdowns, so the anchor exists.
    if(place==="import")setOpenInbox(prev=>[...new Set([...prev,"import-syllabus","import-backup"])]);
    if(place==="settings"){
      setActiveTab("options");
      // Open the dropdown holding the anchor first.
      const section=({layout:"looks","anim-speed":"looks","date-time":"datetime","calendar-days":"datetime","focus-timer":"focus","focus-show":"focus","new-task-questions":"questions",subjects:"subjects",reminders:"reminders"} as Record<string,string>)[anchor];
      if(section)setOpenSettings(prev=>prev.includes(section)?prev:[...prev,section]);
    }
    if(place==="tasks")setActiveTab("tasks");
    if(place==="tasks"||place==="task")setSubjectFilter(null);
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
    // Ranks ("do first", "next up") hold still while a completed task is in its
    // hold (justDone): it keeps its place in the ranking until it settles.
    const pending=allSorted.filter(t=>heldOpen(t,justDone));
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
    // Every layout swipes (right: done, left: delete), strikes a done title the
    // same way, and labels due dates the same way (a live countdown for tasks
    // due today at a time). A task just completed stays in its column or tier
    // until it settles, as it holds its place in the List.
    // Use it too for anything that sets a card's size (a due label, a badge):
    // if that vanished at the tick, the card would shrink and its neighbours
    // shift once now and again when it moves.
    const settled=(t:Task)=>isSettled(t,justDone);
    const dueText=(t:Task)=>countdown(t.dueDate,t.dueTime,now)??daysUntil(t.dueDate);
    const titleClass=(t:Task)=>"title-btn"+(t.done?(justDone.includes(t.id)?" strike strike-anim":" strike"):"");
    // The done-check pops as it fills, as the List's does (MiniCard).
    const chkPop=(t:Task)=>!selectionMode&&justDone.includes(t.id)?"hit check-pop":"hit";

    if (layout==="checklist") return (
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {tasks.map((t,i)=>{const pr=getPriority(t.dueDate,t.estMins,t.priorityOverride);return(
          <div key={t.id} data-task-id={t.id} style={{position:"relative",overflow:"hidden",borderRadius:10}}>
            {renderSwipeReveal(t.id)}
            <div className="tc" onClick={swipeClickGuard(()=>openOrSelect(t))} data-selected={selectionMode&&selectedIds.includes(t.id)||undefined} {...(selectionMode?{}:swipeHandlers(t.id))} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 14px",background:T.card,borderRadius:10,border:`1px solid ${T.border}`,cursor:"pointer",...swipeContentStyle(t.id)}}>
              <span style={{fontFamily:F.body,fontSize:11,color:T.textFaint,minWidth:18}}>{String(i+1).padStart(2,"0")}</span>
              <button className={chkPop(t)} aria-label={selectionMode?(selectedIds.includes(t.id)?`Deselect ${t.title}`:`Select ${t.title}`):t.done?`Mark ${t.title} not done`:`Mark ${t.title} done`} onClick={e=>{e.stopPropagation();if(selectionMode)toggleSelected(t.id);else toggleDone(t.id);}} style={{width:20,height:20,border:`2px solid ${chk(t).on?chk(t).color:T.textFaint}`,borderRadius:4,background:chk(t).on?chk(t).color:"none",cursor:"pointer",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",padding:0,transition:"all .2s ease-out"}}>
                {chk(t).on&&<CheckMark size={12} color={selectionMode?contrastColor(T.accent):undefined} animate={!selectionMode&&justDone.includes(t.id)}/>}
              </button>
              <span role="button" tabIndex={0} onKeyDown={activateOnKey} className={titleClass(t)} aria-haspopup="dialog" style={{fontFamily:F.body,fontSize:13,flex:1,color:t.done?T.textFaint:T.text,transition:"color .2s ease-out"}}>{t.title}</span>
              {!settled(t)&&<span style={{fontFamily:F.body,fontSize:10,color:ink(priColor(pr,colorCodeUrgency),T.light)}}>{dueText(t)}</span>}
              {!selectionMode&&<button className="hit" aria-label={`Delete ${t.title}`} style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:14,lineHeight:1}} onClick={e=>{e.stopPropagation();deleteTask(t.id);}}>×</button>}
            </div>
          </div>
        );})}
      </div>
    );

    if (layout==="board") return (
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(165px,1fr))",gap:10}}>
        {tasks.map(t=>{const pr=getPriority(t.dueDate,t.estMins,t.priorityOverride);const sc=subjectColors[t.subject]||T.accent;return(
          <div key={t.id} data-task-id={t.id} style={{position:"relative",overflow:"hidden",borderRadius:12,display:"flex"}}>{renderSwipeReveal(t.id)}<div className="tc" onClick={swipeClickGuard(()=>openOrSelect(t))} data-selected={selectionMode&&selectedIds.includes(t.id)||undefined} {...(selectionMode?{}:swipeHandlers(t.id))} style={{background:T.card,borderRadius:12,padding:"13px",border:`1px solid ${T.border}`,position:"relative",overflow:"hidden",display:"flex",flexDirection:"column",gap:7,cursor:"pointer",flex:1,minWidth:0,...swipeContentStyle(t.id)}}>
            <div style={{position:"absolute",top:0,left:0,right:0,height:3,background:priColor(pr,colorCodeUrgency),borderRadius:"12px 12px 0 0"}}/>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              {t.subject&&<span style={{background:sc+"22",color:ink(sc,T.light),borderRadius:999,padding:"2px 8px",fontFamily:F.body,fontSize:10}}>{t.subject}</span>}
              {!selectionMode&&<button className="hit hit-sm" aria-label={`Delete ${t.title}`} style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13,lineHeight:1,marginLeft:"auto"}} onClick={e=>{e.stopPropagation();deleteTask(t.id);}}>×</button>}
            </div>
            <span role="button" tabIndex={0} onKeyDown={activateOnKey} className={titleClass(t)} aria-haspopup="dialog" style={{fontFamily:F.heading,fontSize:14,color:t.done?T.textFaint:T.text,lineHeight:1.3,transition:"color .2s ease-out"}}>{t.title}</span>
            {t.dueDate&&<div style={{fontFamily:F.body,fontSize:10,color:T.textMuted}}>{formatDate(t.dueDate)}{!settled(t)?<span style={{color:ink(priColor(pr,colorCodeUrgency),T.light)}}> · {dueText(t)}</span>:null}</div>}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:"auto"}}>
              {t.estMins>0&&<span style={{fontFamily:F.body,fontSize:10,color:T.textMuted}}>{formatDuration(t.estMins)}</span>}
              <button className={chkPop(t)} aria-label={selectionMode?(selectedIds.includes(t.id)?`Deselect ${t.title}`:`Select ${t.title}`):t.done?`Mark ${t.title} not done`:`Mark ${t.title} done`} onClick={e=>{e.stopPropagation();if(selectionMode)toggleSelected(t.id);else toggleDone(t.id);}} style={{background:chk(t).on?chk(t).color:"none",border:`2px solid ${chk(t).on?chk(t).color:T.textFaint}`,borderRadius:"50%",width:17,height:17,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",padding:0,transition:"all .2s ease-out"}}>
                {chk(t).on&&<CheckMark size={9} color={selectionMode?contrastColor(T.accent):undefined} animate={!selectionMode&&justDone.includes(t.id)}/>}
              </button>
            </div>
          </div></div>
        );})}
      </div>
    );

    if (layout==="kanban") {
      // No tasks: nothing but the "nothing here" line below, as in the other layouts (not four empty columns).
      if(tasks.length===0)return null;
      const byPriority=prioritySplit(tasks,justDone);
      const cols=[{key:"high",label:"Urgent",tasks:byPriority.high},{key:"medium",label:"Soon",tasks:byPriority.medium},{key:"low",label:"Later",tasks:byPriority.low},{key:"done",label:"✓ Done",tasks:byPriority.done}];
      return(
        <div style={{display:"grid",gridTemplateColumns:"repeat(2,minmax(0,1fr))",gap:10}}>
          {cols.map(col=>(
            <div key={col.key} style={{background:T.surface,borderRadius:12,padding:"12px",border:`1px solid ${T.border}`}}>
              <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginBottom:10,fontWeight:500}}>{col.label} ({col.tasks.length})</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {col.tasks.map(t=>(
                  <div key={t.id} data-task-id={t.id} style={{position:"relative",overflow:"hidden",borderRadius:8}}>{renderSwipeReveal(t.id)}<div className="tc" onClick={swipeClickGuard(()=>openOrSelect(t))} data-selected={selectionMode&&selectedIds.includes(t.id)||undefined} {...(selectionMode?{}:swipeHandlers(t.id))} style={{background:T.card,borderRadius:8,padding:"9px 10px",border:`1px solid ${T.border}`,display:"flex",alignItems:"center",gap:7,cursor:"pointer",...swipeContentStyle(t.id)}}>
                    <button className={chkPop(t)} aria-label={selectionMode?(selectedIds.includes(t.id)?`Deselect ${t.title}`:`Select ${t.title}`):t.done?`Mark ${t.title} not done`:`Mark ${t.title} done`} onClick={e=>{e.stopPropagation();if(selectionMode)toggleSelected(t.id);else toggleDone(t.id);}} style={{background:chk(t).on?chk(t).color:"none",border:`1.5px solid ${chk(t).on?chk(t).color:T.textFaint}`,borderRadius:"50%",width:14,height:14,cursor:"pointer",flexShrink:0,padding:0,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .2s ease-out"}}>
                      {chk(t).on&&<CheckMark size={9} color={selectionMode?contrastColor(T.accent):undefined} animate={!selectionMode&&justDone.includes(t.id)}/>}
                    </button>
                    <span role="button" tabIndex={0} onKeyDown={activateOnKey} className={titleClass(t)} aria-haspopup="dialog" style={{fontFamily:F.body,fontSize:12,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:t.done?T.textFaint:T.text,transition:"color .2s ease-out"}}>{t.title}</span>
                    {!selectionMode&&<button className="hit" aria-label={`Delete ${t.title}`} style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:12,lineHeight:1}} onClick={e=>{e.stopPropagation();deleteTask(t.id);}}>×</button>}
                  </div></div>
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
            <div key={t.id} data-task-id={t.id} style={{position:"relative",overflow:"hidden",borderRadius:12}}>{renderSwipeReveal(t.id)}<div className="tc" onClick={swipeClickGuard(()=>openOrSelect(t))} data-selected={selectionMode&&selectedIds.includes(t.id)||undefined} {...(selectionMode?{}:swipeHandlers(t.id))} style={{background:T.card,borderRadius:12,padding:"13px 15px",border:`1px solid ${T.border}`,cursor:"pointer",...swipeContentStyle(t.id)}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <button className={chkPop(t)} aria-label={selectionMode?(selectedIds.includes(t.id)?`Deselect ${t.title}`:`Select ${t.title}`):t.done?`Mark ${t.title} not done`:`Mark ${t.title} done`} onClick={e=>{e.stopPropagation();if(selectionMode)toggleSelected(t.id);else toggleDone(t.id);}} style={{background:chk(t).on?chk(t).color:"none",border:`2px solid ${chk(t).on?chk(t).color:T.textFaint}`,borderRadius:"50%",width:18,height:18,cursor:"pointer",padding:0,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .2s ease-out"}}>
                    {chk(t).on&&<CheckMark size={10} color={selectionMode?contrastColor(T.accent):undefined} animate={!selectionMode&&justDone.includes(t.id)}/>}
                  </button>
                  <span role="button" tabIndex={0} onKeyDown={activateOnKey} className={titleClass(t)} aria-haspopup="dialog" style={{fontFamily:F.heading,fontSize:14,color:t.done?T.textFaint:T.text,transition:"color .2s ease-out"}}>{t.title}</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  {t.subject&&<span style={{background:sc+"22",color:ink(sc,T.light),borderRadius:999,padding:"1px 7px",fontFamily:F.body,fontSize:10}}>{t.subject}</span>}
                  {!selectionMode&&<button className="hit" aria-label={`Delete ${t.title}`} style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13,lineHeight:1}} onClick={e=>{e.stopPropagation();deleteTask(t.id);}}>×</button>}
                </div>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{flex:1,height:7,background:T.border,borderRadius:999}}>
                  <div style={{width:`${pct}%`,height:"100%",background:t.done?"#2ED573":priColor(pr,colorCodeUrgency),borderRadius:999,transition:"width 0.5s"}}/>
                </div>
                {(settled(t)||subs.length>0)&&<span style={{fontFamily:F.body,fontSize:10,color:T.textFaint,flexShrink:0}}>{settled(t)?"Done":`${doneSubs}/${subs.length}`}</span>}
                {t.estMins>0&&<span style={{fontFamily:F.body,fontSize:10,color:T.textMuted,flexShrink:0}}>{formatDuration(t.estMins)}</span>}
                {!settled(t)&&<span style={{fontFamily:F.body,fontSize:10,color:ink(priColor(pr,colorCodeUrgency),T.light),flexShrink:0}}>{dueText(t)}</span>}
              </div>
            </div></div>
          );
        })}
      </div>
    );

    if (layout==="pyramid") {
      const byPriority=prioritySplit(tasks,justDone);
      const highT=byPriority.high;
      const medT=byPriority.medium;
      const lowT=byPriority.low;
      const doneT=byPriority.done;
      return(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {[{tasks:highT,color:ink(priColor("high",colorCodeUrgency),T.light),label:"High Priority",w:"100%"},{tasks:medT,color:ink(priColor("medium",colorCodeUrgency),T.light),label:"Medium Priority",w:"85%"},{tasks:lowT,color:ink(priColor("low",colorCodeUrgency),T.light),label:"Low Priority",w:"65%"},{tasks:doneT,color:T.textFaint,label:"✓ Done",w:"45%"}].map(tier=>(
            tier.tasks.length>0&&(
              <div key={tier.label} style={{margin:"0 auto",width:tier.w}}>
                <div style={{fontFamily:F.body,fontSize:10,color:tier.color,marginBottom:5,textAlign:"center"}}>{tier.label}</div>
                <div style={{display:"flex",flexDirection:"column",gap:5}}>
                  {tier.tasks.map(t=>(
                    <div key={t.id} data-task-id={t.id} style={{position:"relative",overflow:"hidden",borderRadius:9}}>{renderSwipeReveal(t.id)}<div className="tc" onClick={swipeClickGuard(()=>openOrSelect(t))} data-selected={selectionMode&&selectedIds.includes(t.id)||undefined} {...(selectionMode?{}:swipeHandlers(t.id))} style={{background:T.card,borderRadius:9,padding:"9px 12px",border:`1px solid ${tier.color}44`,display:"flex",alignItems:"center",gap:8,cursor:"pointer",...swipeContentStyle(t.id)}}>
                      <button className={chkPop(t)} aria-label={selectionMode?(selectedIds.includes(t.id)?`Deselect ${t.title}`:`Select ${t.title}`):t.done?`Mark ${t.title} not done`:`Mark ${t.title} done`} onClick={e=>{e.stopPropagation();if(selectionMode)toggleSelected(t.id);else toggleDone(t.id);}} style={{background:chk(t).on?chk(t).color:"none",border:`1.5px solid ${chk(t).on?chk(t).color:T.textFaint}`,borderRadius:"50%",width:15,height:15,cursor:"pointer",flexShrink:0,padding:0,display:"flex",alignItems:"center",justifyContent:"center",transition:"all .2s ease-out"}}>
                        {chk(t).on&&<CheckMark size={9} color={selectionMode?contrastColor(T.accent):undefined} animate={!selectionMode&&justDone.includes(t.id)}/>}
                      </button>
                      <span role="button" tabIndex={0} onKeyDown={activateOnKey} className={titleClass(t)} aria-haspopup="dialog" style={{fontFamily:F.body,fontSize:12,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:t.done?T.textFaint:T.text,transition:"color .2s ease-out"}}>{t.title}</span>
                      {t.subject&&<span style={{fontFamily:F.body,fontSize:10,color:T.textMuted,flexShrink:0}}>{t.subject}</span>}
                      {!selectionMode&&<button className="hit" aria-label={`Delete ${t.title}`} style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:13,lineHeight:1}} onClick={e=>{e.stopPropagation();deleteTask(t.id);}}>×</button>}
                    </div></div>
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
      return <div style={{display:"flex",flexDirection:"column",gap:16}}>
        {groupTasks(tasks,groupBy).map(g=>(
          <div key={g.key}>
            <div className="sl" style={{color:T.textMuted,paddingTop:0}}>{g.label} ({g.tasks.length})</div>
            <div role="list" aria-label={g.label} style={{display:"flex",flexDirection:"column",gap:10}}>
              {g.tasks.map(t=><MiniCard key={t.id} task={t} rank={pending.indexOf(t)} swipeable {...mc(t)}/>)}
            </div>
          </div>
        ))}
      </div>;
    }
    return <div role="list" aria-label="Tasks" style={{display:"flex",flexDirection:"column",gap:10}}>{tasks.map(t=><MiniCard key={t.id} task={t} rank={pending.indexOf(t)} reorderable swipeable {...mc(t)}/>)}</div>;
  }


  const pomMin=Math.floor(pomodoroSecs/60); const pomSec=pomodoroSecs%60;
  // A running timer, for the sidebar's Focus row and the header pill.
  const runningTimer=pomodoroActive?`${String(pomMin).padStart(2,"0")}:${String(pomSec).padStart(2,"0")}`:swStartedAt!=null?formatStopwatch(swElapsed):null;
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

  // Saving the stopwatch logs its time to the focus task as a work session
  // (like a finished Pomodoro does) and clears it.
  function saveStopwatch(){
    if(!focusTask)return;
    const id=focusTask.id, mins=stopwatchMinutes(stopwatchTotal(swBanked,swStartedAt,wallClock()));
    setTasks(prev=>withSession(prev,id,mins,wallClock()));
    setLastWorkedTaskId(id);
    resetStopwatch();
    setSrMessage(`Logged ${formatDuration(mins)} to ${focusTask.title}`);
  }
  function renderStopwatchCard(){
    const running=swStartedAt!=null;
    const ghost={background:"none",border:`1px solid ${T.border}`,borderRadius:9,padding:"8px 14px",color:T.textMuted,fontFamily:F.body,fontSize:12,cursor:"pointer"};
    return (
      <div data-tour="stopwatch" style={{background:T.card,borderRadius:12,padding:"16px",border:`1px solid ${T.border}`,textAlign:"center"}}>
        <div className="sl" style={{color:T.textMuted,textAlign:"left"}}>Stopwatch</div>
        <div role="timer" aria-label="Stopwatch" style={{fontFamily:F.body,fontSize:34,color:T.text,fontWeight:500,fontVariantNumeric:"tabular-nums",margin:"6px 0 14px"}}>{formatStopwatch(swElapsed)}</div>
        <div style={{display:"flex",gap:8,justifyContent:"center",flexWrap:"wrap"}}>
          <button onClick={toggleStopwatch} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:9,padding:"8px 18px",fontFamily:F.body,fontSize:12,cursor:"pointer"}}>{running?"Pause":swElapsed>0?"Resume":"Start"}</button>
          {swElapsed>0&&<button onClick={resetStopwatch} style={ghost}>Reset</button>}
          {swElapsed>=30000&&focusTask&&<button onClick={saveStopwatch} style={ghost}>Log {formatDuration(stopwatchMinutes(swElapsed))} to task</button>}
        </div>
      </div>
    );
  }

  function renderPomodoroToast(){
    const shell:React.CSSProperties={position:"fixed",left:"calc(50% + var(--sb, 0px) / 2)",bottom:undoToast!=null&&!focusMode?76:20,transform:"translateX(-50%)",zIndex:1600,display:"flex",alignItems:"center",gap:10,background:T.card,border:`1px solid ${T.border}`,borderRadius:999,padding:"10px 10px 10px 16px",boxShadow:"0 6px 24px rgba(0,0,0,0.3)",maxWidth:"calc(100vw - 32px)"};
    // Outside Focus Mode, the end of a break shows its suggestion here; in
    // Focus Mode it's a card above the task instead (renderBreakSuggestion).
    if(breakEnded&&!focusMode&&nextSuggestion) return (
      <div role="status" style={shell}>
        <span style={{fontFamily:F.body,fontSize:12,color:T.text,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>Break's over, {suggestionIsContinue?"keep going on":"next up:"} {nextSuggestion.title}</span>
        <button onClick={startSuggested} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:999,padding:"6px 14px",fontSize:12,fontWeight:500,cursor:"pointer",flexShrink:0}}>Start</button>
        <button onClick={()=>setBreakEnded(false)} aria-label="Dismiss" className="hit" style={{background:"none",border:"none",color:T.textMuted,fontSize:15,cursor:"pointer",flexShrink:0,padding:"0 4px"}}>×</button>
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
          <button onClick={()=>setBreakEnded(false)} aria-label="Dismiss" className="hit" style={{background:"none",border:"none",color:T.textMuted,fontSize:15,cursor:"pointer",padding:"0 2px",lineHeight:1}}>×</button>
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
      <main className="app-shell" style={{background:T.bg,fontFamily:F.body,color:T.text,minHeight:"100dvh",display:"flex",flexDirection:"column",padding:20,transition:"background .2s ease-out,color .2s ease-out"}}>
        <style>{css}</style>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <h1 style={{fontFamily:F.heading,fontSize:20,color:T.accent,margin:0,fontWeight:400}}>Focus Mode</h1>
          <button onClick={()=>setFocusModeAnimated(false)} style={{background:"none",border:`1px solid ${T.border}`,borderRadius:9,padding:"8px 14px",color:T.textMuted,fontFamily:F.body,fontSize:12,cursor:"pointer"}}>Exit</button>
        </div>
        <div className="sec-body" style={{flex:1,display:"flex",flexDirection:"column",gap:16,justifyContent:"center",maxWidth:420,margin:"0 auto",width:"100%"}}>
          {renderBreakSuggestion()}
          {/* The task sits between the two timers; whichever are turned on, the
              group is centered in the screen by this container. */}
          {showsPomodoro(focusShow)&&renderPomodoroCard()}
          {focusTask?(
            <div className="pop" style={{background:T.gradientCard,borderRadius:16,padding:"20px",border:`1px solid ${T.accent}44`}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10,flexWrap:"wrap"}}>
                <span className="rb" style={{background:T.accent+"33",color:T.accent}}>{focusTask===topTask?"up next":"focusing on"}</span>
                {focusTask.subject&&<span style={{background:(subjectColors[focusTask.subject]||T.accent)+"22",color:ink(subjectColors[focusTask.subject]||T.accent,T.light),borderRadius:999,padding:"2px 8px",fontFamily:F.body,fontSize:10}}>{focusTask.subject}</span>}
                <button data-tour="change-task" onClick={()=>setFocusPickerOpen(o=>!o)} style={{marginLeft:"auto",background:"none",border:`1px solid ${T.border}`,borderRadius:999,padding:"2px 10px",color:T.textMuted,fontSize:10,cursor:"pointer"}}>{focusPickerOpen?"Close":"Change task"}</button>
              </div>
              {focusPickerOpen&&(
                <div className="sec-body" style={{display:"flex",flexDirection:"column",gap:4,marginBottom:12,maxHeight:180,overflowY:"auto"}}>
                  {allSorted.filter(t=>!t.done&&!t.archived).map(t=>(
                    <button key={t.id} onClick={()=>{if(t.id!==focusTask.id)creditPomodoro(focusTask.id);setFocusTaskId(t.id);setFocusPickerOpen(false);}}
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
              <button onClick={()=>{toggleDone(focusTask.id);creditPomodoro(focusTask.id);}} style={{marginTop:14,background:"#2ED57322",color:ink("#2ED573",T.light),border:"1px solid #2ED57344",borderRadius:11,padding:"11px",fontFamily:F.body,fontSize:13,cursor:"pointer",width:"100%"}}>Mark done</button>
            </div>
          ):(
            <div style={{textAlign:"center",color:T.textFaint,fontFamily:F.body,fontSize:13}}>Nothing left to focus on</div>
          )}
          {showsStopwatch(focusShow)&&renderStopwatchCard()}
        </div>
        {renderPomodoroToast()}
      </main>
    );
  }

  // A task's details: the bottom sheet over the page, or (page) a whole screen
  // for a task opened from the sidebar, which stays open after Mark done or
  // Archive where the sheet closes.
  const taskPage=activeTab==="task";
  const taskDetail=selectedTask&&(
      <ErrorBoundary fallback={()=>(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.6)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:20}}>
          <div style={{background:T.card,borderRadius:12,padding:24,maxWidth:320,textAlign:"center",display:"flex",flexDirection:"column",gap:12,border:`1px solid ${T.border}`}}>
            <div style={{color:T.text,fontFamily:F.body,fontSize:14}}>This task couldn't be displayed.</div>
            <button onClick={()=>{setSelectedTask(null);if(taskPage)setActiveTab("tasks");}} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:9,padding:"9px 16px",fontFamily:F.body,fontSize:13,cursor:"pointer"}}>Close</button>
          </div>
        </div>
      )}>
        <TaskModal page={taskPage}
          key={selectedTask.id}
          h24={h24}
          task={tasks.find(t=>t.id===selectedTask.id)||selectedTask}
          T={T} F={F} subjects={subjects} subjectColors={subjectColors} colorCodeUrgency={colorCodeUrgency} now={now}
          sessionActive={sessionActive} sessionSecs={sessionSecs}
          allTags={allTags}
          onClose={()=>{if(taskPage)navTo("tasks");else setSelectedTask(null);}}
          onStartSession={startSession} onEndSession={endSession}
          onToggleDone={()=>{if(sessionActive)endSession();toggleDone(selectedTask.id);if(!taskPage)setSelectedTask(null);}}
          onDelete={()=>{if(sessionActive)endSession();deleteTask(selectedTask.id);setSelectedTask(null);if(taskPage)setActiveTab("tasks");}}
          onUpdateSubtasks={subtasks=>updateSubtasks(selectedTask.id,subtasks)}
          onArchive={()=>{if(sessionActive)endSession();archiveTask(selectedTask.id);if(!taskPage)setSelectedTask(null);}}
          onRestore={()=>unarchiveTask(selectedTask.id)}
          onDuplicate={()=>{if(sessionActive)endSession();const copy=duplicateTask(selectedTask.id);if(copy)setSelectedTask(copy);}}
          onUpdateTask={patch=>editTask(selectedTask.id,patch)}
          onSnooze={kind=>snoozeTask(selectedTask.id,kind)}
          onSkipOccurrence={()=>skipOccurrence(selectedTask.id)}
          onSetPriorityOverride={override=>setPriorityOverride(selectedTask.id,override)}
          onSetTags={tags=>setTaskTags(selectedTask.id,tags)}
          onSaveAsTemplate={name=>saveAsTemplate(tasks.find(t=>t.id===selectedTask.id)||selectedTask,name)}
        />
      </ErrorBoundary>
  );

  return (
    <div className={"app-shell"+(sidebarFolded?" sb-folded":"")+(drawerOpen?" sb-drawer":"")} style={{background:T.bg,fontFamily:F.body,color:T.text,transition:"background .2s ease-out,color .2s ease-out"}}>
      <style>{css}</style>
      <div className="sb-backdrop" aria-hidden="true" onClick={()=>setDrawerOpen(false)}/>
      {/* The sidebar: profile on top, then search and every screen. inert under
          the same overlays as the page (see .app-inner below). */}
      <nav ref={sidebarRef} className="app-sidebar" aria-label="Main" inert={sheetTaskOpen||searchOpen||openUpdate!=null||openTime!=null||undefined}>
        <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:6}}>
          <button className="sb-row" data-tour="profile-row" onClick={()=>{setShowProfile(true);setDrawerOpen(false);}} style={{flex:1,minWidth:0,padding:"7px 8px"}}>
            {fbUser?.photoURL
              ?<img src={fbUser.photoURL} alt="" style={{width:26,height:26,borderRadius:"50%",objectFit:"cover",flexShrink:0}}/>
              :<span aria-hidden="true" style={{width:26,height:26,borderRadius:"50%",background:T.cardAlt,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
              </span>}
            <span style={{flex:1,minWidth:0}}>
              <span style={{display:"block",color:T.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fbUser?(fbUser.displayName||"Your account"):"Sign in"}</span>
              <span style={{display:"block",fontSize:10,marginTop:1,color:syncError?ink("#FF4757",T.light):T.textMuted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{!fbUser?"Sync across devices":syncError?"Sync issue":syncStatus}</span>
            </span>
          </button>
          <button onClick={closeSidebar} aria-label="Close sidebar" title="Close sidebar" className="hit hit-sm" style={{background:"none",border:"none",color:T.textMuted,cursor:"pointer",padding:8,borderRadius:8,display:"flex",flexShrink:0}}><IconSidebar/></button>
        </div>
        <SidebarRow icon={<IconSearch/>} label="Search" tour="sidebar-search" onClick={()=>{setDrawerOpen(false);setSearchOpen(true);}}/>
        <div className="sb-rule" aria-hidden="true"/>
        <SidebarRow icon={<IconTasks/>} label="Home" tour="tab-tasks" current={activeTab==="tasks"&&subjectFilterOn==null} onClick={()=>{if(activeTab==="tasks"&&subjectFilterOn!=null)captureTaskRects();setSubjectFilter(null);navTo("tasks");}}/>
        <SidebarRow icon={<IconCalendar/>} label="Calendar" tour="tab-calendar" current={activeTab==="calendar"} onClick={()=>navTo("calendar")}/>
        <SidebarRow icon={<IconFocus/>} label="Focus" tour="tab-focus" onClick={()=>{setDrawerOpen(false);setFocusModeAnimated(true);}}>
          {runningTimer&&<span style={{fontSize:11,color:T.text,fontVariantNumeric:"tabular-nums"}}>{runningTimer}</span>}
        </SidebarRow>
        {/* Subjects, each unfolding to its open tasks. Picking a name filters Home
            to it (picking it again, or Home, shows everything); a task opens its sheet. */}
        <SidebarSubjects groups={sidebarGroups} open={openSubjects} today={todayStr} subjectColors={subjectColors} T={T} F={F}
          onToggleOpen={name=>setOpenSubjects(o=>o.includes(name)?o.filter(n=>n!==name):[...o,name])}
          picked={activeTab==="tasks"?subjectFilterOn:null}
          onPick={name=>{if(activeTab==="tasks")captureTaskRects();setSubjectFilter(activeTab==="tasks"&&subjectFilterOn===name?null:name);navTo("tasks");}}
          currentTaskId={activeTab==="task"?selectedTask?.id??null:null}
          onOpenTask={openTaskPage}/>
        <div className="sb-rule" aria-hidden="true"/>
        <SidebarRow icon={<IconBell/>} label="Inbox" current={activeTab==="inbox"} onClick={()=>navTo("inbox")}>
          {unreadRecaps.length>0&&<span aria-label={`${unreadRecaps.length} unread`} style={{background:T.accent,color:contrastColor(T.accent),borderRadius:999,padding:"1px 7px",fontSize:10,fontWeight:600}}>{unreadRecaps.length}</span>}
        </SidebarRow>
        <SidebarRow icon={<IconHistory/>} label="History" current={activeTab==="history"} onClick={()=>navTo("history")}/>
        <SidebarRow icon={<IconImport/>} label="Import/Export" current={activeTab==="import"} onClick={()=>navTo("import")}/>
        <SidebarRow icon={<IconSettings/>} label="Settings" current={activeTab==="options"} onClick={()=>navTo("options")}/>
        <div style={{flex:1}}/>
        <div style={{fontFamily:F.body,fontSize:9,color:T.textFaint,padding:"10px 10px 2px"}}>DuePlanner, by due. studios</div>
      </nav>
      {/* inert while the task sheet is open, so screen readers and Tab stay in
          the dialog instead of wandering through the list behind it; and while
          the drawer covers it. */}
      <div className="app-inner" inert={sheetTaskOpen||searchOpen||openUpdate!=null||openTime!=null||drawerOpen||undefined}>
        {/* Header */}
        <header style={{position:"relative",display:"flex",alignItems:"flex-end",justifyContent:"space-between",marginBottom:5}}>
          {/* Hidden inline as well as by .sr-only, so it can never show as a
              second title while the stylesheet is still on its way. */}
          <h1 className="sr-only" style={{position:"absolute",width:1,height:1,margin:-1,padding:0,overflow:"hidden",clip:"rect(0,0,0,0)",whiteSpace:"nowrap",border:0}}>DuePlanner</h1>
          {/* The screen's name, always. While the sidebar is closed (a phone, or
              folded away) the button that opens it sits in front; the css hides
              it where the sidebar is showing. The name never swaps for a logo
              (it used to, which the user disliked). */}
          <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
            <button ref={sidebarOpenerRef} className="sb-open-btn hit" data-tour="sidebar-open" onClick={openSidebar} aria-label="Open sidebar" title="Open sidebar" aria-expanded={drawerOpen} style={{background:"none",border:"none",color:T.textMuted,padding:"6px 6px 6px 0",cursor:"pointer",display:"flex",flexShrink:0}}>
              <IconSidebar size={20}/>
            </button>
            <div style={{minWidth:0}}>
              <h2 style={{fontFamily:F.heading,fontSize:26,lineHeight:1,color:T.text,margin:0,fontWeight:400}}>{SCREEN_TITLES[activeTab]||"Home"}</h2>
              {fbUser&&!online&&<div title="Offline. Changes will sync when you're back online" style={{fontFamily:F.body,fontSize:9,color:ink("#FFA502",T.light),marginTop:3}}>offline</div>}
            </div>
          </div>
          <div style={{display:"flex",alignItems:"flex-end",gap:12}}>
          {/* A running Pomodoro or stopwatch, in view on every screen now that
              there's no tab bar to show it; opens Focus. */}
          {runningTimer&&<button className="timer-pill fade-in" onClick={()=>setFocusModeAnimated(true)} aria-label={`Timer running, ${runningTimer}. Open Focus`} style={{display:"flex",alignItems:"center",gap:6,background:T.card,border:`1px solid ${T.border}`,borderRadius:999,padding:"5px 10px",color:T.text,cursor:"pointer",fontFamily:F.body,fontSize:11,fontVariantNumeric:"tabular-nums",marginBottom:2}}>
            <IconFocus/>{runningTimer}
          </button>}
          <div ref={timeMenuRef} style={{position:"relative"}}>
            <button data-tour="time-left" onClick={()=>setTimeMenuOpen(o=>!o)} aria-haspopup="dialog" aria-expanded={timeMenuOpen} aria-label="Time left breakdown" style={{background:"none",border:"none",padding:0,cursor:"pointer",textAlign:"right",display:"block"}}>
              <div style={{fontFamily:F.body,fontSize:9,color:T.textFaint}}>Time left</div>
              <div style={{fontFamily:F.heading,fontSize:20,color:effectiveThemeMode==="dark"?"#fff":"#000"}}>{fmtMins(totalMins)}</div>
            </button>
            {timeMenuOpen&&(
              <div role="dialog" aria-label="Time left breakdown" className="sec-body" style={{position:"absolute",top:"calc(100% + 8px)",right:0,zIndex:200,width:250,maxWidth:"calc(100vw - 28px)",background:T.card,border:`1px solid ${T.border}`,borderRadius:14,boxShadow:"0 10px 34px rgba(0,0,0,0.4)",padding:"12px 14px"}}>
                <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>By due date</div>
                {timeByDue.length===0
                  ?<div style={{fontFamily:F.body,fontSize:12,color:T.textFaint}}>Nothing left to do</div>
                  :<div style={{display:"flex",flexDirection:"column",gap:7}}>
                    {/* Each row opens that group in depth (TimeDetail), growing out of the row. */}
                    {timeByDue.map(b=>(
                      <button key={b.key} onClick={e=>setOpenTime({kind:"due",key:b.key,origin:e.currentTarget})} aria-haspopup="dialog" style={{display:"flex",alignItems:"center",gap:8,width:"100%",background:"none",border:"none",padding:0,cursor:"pointer",textAlign:"left"}}>
                        <span style={{fontFamily:F.body,fontSize:12,color:b.key==="overdue"?"#FF4757":T.text,flex:1}}>{b.label}</span>
                        <span style={{fontFamily:F.body,fontSize:11,color:T.textMuted}}>{b.count} {b.count===1?"task":"tasks"}</span>
                        <span style={{fontFamily:F.body,fontSize:12,color:T.text,width:52,textAlign:"right"}}>{fmtMins(b.mins)}</span>
                        <span aria-hidden="true" style={{fontFamily:F.body,fontSize:12,color:T.textFaint}}>›</span>
                      </button>
                    ))}
                  </div>}
                {timeBySubject.length>0&&<>
                  <div style={{height:1,background:T.borderFaint,margin:"12px 0"}}/>
                  <div style={{fontFamily:F.body,fontSize:10,color:T.textMuted,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:10}}>By subject</div>
                  <div style={{display:"flex",flexDirection:"column",gap:10}}>
                    {timeBySubject.map(r=>{const c=r.name?(subjectColors[r.name]||T.accent):T.textMuted;return(
                      <button key={r.name} onClick={e=>setOpenTime({kind:"subject",key:r.name,origin:e.currentTarget})} aria-haspopup="dialog" style={{display:"block",width:"100%",background:"none",border:"none",padding:0,cursor:"pointer",textAlign:"left"}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <span style={{width:8,height:8,borderRadius:"50%",background:c,flexShrink:0}}/>
                          <span style={{fontFamily:F.body,fontSize:12,color:r.name?T.text:T.textMuted,flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.name||"No subject"}</span>
                          <span style={{fontFamily:F.body,fontSize:12,color:T.text,flexShrink:0}}>{fmtMins(r.mins)}</span>
                          <span style={{fontFamily:F.body,fontSize:11,color:T.textMuted,width:34,textAlign:"right",flexShrink:0}}>{r.pct}%</span>
                          <span aria-hidden="true" style={{fontFamily:F.body,fontSize:12,color:T.textFaint,flexShrink:0}}>›</span>
                        </div>
                        <div style={{height:3,borderRadius:99,background:T.cardAlt,marginTop:5,marginLeft:16,overflow:"hidden"}}>
                          <div style={{height:"100%",width:`${r.pct}%`,background:c,borderRadius:99}}/>
                        </div>
                        {r.spent>0&&<div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:4,marginLeft:16}}>{fmtMins(r.spent)} worked of {fmtMins(r.mins)} planned</div>}
                      </button>
                    );})}
                  </div>
                </>}
                {noEstimateCount>0&&(
                  <button onClick={()=>{setFilter("noest");navTo("tasks");setTimeMenuOpen(false);}} style={{display:"block",width:"100%",marginTop:12,background:"none",border:"none",padding:0,cursor:"pointer",textAlign:"left",fontFamily:F.body,fontSize:11,color:T.textMuted}}>
                    {noEstimateCount} {noEstimateCount===1?"task has":"tasks have"} no estimate, so the total is low. Show them ›
                  </button>
                )}
              </div>
            )}
          </div>
          </div>
        </header>
        <div aria-hidden="true" style={{height:1,background:T.accent,marginBottom:16}}/>

        <main className="app-main" style={selectionMode?{paddingBottom:130}:undefined}>

        {/* A task opened from the sidebar: the whole screen, fields always editable. */}
        {taskPage&&selectedTask&&<div className="sec-body" key={selectedTask.id}>
          <ScreenHeader title="Task" onBack={()=>navTo("tasks")} T={T} F={F}/>
          {taskDetail}
        </div>}

        {/* TASKS TAB */}
        {/* .sec-body: the same short fade-and-settle the Calendar tab opens with. */}
        {activeTab==="tasks"&&<div className="sec-body">
          {/* Suggestion -- hidden once there's no pending homework left (nothing
              to suggest), when turned off in Settings, or when its × hid this
              particular suggestion (see hiddenSuggestionFor). */}
          {suggestionTask&&(showSuggestion&&hiddenSuggestionFor!==suggestionTask.id?(
            <div style={{background:T.gradientCard,borderRadius:12,padding:"10px 12px",marginBottom:16,border:`1px solid ${T.accent}33`,position:"relative",overflow:"hidden"}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:8}}>
                <div style={{display:"flex",alignItems:"flex-start",gap:7,minWidth:0}}>
                  <span aria-hidden="true" style={{fontSize:12,marginTop:1}}>✦</span>
                  <span style={{fontFamily:F.body,fontSize:12,color:T.text,lineHeight:1.4,whiteSpace:"pre-line"}}>{suggestion}</span>
                </div>
                <button onClick={()=>setHiddenSuggestionFor(suggestionTask.id)} className="hit" aria-label="Hide this suggestion" title="Hide for now. It comes back when another task becomes most urgent" style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:16,lineHeight:1,padding:"0 2px",flexShrink:0}}>×</button>
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
            {subjectFilterOn!=null&&<button onClick={()=>{captureTaskRects();setSubjectFilter(null);}} aria-label={`Stop showing only ${subjectFilterOn||"No subject"}`} style={{background:T.accent,color:contrastColor(T.accent),border:`1px solid ${T.accent}`,borderRadius:999,padding:"4px 12px",fontFamily:F.body,fontSize:11,cursor:"pointer",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{subjectFilterOn||"No subject"} ×</button>}
            {selectionMode&&(()=>{
              const ids=filteredTasks.map(t=>t.id), all=ids.length>0&&ids.every(id=>selectedIds.includes(id));
              return <button onClick={()=>setSelectedIds(all?[]:ids)} style={{background:"none",border:`1px solid ${T.border}`,color:T.textMuted,borderRadius:999,padding:"4px 12px",fontFamily:F.body,fontSize:11,cursor:"pointer"}}>{all?"Select none":`Select all (${ids.length})`}</button>;
            })()}
            {/* The "Select" button that used to start selection mode was removed at
                the user's request; nothing turns selectionMode on now, so the bulk
                bar below is dormant until it gets another way in. */}
            {selectionMode&&<button onClick={exitSelectionMode} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:999,padding:"4px 12px",fontFamily:F.body,fontSize:11,cursor:"pointer"}}>Cancel</button>}
            <div style={{marginLeft:"auto",fontFamily:F.body,fontSize:10,color:T.textFaint}}>{visibleTasks.filter(t=>!t.done&&!t.archived).length} pending</div>
          </div>

          {renderTasks(filteredTasks)}
          {filteredTasks.length===0&&<div style={{textAlign:"center",color:T.textFaint,fontFamily:F.body,fontSize:12,padding:"32px 0"}}>{filter==="archived"?"No archived tasks":filter==="done"?"No completed tasks yet":filter==="pending"?"Nothing pending. Nice work!":filter==="noest"?"Every open task has an estimate":"Nothing here yet"}</div>}
          <div style={{marginTop:14}}>
            {!adding?(
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:10,paddingTop:10}}>
                <button data-tour="add" onClick={startAdding} style={{background:T.accent,color:contrastColor(T.accent),border:"none",borderRadius:14,padding:"13px 28px",fontFamily:F.heading,fontSize:17,cursor:"pointer",boxShadow:`0 4px 20px ${T.accentGlow}`,transition:"all .2s ease-out"}}>+ Add homework</button>
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
                <button onClick={()=>setAdding(false)} aria-label="Cancel" title="Cancel" className="hit" style={{position:"absolute",top:10,right:10,background:"none",border:"none",color:T.textFaint,fontSize:20,lineHeight:1,cursor:"pointer",padding:4}}>×</button>
                <div style={{display:"flex",gap:5,marginBottom:14,justifyContent:"center"}}>
                  {[...Array(askQuestions.length+1)].map((_,i)=><div key={i} style={{width:i===step+1?20:6,height:6,borderRadius:999,background:i<=step+1?T.accent:T.border,transition:"all .2s ease-out"}}/>)}
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
        </div>}

        {/* OPTIONS TAB */}
        {/* CALENDAR TAB */}
        {activeTab==="calendar"&&<>
          {/* Month grid, or the deck of due dates (DueDeck). */}
          <div style={{display:"flex",gap:6,marginBottom:10}}>
            {([["month","Month"],["deck","Deck"]] as const).map(([k,l])=>(
              <button key={k} data-tour={k==="deck"?"calendar-deck":undefined} onClick={()=>setCalendarView(k)} aria-pressed={calendarView===k} style={{background:calendarView===k?T.accent:"none",color:calendarView===k?contrastColor(T.accent):T.textMuted,border:`1px solid ${calendarView===k?T.accent:T.border}`,borderRadius:999,padding:"4px 12px",fontFamily:F.body,fontSize:11,cursor:"pointer"}}>{l}</button>
            ))}
          </div>
          {calendarView==="deck"
            ?<DueDeck tasks={tasks} T={T} F={F} subjectColors={subjectColors} h24={h24} now={now}
              onOpenTask={t=>setSelectedTask(t)} onToggleDone={toggleDone}/>
            :<CalendarView tasks={tasks} T={T} F={F} subjectColors={subjectColors} colorCodeUrgency={colorCodeUrgency}
              weekStart={weekStart} monthOnly={calendarMonthOnly} h24={h24} now={now}
              onOpenTask={t=>setSelectedTask(t)} onToggleDone={toggleDone} onAddOn={addHomeworkOn}/>}
        </>}
        {/* Inbox, History and Import/Export: full screens opened from the title
            menu, like Settings (they used to be dropdowns inside the menu). */}
        {activeTab==="inbox"&&(
          <div className="sec-body" style={{display:"flex",flexDirection:"column",gap:8}}>
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
                            <button onClick={()=>dismissMessage(item.id)} aria-label={`Dismiss ${item.headline}`} title="Dismiss" className="hit" style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:14,lineHeight:1,padding:"0 0 0 2px",flexShrink:0}}>×</button>
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
                            <button onClick={()=>dismissWhatsNew(item.id)} aria-label={`Dismiss ${item.headline}`} title="Dismiss" className="hit" style={{background:"none",border:"none",color:T.textFaint,cursor:"pointer",fontSize:14,lineHeight:1,padding:"0 0 0 2px",flexShrink:0}}>×</button>
                          </div>
                        ))}
                      </div>
            </SettingsSection>
          </div>
        )}
        {activeTab==="history"&&(
          <div className="sec-body" style={{display:"flex",flexDirection:"column",gap:8}}>
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
          <div className="sec-body" style={{display:"flex",flexDirection:"column",gap:8}}>
            <ScreenHeader title="Import/Export" onBack={()=>setActiveTab("tasks")} T={T} F={F}/>
            {/* Dropdowns like the Inbox's (same open list). */}
            <SettingsSection {...inboxSec("import-syllabus")} title="Import from Syllabus">
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
                        <div className="sec-body" style={{marginTop:12}}>
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
            </SettingsSection>
            <SettingsSection {...inboxSec("import-backup")} title="Backup & export">
                      <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                        <button data-tour="import-backup" onClick={()=>importFileRef.current?.click()} style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,padding:"9px 4px",cursor:"pointer",color:T.textMuted,fontFamily:F.body,fontSize:11}}>Import backup (JSON)</button>
                        <input ref={importFileRef} type="file" accept="application/json,.json" style={{display:"none"}} onChange={e=>{const f=e.target.files?.[0];if(f)importBackupJSON(f);e.target.value="";}}/>
                        <button onClick={exportAllDataJSON} style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,padding:"9px 4px",cursor:"pointer",color:T.textMuted,fontFamily:F.body,fontSize:11}}>Export all (JSON)</button>
                        <button onClick={exportTasksCSV} style={{flex:1,background:T.surface,border:`1px solid ${T.border}`,borderRadius:9,padding:"9px 4px",cursor:"pointer",color:T.textMuted,fontFamily:F.body,fontSize:11}}>Export tasks (CSV)</button>
                      </div>
                      {importBackupNote&&<div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,marginTop:8}}>{importBackupNote}</div>}
            </SettingsSection>
          </div>
        )}
        {activeTab==="options"&&(
          <div className="sec-body" style={{display:"flex",flexDirection:"column",gap:8}}>
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
                        style={{background:active?T.accent+"22":"none",border:`1.5px solid ${active?T.accent:T.border}`,borderRadius:11,padding:"10px 7px",cursor:"pointer",color:active?T.accent:T.textMuted,fontFamily:F.body,fontSize:11,display:"flex",flexDirection:"column",alignItems:"center",gap:5}}>
                        {icons[key]}
                        <span style={{fontWeight:500,fontSize:10}}>{l.name}</span>
                        <span style={{fontSize:9,opacity:0.6}}>{l.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              {/* Urgency color coding */}
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                <div><div className="sl" style={{color:T.textMuted,paddingTop:0}}>Urgency Color Coding</div><div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:-4}}>Red for urgent, green for not urgent</div></div>
                <Toggle on={colorCodeUrgency} onChange={setColorCodeUrgency} T={T} label="Urgency Color Coding"/>
              </div>
              {/* Animation speed */}
              <div data-tour="anim-speed">
                <div style={{display:"flex",alignItems:"baseline",justifyContent:"space-between",gap:10}}>
                  <label htmlFor="anim-speed" className="sl" style={{color:T.textMuted,paddingTop:0}}>Animation speed</label>
                  <span style={{fontFamily:F.body,fontSize:11,color:T.text}}>{animSpeed}×{animSpeed===1?" (normal)":""}</span>
                </div>
                <input id="anim-speed" className="range" type="range" min={ANIM_SPEED.min} max={ANIM_SPEED.max} step={ANIM_SPEED.step} value={animSpeed}
                  onChange={e=>setAnimSpeed(clampSpeed(e.target.value))} aria-valuetext={`${animSpeed} times normal speed`}
                  style={{width:"100%",margin:"2px 0 4px",cursor:"pointer"}}/>
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
              <div style={{fontFamily:F.body,fontSize:11,color:T.textMuted,margin:"12px 0 6px"}}>Calendar shows</div>
              <div data-tour="calendar-days" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7}}>
                {([[true,"This month only"],[false,"Six full weeks"]] as const).map(([k,l])=>(
                  <button key={l} onClick={()=>setCalendarMonthOnly(k)} aria-pressed={calendarMonthOnly===k} style={{background:calendarMonthOnly===k?T.accent+"22":T.surface,border:`1.5px solid ${calendarMonthOnly===k?T.accent:T.border}`,borderRadius:9,padding:"8px 6px",cursor:"pointer",color:calendarMonthOnly===k?T.accent:T.textMuted,fontFamily:F.body,fontSize:11}}>{l}</button>
                ))}
              </div>
            </SettingsSection>
            {/* Focus timer (Pomodoro) */}
            <SettingsSection title="Focus timer" tour="focus-timer" {...sec("focus")}>
              <div data-tour="focus-show" style={{display:"flex",flexDirection:"column",gap:12,marginBottom:14}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                  <div><div style={{fontFamily:F.body,fontSize:12,color:T.text}}>Pomodoro timer</div><div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:1}}>Show it in Focus, above the task</div></div>
                  <Toggle on={showsPomodoro(focusShow)} onChange={v=>setFocusShow(focusShowFor(v,showsStopwatch(focusShow)))} T={T} label="Pomodoro timer"/>
                </div>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
                  <div><div style={{fontFamily:F.body,fontSize:12,color:T.text}}>Stopwatch</div><div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:1}}>Show it in Focus, below the task</div></div>
                  <Toggle on={showsStopwatch(focusShow)} onChange={v=>setFocusShow(focusShowFor(showsPomodoro(focusShow),v))} T={T} label="Stopwatch"/>
                </div>
              </div>
              {showsPomodoro(focusShow)&&<>
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
              </>}
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
              {layout!=="list"&&groupBy!=="none"&&<div style={{fontFamily:F.body,fontSize:10,color:T.textFaint,marginTop:8}}>Grouping only shows in the List layout. You're using {LAYOUTS[layout].name}.</div>}
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
      <div className="sr-only" aria-live="polite">{srMessage}</div>
      {openTime&&(()=>{
        const inGroup=(t:Task)=>openTime.kind==="due"?dueBucket(t.dueDate,todayStr)===openTime.key:(t.subject||"")===openTime.key;
        // A task just checked off stays until it settles, like in the list.
        const list=tasks.filter(t=>!t.archived&&(!t.done||justDone.includes(t.id))&&inGroup(t));
        const title=openTime.kind==="due"?(DUE_BUCKETS.find(b=>b.key===openTime.key)?.label??"Time left"):(openTime.key||"No subject");
        return <TimeDetail title={title} kicker={openTime.kind==="due"?"Time left · by due date":"Time left · subject"}
          color={openTime.kind==="subject"&&openTime.key?(subjectColors[openTime.key]||T.accent):undefined}
          list={list} origin={openTime.origin} T={T} F={F} subjectColors={subjectColors} h24={h24} now={now}
          onOpenTask={t=>setSelectedTask(t)} onToggleDone={toggleDone}
          onClose={()=>{const o=openTime.origin;setOpenTime(null);requestAnimationFrame(()=>o.isConnected&&o.focus({preventScroll:true}));}}/>;
      })()}
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
      {!taskPage&&taskDetail}
      {showProfile&&<ProfileModal
        T={T} F={F}
        fbUser={fbUser} authPending={authPending} signInError={signInError} syncError={syncError} syncStatus={syncStatus}
        visibleTasks={visibleTasks.filter(t=>!t.archived)} totalMins={totalMins}
        subjects={subjects} subjectColors={subjectColors} colorCodeUrgency={colorCodeUrgency}
        taskCount={tasks.length} trashCount={trash.length}
        notificationsEnabled={notificationsEnabled} notificationNote={notificationNote} onToggleNotifications={toggleNotifications}
        devices={fbUser&&deviceList?.uid===fbUser.uid?listDevices(deviceList.map,thisDeviceId()):null}
        onSignOutDevice={signOutDevice} onSignOutOtherDevices={signOutOtherDevices} now={now}
        setShowProfile={setShowProfile}
        signInWithFirebase={signInWithFirebase}
        signOutFirebase={signOutFirebase}
      />}
      {renderPomodoroToast()}
      {/* Undo toast (any undoable change) -- bottom-center; lifted above the
          bulk-action bar when that's showing. */}
      {undoToast!=null&&(
        <div role="status" className="fade-in" style={{position:"fixed",left:"calc(50% + var(--sb, 0px) / 2)",bottom:selectionMode&&selectedIds.length>0?130:20,transform:"translateX(-50%)",zIndex:1500,display:"flex",alignItems:"center",gap:10,background:T.card,border:`1px solid ${T.border}`,borderRadius:999,padding:"10px 10px 10px 16px",boxShadow:"0 6px 24px rgba(0,0,0,0.3)",maxWidth:"calc(100vw - 32px)"}}>
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
        <div role="toolbar" aria-label="Bulk actions" style={{position:"fixed",left:"calc(50% + var(--sb, 0px) / 2)",bottom:20,transform:"translateX(-50%)",zIndex:1500,display:"flex",flexDirection:"column",gap:8,background:T.card,border:`1px solid ${T.border}`,borderRadius:16,padding:"10px 12px",boxShadow:"0 6px 24px rgba(0,0,0,0.3)",width:"min(520px, calc(100vw - 32px))",boxSizing:"border-box"}}>
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
                <button type="button" onClick={()=>setBulkDate(null)} aria-label="Cancel picking a date" className="hit" style={{background:"none",border:"none",color:T.textMuted,fontSize:15,cursor:"pointer",padding:"0 4px"}}>×</button>
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
