// What each task action does to the data, as plain functions: given the list
// (or the trash, the subjects, the templates) as it is, return it as it should
// be. No React and no browser, so the website and a phone app can share them.
// What surrounds an action in the app -- the undo entry, the toast, the list
// animation -- stays with the screen that triggers it.
import type { Recurrence, Subtask, Task, TaskTemplate } from "../types";
import type { TrashEntry } from "./trash";
import { SUBJECT_COLOR_PALETTE } from "../constants";
import { advanceDate } from "./dates";
import { nextId } from "./id";
import { LIMITS } from "./limits";
import { nextOrder } from "./tasks";

// Recently deleted keeps at most this many entries (firestore.rules allows 500).
export const TRASH_MAX = 200;

// ---- One task, or several, changed in place ----

export function patchTask(tasks: Task[], id: number, patch: Partial<Task>): Task[] {
  return tasks.map(t => t.id === id ? { ...t, ...patch } : t);
}
// `patch` is asked per task, for changes that depend on the task itself.
export function patchTasks(tasks: Task[], ids: number[], patch: (t: Task) => Partial<Task>): Task[] {
  return tasks.map(t => ids.includes(t.id) ? { ...t, ...patch(t) } : t);
}
export function withoutTasks(tasks: Task[], ids: number[]): Task[] {
  return tasks.filter(t => !ids.includes(t.id));
}

// Skipping a repeating task moves it one repeat on (from today if it had no date).
export function skipPatch(task: Task, today: string): { dueDate: string } {
  return { dueDate: advanceDate(task.dueDate || today, task.recurrence as Recurrence) };
}
// Snoozing sets the new date; "in 3 hours" also sets a time, the others keep the task's own.
export function snoozePatch(task: Task, target: { dueDate: string; dueTime?: string }): { dueDate: string; dueTime: string } {
  return { dueDate: target.dueDate, dueTime: target.dueTime ?? task.dueTime };
}
// A due date for several tasks at once: each keeps its own time, and clearing
// the date clears the time too (a time with no date means nothing).
export function dueDatePatch(dueDate: string): (t: Task) => Partial<Task> {
  return t => ({ dueDate, dueTime: dueDate ? t.dueTime : "" });
}

// ---- New tasks ----

// A copy to work on again: fresh id, not done, unchecked subtasks, no logged
// sessions, at the end of the list, and detached from any repeat chain.
export function duplicateOf(src: Task, tasks: Task[]): Task {
  return { ...src, id: nextId(), done: false, completedAt: null, archived: false, spawnedNextId: null, sessions: [],
    order: nextOrder(tasks), ...(src.subtasks ? { subtasks: src.subtasks.map(s => ({ ...s, id: String(nextId()), done: false })) } : {}) };
}
// A template's subtasks as real, unchecked ones.
export function freshSubtasks(template: { text: string }[] | null): Subtask[] | undefined {
  return template ? template.map(s => ({ id: String(nextId()), text: s.text, done: false })) : undefined;
}
// The list with a newly created task at the end.
export function withNewTask(tasks: Task[], task: Task, subtasks?: Subtask[]): Task[] {
  return [...tasks, { ...task, id: nextId(), done: false, order: nextOrder(tasks), ...(subtasks ? { subtasks } : {}) }];
}

// ---- Templates ----

export function templateFromTask(task: Task, name: string): TaskTemplate {
  return { id: String(nextId()), name, subject: task.subject, estMins: task.estMins, recurrence: task.recurrence, subtasks: (task.subtasks || []).map(s => ({ text: s.text })) };
}
// What a template answers for the add-task questions; the due date is still asked.
export function taskFromTemplate(tpl: TaskTemplate) {
  return { title: tpl.name, subject: tpl.subject, dueDate: "", dueTime: "", estMins: tpl.estMins, recurrence: tpl.recurrence };
}

// ---- Recently deleted ----

// Newly deleted entries go on top, replacing any older entry for the same task.
export function withTrashed(trash: TrashEntry[], added: TrashEntry[]): TrashEntry[] {
  const ids = new Set(added.map(e => e.task.id));
  return [...added, ...trash.filter(e => !ids.has(e.task.id))].slice(0, TRASH_MAX);
}
export function withoutTrashed(trash: TrashEntry[], ids: number[]): TrashEntry[] {
  const s = new Set(ids);
  return trash.filter(e => !s.has(e.task.id));
}
// A deleted task back in the list, at the end; nothing changes if it's already there.
export function restoredInto(tasks: Task[], entry: TrashEntry): Task[] {
  return tasks.some(t => t.id === entry.task.id) ? tasks : [...tasks, { ...entry.task, order: nextOrder(tasks) }];
}

// ---- Manual order ----

// Moving one open task up or down by `delta` places: the new order number for
// every open task, plus where it ended up (for the screen reader message).
// `openIds` is the open tasks' ids in their current order. Null if it can't move.
export function movedOrder(openIds: number[], id: number, delta: number): { order: Map<number, number>; position: number; count: number } | null {
  const ids = [...openIds];
  const from = ids.indexOf(id), to = from + delta;
  if (from === -1 || to < 0 || to >= ids.length) return null;
  ids.splice(from, 1); ids.splice(to, 0, id);
  return { order: new Map(ids.map((tid, idx) => [tid, idx])), position: to + 1, count: ids.length };
}
export function withOrder(tasks: Task[], order: Map<number, number>): Task[] {
  return tasks.map(t => order.has(t.id) ? { ...t, order: order.get(t.id)! } : t);
}

// ---- Subjects ----

// A new subject and the first palette colour not in use, or null if the name
// is empty, already taken (ignoring case) or the list is full.
export function subjectToAdd(name: string, subjects: string[], subjectColors: Record<string, string>): { name: string; color: string } | null {
  const trimmed = name.trim();
  if (!trimmed || subjects.length >= LIMITS.subjects || subjects.some(s => s.toLowerCase() === trimmed.toLowerCase())) return null;
  const used = new Set(Object.values(subjectColors));
  const color = SUBJECT_COLOR_PALETTE.find(c => !used.has(c)) || SUBJECT_COLOR_PALETTE[subjects.length % SUBJECT_COLOR_PALETTE.length];
  return { name: trimmed, color };
}
// The trimmed new name for `old`, or null if it's empty or another subject has it.
export function subjectRename(old: string, name: string, subjects: string[]): string | null {
  const trimmed = name.trim();
  if (!trimmed || subjects.some(s => s !== old && s.toLowerCase() === trimmed.toLowerCase())) return null;
  return trimmed;
}
export function renamedSubjects(subjects: string[], old: string, next: string): string[] {
  return subjects.map(s => s === old ? next : s);
}
export function recolouredSubjects(colors: Record<string, string>, old: string, next: string, color: string): Record<string, string> {
  const out = { ...colors }; delete out[old]; out[next] = color; return out;
}
export function withoutSubjectColor(colors: Record<string, string>, name: string): Record<string, string> {
  const out = { ...colors }; delete out[name]; return out;
}
// A rename carries to everything filed under the old name.
export function tasksRenamedSubject(tasks: Task[], old: string, next: string): Task[] {
  return tasks.map(t => t.subject === old ? { ...t, subject: next } : t);
}
export function trashRenamedSubject(trash: TrashEntry[], old: string, next: string): TrashEntry[] {
  return trash.map(e => e.task.subject === old ? { ...e, task: { ...e.task, subject: next } } : e);
}
export function templatesRenamedSubject(templates: TaskTemplate[], old: string, next: string): TaskTemplate[] {
  return templates.map(tp => tp.subject === old ? { ...tp, subject: next } : tp);
}
