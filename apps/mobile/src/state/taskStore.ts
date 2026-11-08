// The phone app's task state as plain functions: what each task action does to
// the list, the Recently deleted entries and the undo history. Built only from
// @dueplanner/core (no React Native), so it's unit tested in `npm test`.
// AppState.tsx holds it in React and saves it.
//
// Undoable, as on the web (`changeTasks` there): add, complete, edit, archive,
// duplicate, delete. Not undoable, also as on the web: subtask ticks, tags,
// the priority override, and logged work sessions (`quietPatch`).
import type { HistoryAction, Task } from "@dueplanner/core/types";
import type { TrashEntry } from "@dueplanner/core/lib/trash";
import type { AddDraft } from "@dueplanner/core/lib/addFlow";
import { trashEntries } from "@dueplanner/core/lib/trash";
import { applyTaskStates, diffTasks } from "@dueplanner/core/lib/history";
import { setDone } from "@dueplanner/core/lib/tasks";
import { duplicateOf, patchTask, restoredInto, withNewTask, withTrashed, withoutTasks, withoutTrashed } from "@dueplanner/core/lib/taskActions";
import { withSession } from "@dueplanner/core/lib/timers";
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

// A new task from a title, or from the add questions' answers.
export function addTask(s: TaskStore, input: string | AddDraft): TaskStore {
  const d: AddDraft = typeof input === "string" ? { title: input, subject: "", dueDate: "", dueTime: "", estMins: 0 } : input;
  const title = oneLine(d.title).trim().slice(0, LIMITS.title);
  if (!title) return s;
  const task: Task = {
    id: 0, title, subject: d.subject, dueDate: d.dueDate, dueTime: d.dueDate ? d.dueTime : "",
    estMins: d.estMins, done: false, order: 0,
    ...(d.recurrence && d.recurrence !== "none" ? { recurrence: d.recurrence } : {}),
  };
  return changed(s, withNewTask(s.tasks, task), "Added");
}

export function toggleDone(s: TaskStore, id: number): TaskStore {
  const t = s.tasks.find(x => x.id === id);
  if (!t) return s;
  return changed(s, setDone(s.tasks, [id], !t.done), t.done ? "Marked not done" : "Completed");
}

// An undoable edit of a task's own fields. A patch that changes nothing adds no undo step.
export function editTask(s: TaskStore, id: number, patch: Partial<Task>, label = "Edited"): TaskStore {
  const t = s.tasks.find(x => x.id === id);
  if (!t || Object.entries(patch).every(([k, v]) => JSON.stringify(t[k as keyof Task]) === JSON.stringify(v))) return s;
  return changed(s, patchTask(s.tasks, id, patch), label);
}

// A change that isn't an undo step (subtask ticks, tags, priority override).
export function quietPatch(s: TaskStore, id: number, patch: Partial<Task>): TaskStore {
  if (!s.tasks.some(x => x.id === id)) return s;
  return { ...s, tasks: patchTask(s.tasks, id, patch) };
}

export function duplicateTask(s: TaskStore, id: number): TaskStore {
  const t = s.tasks.find(x => x.id === id);
  if (!t) return s;
  return changed(s, [...s.tasks, duplicateOf(t, s.tasks)], "Duplicated");
}

// A finished work session (Focus), logged to a task; not an undo step.
export function logSession(s: TaskStore, id: number, mins: number, at: number): TaskStore {
  if (mins < 1 || !s.tasks.some(x => x.id === id)) return s;
  return { ...s, tasks: withSession(s.tasks, id, mins, at) };
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

// Back from Recently deleted, at the end of the list.
export function restoreTask(s: TaskStore, id: number): TaskStore {
  const entry = s.trash.find(e => e.task.id === id);
  if (!entry) return s;
  return { ...s, tasks: restoredInto(s.tasks, entry), trash: withoutTrashed(s.trash, [id]) };
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
