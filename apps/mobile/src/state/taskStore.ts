// The phone app's task state as plain functions: what add, complete, delete,
// undo and redo do to the list, the Recently deleted entries and the undo
// history. Built only from @dueplanner/core (no React Native), so it's unit
// tested in `npm test`. useTasks.ts holds it in React and saves it.
import type { HistoryAction, Task } from "@dueplanner/core/types";
import type { TrashEntry } from "@dueplanner/core/lib/trash";
import { trashEntries } from "@dueplanner/core/lib/trash";
import { applyTaskStates, diffTasks } from "@dueplanner/core/lib/history";
import { setDone } from "@dueplanner/core/lib/tasks";
import { withNewTask, withTrashed, withoutTasks, withoutTrashed } from "@dueplanner/core/lib/taskActions";
import { LIMITS, oneLine } from "@dueplanner/core/lib/limits";

export interface TaskStore {
  tasks: Task[];
  trash: TrashEntry[];
  undo: HistoryAction[];
  redo: HistoryAction[];
}

// Steps of undo kept in memory (not saved: they start empty each launch).
export const UNDO_MAX = 50;

export function emptyStore(tasks: Task[] = [], trash: TrashEntry[] = []): TaskStore {
  return { tasks, trash, undo: [], redo: [] };
}

function pushUndo(s: TaskStore, a: HistoryAction): Pick<TaskStore, "undo" | "redo"> {
  return { undo: [...s.undo, a].slice(-UNDO_MAX), redo: [] };
}

// Any change to the list that isn't a delete, recorded per task (core's history).
function changed(s: TaskStore, next: Task[], label: string): TaskStore {
  const { before, after } = diffTasks(s.tasks, next);
  if (!before.length) return s;
  return { ...s, tasks: next, ...pushUndo(s, { type: "change", before, after, label }) };
}

export function addTask(s: TaskStore, title: string): TaskStore {
  const clean = oneLine(title).trim().slice(0, LIMITS.title);
  if (!clean) return s;
  const blank: Task = { id: 0, title: clean, subject: "", dueDate: "", dueTime: "", estMins: 0, done: false, order: 0 };
  return changed(s, withNewTask(s.tasks, blank), "Added");
}

export function toggleDone(s: TaskStore, id: number): TaskStore {
  const t = s.tasks.find(x => x.id === id);
  if (!t) return s;
  return changed(s, setDone(s.tasks, [id], !t.done), t.done ? "Marked not done" : "Completed");
}

// Deleting moves the task to Recently deleted, as on the web.
export function deleteTask(s: TaskStore, id: number): TaskStore {
  const t = s.tasks.find(x => x.id === id);
  if (!t) return s;
  return {
    ...s,
    tasks: withoutTasks(s.tasks, [id]),
    trash: withTrashed(s.trash, trashEntries([t])),
    ...pushUndo(s, { type: "delete", tasks: [t] }),
  };
}

function applyAction(s: TaskStore, a: HistoryAction, forward: boolean): Pick<TaskStore, "tasks" | "trash"> {
  if (a.type === "change") return { tasks: applyTaskStates(s.tasks, forward ? a.after : a.before), trash: s.trash };
  const ids = a.tasks.map(t => t.id);
  return forward
    ? { tasks: withoutTasks(s.tasks, ids), trash: withTrashed(s.trash, trashEntries(a.tasks)) }
    : { tasks: applyTaskStates(s.tasks, a.tasks.map(t => [t.id, t])), trash: withoutTrashed(s.trash, ids) };
}

export function undo(s: TaskStore): TaskStore {
  const a = s.undo[s.undo.length - 1];
  if (!a) return s;
  return { ...s, ...applyAction(s, a, false), undo: s.undo.slice(0, -1), redo: [...s.redo, a] };
}

export function redo(s: TaskStore): TaskStore {
  const a = s.redo[s.redo.length - 1];
  if (!a) return s;
  return { ...s, ...applyAction(s, a, true), redo: s.redo.slice(0, -1), undo: [...s.undo, a] };
}

