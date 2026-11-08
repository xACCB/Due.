import { useEffect, useMemo, useReducer, useState } from "react";
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
import { SETTINGS } from "./settings";
import * as Fx from "./focusTimer";
import * as S from "./taskStore";

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
  | { kind: "import"; build: (tasks: Task[]) => Task[] }
  | { kind: "undo" }
  | { kind: "redo" };

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
    case "import": return S.importTasks(s, op.build(s.tasks));
    case "undo": return S.undo(s);
    case "redo": return S.redo(s);
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
    const fresh = newRecaps(store.tasks, recapsChecked, today, weekStart);
    if (fresh.length) setRecaps(prev => mergeRecaps(prev, fresh));
    setRecapsChecked(today);
  }, [store.tasks, recapsChecked, today, weekStart, setRecaps, setRecapsChecked]);

  // Home's filter chip and subject filter, shared so the menu's subjects and
  // the Time left sheet can set them (the web's filter / subjectFilter). Not saved.
  const [homeFilter, setHomeFilter] = useState("all");
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);

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
    T, h24, questions, fz,
    homeFilter, setHomeFilter, subjectFilter, setSubjectFilter, focus, setFocus,
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
      textSize, setTextSize, layout, setLayout, groupBy, setGroupBy, showSuggestion, setShowSuggestion, hiddenSuggestionFor, setHiddenSuggestionFor,
      autoArchiveDays, setAutoArchiveDays, templates, setTemplates,
      recaps, setRecaps, openSubjects, setOpenSubjects,
    },
  };
}

export type AppValue = ReturnType<typeof useAppValue>;
