import { useEffect, useMemo, useReducer } from "react";
import { useColorScheme } from "react-native";
import type { Task } from "@dueplanner/core/types";
import type { TrashEntry } from "@dueplanner/core/lib/trash";
import type { AddDraft } from "@dueplanner/core/lib/addFlow";
import { pruneTrash } from "@dueplanner/core/lib/trash";
import { migrateTasks, SCHEMA_VERSION } from "@dueplanner/core/lib/migrations";
import { askedQuestions } from "@dueplanner/core/constants";
import { THEMES } from "@dueplanner/core/themes";
import { readJSON, writeJSON } from "../lib/storage";
import { usePersisted } from "../lib/usePersisted";
import { syncReminders } from "../lib/notifications";
import { SETTINGS } from "./settings";
import * as S from "./taskStore";

type Op =
  | { kind: "add"; input: string | AddDraft }
  | { kind: "toggle"; id: number }
  | { kind: "edit"; id: number; patch: Partial<Task>; label?: string }
  | { kind: "quiet"; id: number; patch: Partial<Task> }
  | { kind: "duplicate"; id: number }
  | { kind: "session"; id: number; mins: number; at: number }
  | { kind: "delete"; id: number }
  | { kind: "restore"; id: number }
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
    case "restore": return S.restoreTask(s, op.id);
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

  const scheme = useColorScheme();
  const light = themeMode === "light" || (themeMode === "auto" && scheme === "light");
  const T = light ? THEMES.stealthLight : THEMES.stealth;
  const h24 = timeFormat === "24h";
  const questions = useMemo(() => askedQuestions(addQuestions), [addQuestions]);

  // Reminders follow the tasks: rescheduled a moment after any change, so a
  // burst of edits makes one pass, not one per keystroke.
  useEffect(() => {
    const t = setTimeout(() => { syncReminders(store.tasks, notifications, reminderOffsets, h24).catch(() => {}); }, 800);
    return () => clearTimeout(t);
  }, [store.tasks, notifications, reminderOffsets, h24]);

  return {
    T, h24, questions,
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
    restore: (id: number) => dispatch({ kind: "restore", id }),
    undo: () => dispatch({ kind: "undo" }),
    redo: () => dispatch({ kind: "redo" }),
    settings: {
      themeMode, setThemeMode, colorCodeUrgency, setColorCodeUrgency, timeFormat, setTimeFormat,
      weekStart, setWeekStart, calendarMonthOnly, setCalendarMonthOnly, showDone, setShowDone,
      notifications, setNotifications, reminderOffsets, setReminderOffsets,
      pomodoroWork, setPomodoroWork, pomodoroBreak, setPomodoroBreak, pomodoroAutoBreak, setPomodoroAutoBreak,
      focusShow, setFocusShow, addQuestions, setAddQuestions,
      subjects, setSubjects, subjectColors, setSubjectColors,
    },
  };
}

export type AppValue = ReturnType<typeof useAppValue>;
