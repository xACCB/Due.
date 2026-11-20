import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useColorScheme } from "react-native";
import type { HistoryAction, Task } from "@dueplanner/core/types";
import type { TrashEntry } from "@dueplanner/core/lib/trash";
import type { AddDraft } from "@dueplanner/core/lib/addFlow";
import { pruneTrash } from "@dueplanner/core/lib/trash";
import { migrateTasks, SCHEMA_VERSION } from "@dueplanner/core/lib/migrations";
import { askedQuestions } from "@dueplanner/core/constants";
import { THEMES } from "@dueplanner/core/themes";
import { scaledPx } from "@dueplanner/core/lib/textSize";
import { mergeRecaps, newRecaps } from "@dueplanner/core/lib/recaps";
import { todayISO } from "@dueplanner/core/lib/dates";
import { readJSON, writeJSON } from "../lib/storage";
import { usePersisted } from "../lib/usePersisted";
import { syncReminders } from "../lib/notifications";
import { SETTINGS, cleanSubjectColors, cleanSubjects } from "./settings";
import * as Fx from "./focusTimer";
import * as S from "./taskStore";
import { signOutEverywhere, startFirebase, takeExplicitSignIn, watchUser, type AuthUser } from "../lib/firebase";
import { forgetThisDevice, signOutDevice as removeDevice, signOutOtherDevices as keepOnlyThisDevice, startProfileSync, startTaskSync, watchDevices, type ProfileSync, type TaskSync } from "../lib/cloudSync";
import { listDevices, type DeviceMap } from "@dueplanner/core/lib/devices";
import { thisDeviceId } from "../lib/thisDevice";
import { router } from "expo-router";
import type { Profile } from "@dueplanner/core/lib/profile";
import { DEFAULT_SUBJECTS, DEFAULT_SUBJECT_COLORS, type LayoutName } from "@dueplanner/core/constants";
import { SYNC_MESSAGES } from "@dueplanner/core/lib/taskSync";

type Op =
  | { kind: "add"; input: string | AddDraft }
  | { kind: "toggle"; id: number }
  | { kind: "edit"; id: number; patch: Partial<Task>; label?: string }
  | { kind: "quiet"; id: number; patch: Partial<Task> }
  | { kind: "duplicate"; id: number }
  | { kind: "session"; id: number; mins: number; at: number }
  | { kind: "delete"; id: number }
  | { kind: "deleteMany"; ids: number[] }
  | { kind: "restore"; id: number }
  | { kind: "autoArchive"; cutoff: number }
  | { kind: "emptyTrash" }
  | { kind: "move"; id: number; delta: number }
  | { kind: "renameSubject"; old: string; next: string }
  | { kind: "import"; build: (tasks: Task[]) => Task[] }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "cloud"; tasks: Task[]; trash: TrashEntry[] }
  | { kind: "signedOut" };

function reduce(s: S.TaskStore, op: Op): S.TaskStore {
  switch (op.kind) {
    case "add": return S.addTask(s, op.input);
    case "toggle": return S.toggleDone(s, op.id);
    case "edit": return S.editTask(s, op.id, op.patch, op.label);
    case "quiet": return S.quietPatch(s, op.id, op.patch);
    case "duplicate": return S.duplicateTask(s, op.id);
    case "session": return S.logSession(s, op.id, op.mins, op.at);
    case "delete": return S.deleteTask(s, op.id);
    case "deleteMany": return S.deleteTasks(s, op.ids);
    case "restore": return S.restoreTask(s, op.id);
    case "autoArchive": return S.autoArchive(s, op.cutoff);
    case "emptyTrash": return S.emptyTrash(s);
    case "move": return S.moveTask(s, op.id, op.delta);
    case "renameSubject": return S.renameSubject(s, op.old, op.next);
    case "import": return S.importTasks(s, op.build(s.tasks));
    case "undo": return S.undo(s);
    case "redo": return S.redo(s);
    case "cloud": return S.fromCloud(s, op.tasks, op.trash);
    case "signedOut": return S.signedOut();
  }
}

// Saved tasks are brought up to this app's data version on the way in, the
// same migrations the web app runs (core's lib/migrations.ts).
function load(): S.TaskStore {
  const raw = readJSON<unknown>("hw-tasks", []);
  const tasks = Array.isArray(raw) ? migrateTasks(raw.filter(t => t && typeof t === "object") as Record<string, unknown>[], readJSON("hw-schema", 0)) : [];
  const rawTrash = readJSON<unknown>("hw-trash", []);
  const trash = pruneTrash(Array.isArray(rawTrash) ? (rawTrash as TrashEntry[]).filter(e => e && e.task && typeof e.deletedAt === "number") : []);
  return S.emptyStore(tasks, trash);
}

// What an undo step was, for the History screen's buttons (the web's describeAction).
function describe(a: HistoryAction): string {
  return a.type === "change" ? a.label : `delete ${a.tasks.length === 1 ? `"${a.tasks[0].title}"` : `${a.tasks.length} tasks`}`;
}

function useSetting<K extends keyof typeof SETTINGS>(name: K) {
  const s = SETTINGS[name];
  return usePersisted(s.key, s.initial as (typeof SETTINGS)[K]["initial"], s.clean as (raw: unknown) => (typeof SETTINGS)[K]["initial"]);
}

// Everything the screens share: the tasks (with undo), the settings and the
// active theme. Held once, by AppProvider (AppState.tsx).
export function useAppValue() {
  const [store, dispatch] = useReducer(reduce, undefined, load);

  useEffect(() => {
    writeJSON("hw-tasks", store.tasks);
    writeJSON("hw-schema", SCHEMA_VERSION);
  }, [store.tasks]);
  useEffect(() => { writeJSON("hw-trash", store.trash); }, [store.trash]);

  const [themeMode, setThemeMode] = useSetting("themeMode");
  const [colorCodeUrgency, setColorCodeUrgency] = useSetting("colorCodeUrgency");
  const [timeFormat, setTimeFormat] = useSetting("timeFormat");
  const [weekStart, setWeekStart] = useSetting("weekStart");
  const [calendarMonthOnly, setCalendarMonthOnly] = useSetting("calendarMonthOnly");
  const [calendarView, setCalendarView] = useSetting("calendarView");
  const [showDone, setShowDone] = useSetting("showDone");
  const [notifications, setNotifications] = useSetting("notifications");
  const [reminderOffsets, setReminderOffsets] = useSetting("reminderOffsets");
  const [pomodoroWork, setPomodoroWork] = useSetting("pomodoroWork");
  const [pomodoroBreak, setPomodoroBreak] = useSetting("pomodoroBreak");
  const [pomodoroAutoBreak, setPomodoroAutoBreak] = useSetting("pomodoroAutoBreak");
  const [focusShow, setFocusShow] = useSetting("focusShow");
  const [addQuestions, setAddQuestions] = useSetting("addQuestions");
  const [subjects, setSubjects] = useSetting("subjects");
  const [subjectColors, setSubjectColors] = useSetting("subjectColors");
  const [textSize, setTextSize] = useSetting("textSize");
  const [animSpeed, setAnimSpeed] = useSetting("animSpeed");
  // An animation's length at the Animation speed setting (the web's scaledMs).
  const ms = useMemo(() => (n: number) => Math.round(n / animSpeed), [animSpeed]);
  const [layout, setLayout] = useSetting("layout");
  const [groupBy, setGroupBy] = useSetting("groupBy");
  const [showSuggestion, setShowSuggestion] = useSetting("showSuggestion");
  const [hiddenSuggestionFor, setHiddenSuggestionFor] = useSetting("hiddenSuggestionFor");
  const [autoArchiveDays, setAutoArchiveDays] = useSetting("autoArchiveDays");
  const [templates, setTemplates] = useSetting("templates");
  // The Focus timers (Pomodoro and stopwatch), phone-only (hw-focus-state).
  // Held here so Home's header can show a running one (the web's timer pill);
  // the Focus tab runs them.
  const [focus, setFocus] = usePersisted<Fx.FocusState>("hw-focus-state", Fx.initialFocus(pomodoroWork), raw => Fx.cleanFocus(raw, pomodoroWork));
  const [recaps, setRecaps] = useSetting("recaps");
  const [recapsChecked, setRecapsChecked] = useSetting("recapsChecked");
  const [openSubjects, setOpenSubjects] = useSetting("openSubjects");


  // Home's filter chip and subject filter, shared so the menu's subjects and
  // the Time left sheet can set them (the web's filter / subjectFilter). Not saved.
  const [homeFilter, setHomeFilter] = useState("all");
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
  // The sidebar drawer (components/Sidebar.tsx), opened from any screen's header
  // or a swipe in from the left edge. Not saved: it starts closed.
  const [drawerOpen, setDrawerOpen] = useState(false);
  // The undo toast, one for the whole app as on the web (it stays while you
  // move between screens). `n` changes with every message, so a repeat of the
  // same text restarts its timer. Drawn by components/UndoToast.tsx.
  const [undoToast, setUndoToast] = useState<{ text: string; n: number } | null>(null);
  const sayUndo = useCallback((text: string) => setUndoToast(p => ({ text, n: (p?.n ?? 0) + 1 })), []);
  const hideUndo = useCallback(() => setUndoToast(null), []);
  // Who's signed in (Firebase Auth). `authReady` turns true once Firebase has
  // said, so a signed-in person doesn't see "Sign in" flash at launch.
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  useEffect(() => {
    let stop: (() => void) | null = null;
    let gone = false;
    startFirebase()
      .then(() => { if (!gone) stop = watchUser(u => { setUser(u); setAuthReady(true); }); })
      .catch(() => setAuthReady(true)); // no Firebase (e.g. no config file): stay signed out
    return () => { gone = true; stop?.(); };
  }, []);

  // Task sync (M3): while signed in, core's engine (lib/cloudSync.ts over
  // createTaskSync) keeps the tasks and Recently deleted in step with the
  // cloud, as the website does. It reads the store through a ref, and hears
  // about every local change from the effect below.
  const [syncReadyFor, setSyncReadyFor] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<{ pending: boolean; syncedAt: number | null }>({ pending: false, syncedAt: null });
  const [syncError, setSyncError] = useState<string | null>(null);
  const [newerData, setNewerData] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [newerProfile, setNewerProfile] = useState(false);
  const storeRef = useRef(store);
  useEffect(() => { storeRef.current = store; });
  const syncRef = useRef<TaskSync | null>(null);
  // The profile fields (users/{uid}), synced by core's createProfileSync:
  // what the website calls the profile, here six of the settings.
  const profile = useMemo<Profile>(() => ({ layout, colorCodeUrgency, subjects, subjectColors, timeFormat, weekStart: weekStart === 1 ? 1 : 0 }),
    [layout, colorCodeUrgency, subjects, subjectColors, timeFormat, weekStart]);
  const profileRef = useRef(profile);
  useEffect(() => { profileRef.current = profile; });
  const profileSyncRef = useRef<ProfileSync | null>(null);
  const applyProfile = useCallback((p: Partial<Profile>) => {
    if (p.layout !== undefined) setLayout(p.layout as LayoutName);
    if (p.colorCodeUrgency !== undefined) setColorCodeUrgency(p.colorCodeUrgency);
    if (p.subjects !== undefined) setSubjects(cleanSubjects(p.subjects));
    if (p.subjectColors !== undefined) setSubjectColors(cleanSubjectColors(p.subjectColors));
    if (p.timeFormat !== undefined) setTimeFormat(p.timeFormat);
    if (p.weekStart !== undefined) setWeekStart(p.weekStart);
  }, [setLayout, setColorCodeUrgency, setSubjects, setSubjectColors, setTimeFormat, setWeekStart]);
  const uid = user?.uid ?? null;
  useEffect(() => {
    if (!uid) return;
    let gone = false;
    let engine: TaskSync | null = null;
    let profileEngine: ProfileSync | null = null;
    startTaskSync(uid, {
      merged: (tasks, trash) => dispatch({ kind: "cloud", tasks, trash }),
      ready: () => setSyncReadyFor(uid),
      status: st => setSyncState(prev => ({ pending: st.pending, syncedAt: st.syncedAt ?? prev.syncedAt })),
      error: setSyncError,
      newer: setNewerData,
    }, { getLocal: () => ({ tasks: storeRef.current.tasks, trash: storeRef.current.trash }), mergeLocal: takeExplicitSignIn() })
      .then(e => {
        if (gone) { e.stop(); return; }
        engine = e; syncRef.current = e;
        // After the task engine's preparation, which reads whether the profile doc exists.
        profileEngine = startProfileSync(uid, { apply: applyProfile, error: setProfileError, newer: setNewerProfile }, profileRef.current);
        profileSyncRef.current = profileEngine;
      })
      .catch(() => { if (!gone) setSyncError("Couldn't prepare cloud sync. Please try again."); });
    return () => { gone = true; engine?.stop(); profileEngine?.stop(); syncRef.current = null; profileSyncRef.current = null; };
  }, [uid, applyProfile]);
  useEffect(() => { syncRef.current?.localChanged(store.tasks, store.trash); }, [store.tasks, store.trash]);
  useEffect(() => { profileSyncRef.current?.localChanged(profile); }, [profile]);

  // Signing out (Profile -> Sign out), as on the web: send a waiting write first
  // (capped at 3s: offline it would wait for the server), then leave nothing
  // of the account on the phone, since it's safe in the cloud: its tasks,
  // Recently deleted, subjects and their colours. Unlike the web, if the first
  // sync never finished they stay, since they may not have reached the cloud.
  // The account's device list (Profile -> Devices): the server's map, or null
  // while there's none to show. The watcher (lib/cloudSync.ts watchDevices)
  // is stopped before this phone signs itself out, so removing its own entry
  // isn't read as another device signing it out.
  const [deviceMap, setDeviceMap] = useState<{ uid: string; map: DeviceMap | null } | null>(null);
  const stopDevicesRef = useRef<(() => void) | null>(null);
  // Shown on the sign-in screen after another device signed this one out.
  const [signInNote, setSignInNote] = useState<string | null>(null);

  const signOut = useCallback(async () => {
    stopDevicesRef.current?.();
    stopDevicesRef.current = null;
    const engine = syncRef.current, profileEngine = profileSyncRef.current;
    const synced = (engine?.isReady() ?? false) && (profileEngine?.isReady() ?? false);
    try { await Promise.race([Promise.all([engine?.flush(), profileEngine?.flush()]), new Promise(r => setTimeout(r, 3000))]); } catch { /* shown as a sync error already */ }
    engine?.stop();
    profileEngine?.stop();
    syncRef.current = null;
    profileSyncRef.current = null;
    if (uid) await forgetThisDevice(uid);
    await signOutEverywhere();
    if (synced) {
      dispatch({ kind: "signedOut" });
      setSubjects([...DEFAULT_SUBJECTS]);
      setSubjectColors({ ...DEFAULT_SUBJECT_COLORS });
    }
    setRecaps([]);
    setRecapsChecked(null);
    setSyncReadyFor(null);
    setSyncState({ pending: false, syncedAt: null });
    setSyncError(null);
    setNewerData(false);
    setProfileError(null);
    setNewerProfile(false);
    setDeviceMap(null);
  }, [uid, setRecaps, setRecapsChecked, setSubjects, setSubjectColors]);

  // Watch the device list while signed in. When the server's list no longer
  // holds this phone, someone signed it out from another device: sign out
  // here too and say so on the sign-in screen.
  const signOutRef = useRef(signOut);
  useEffect(() => { signOutRef.current = signOut; });
  useEffect(() => {
    if (!uid) return;
    const stop = watchDevices(uid, {
      list: map => setDeviceMap({ uid, map }),
      signedOut: () => {
        stopDevicesRef.current = null;
        signOutRef.current()
          .then(() => { setSignInNote("This device was signed out from another device. Sign in again to keep syncing."); router.navigate("/profile"); })
          .catch(() => {});
      },
    });
    stopDevicesRef.current = stop;
    return () => { stop(); if (stopDevicesRef.current === stop) stopDevicesRef.current = null; };
  }, [uid]);
  const devices = useMemo(() => (uid && deviceMap?.uid === uid && deviceMap.map ? listDevices(deviceMap.map, thisDeviceId()) : null), [uid, deviceMap]);
  const signOutDevice = useCallback((id: string) => {
    if (uid && id !== thisDeviceId()) removeDevice(uid, id).catch(() => {});
  }, [uid]);
  const signOutOtherDevices = useCallback(() => {
    const mine = uid && deviceMap?.uid === uid ? deviceMap.map?.[thisDeviceId()] : undefined;
    if (uid && mine) keepOnlyThisDevice(uid, mine).catch(() => {}); // not confirmed in the list yet: nothing safe to keep
  }, [uid, deviceMap]);

  // Recaps, as on the web: when a day, week, month or year has ended since the
  // last check, write its snapshot (skipped when nothing was finished or worked
  // on). Checked on launch, on every change to the tasks, and each minute, so
  // a recap appears soon after midnight with the app open.
  const [today, setToday] = useState(todayISO);
  useEffect(() => {
    const id = setInterval(() => setToday(todayISO()), 60000);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    if (recapsChecked === today) return;
    if (uid && syncReadyFor !== uid) return; // signed in: wait for the first sync, as the web does
    const fresh = newRecaps(store.tasks, recapsChecked, today, weekStart);
    if (fresh.length) setRecaps(prev => mergeRecaps(prev, fresh));
    setRecapsChecked(today);
  }, [store.tasks, recapsChecked, today, weekStart, setRecaps, setRecapsChecked, uid, syncReadyFor]);

  // Auto-archive, re-checked whenever the tasks or the setting change (the web's effect).
  useEffect(() => {
    if (autoArchiveDays > 0) dispatch({ kind: "autoArchive", cutoff: Date.now() - autoArchiveDays * 86400000 });
  }, [store.tasks, autoArchiveDays]);

  const scheme = useColorScheme();
  const light = themeMode === "light" || (themeMode === "auto" && scheme === "light");
  const T = light ? THEMES.stealthLight : THEMES.stealth;
  const h24 = timeFormat === "24h";
  // A font size in the web's px, drawn at the Text size setting (core's scaledPx, the web's fz()).
  const fz = useMemo(() => (px: number) => scaledPx(px, textSize), [textSize]);
  const questions = useMemo(() => askedQuestions(addQuestions), [addQuestions]);

  // Reminders follow the tasks: rescheduled a moment after any change, so a
  // burst of edits makes one pass, not one per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { syncReminders(store.tasks, notifications, reminderOffsets, h24).catch(() => {}); }, 800);
    return () => clearTimeout(t);
  }, [store.tasks, notifications, reminderOffsets, h24]);

  return {
    T, h24, questions, fz, ms,
    homeFilter, setHomeFilter, subjectFilter, setSubjectFilter, focus, setFocus, drawerOpen, setDrawerOpen, user, authReady, undoToast, sayUndo, hideUndo, signOut,
    devices, signOutDevice, signOutOtherDevices, signInNote, clearSignInNote: () => setSignInNote(null),
    // Where sync stands, for Profile and the sidebar (the web's syncStatus/syncError).
    sync: { ready: !!uid && syncReadyFor === uid, pending: syncState.pending, syncedAt: syncState.syncedAt, error: syncError ?? profileError ?? (newerData || newerProfile ? SYNC_MESSAGES.newer : null) },
    tasks: store.tasks,
    trash: store.trash,
    canUndo: store.undo.length > 0,
    canRedo: store.redo.length > 0,
    add: (input: string | AddDraft) => dispatch({ kind: "add", input }),
    toggle: (id: number) => dispatch({ kind: "toggle", id }),
    edit: (id: number, patch: Partial<Task>, label?: string) => dispatch({ kind: "edit", id, patch, label }),
    quiet: (id: number, patch: Partial<Task>) => dispatch({ kind: "quiet", id, patch }),
    duplicate: (id: number) => dispatch({ kind: "duplicate", id }),
    logSession: (id: number, mins: number, at: number) => dispatch({ kind: "session", id, mins, at }),
    remove: (id: number) => dispatch({ kind: "delete", id }),
    removeMany: (ids: number[]) => dispatch({ kind: "deleteMany", ids }),
    restore: (id: number) => dispatch({ kind: "restore", id }),
    emptyTrash: () => dispatch({ kind: "emptyTrash" }),
    moveBy: (id: number, delta: number) => dispatch({ kind: "move", id, delta }),
    renameSubject: (old: string, next: string) => dispatch({ kind: "renameSubject", old, next }),
    importTasks: (build: (tasks: Task[]) => Task[]) => dispatch({ kind: "import", build }),
    undoLabel: store.undo.length ? describe(store.undo[store.undo.length - 1]) : null,
    redoLabel: store.redo.length ? describe(store.redo[store.redo.length - 1]) : null,
    undo: () => dispatch({ kind: "undo" }),
    redo: () => dispatch({ kind: "redo" }),
    settings: {
      themeMode, setThemeMode, colorCodeUrgency, setColorCodeUrgency, timeFormat, setTimeFormat,
      weekStart, setWeekStart, calendarMonthOnly, setCalendarMonthOnly, calendarView, setCalendarView, showDone, setShowDone,
      notifications, setNotifications, reminderOffsets, setReminderOffsets,
      pomodoroWork, setPomodoroWork, pomodoroBreak, setPomodoroBreak, pomodoroAutoBreak, setPomodoroAutoBreak,
      focusShow, setFocusShow, addQuestions, setAddQuestions,
      subjects, setSubjects, subjectColors, setSubjectColors,
      textSize, setTextSize, animSpeed, setAnimSpeed, layout, setLayout, groupBy, setGroupBy, showSuggestion, setShowSuggestion, hiddenSuggestionFor, setHiddenSuggestionFor,
      autoArchiveDays, setAutoArchiveDays, templates, setTemplates,
      recaps, setRecaps, openSubjects, setOpenSubjects,
    },
  };
}

export type AppValue = ReturnType<typeof useAppValue>;
