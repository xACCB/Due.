import type { TaskStates } from "./lib/history";

// Small shared types used by both App.tsx and the pure lib/ modules -- kept
// here (rather than duplicated) so lib/ functions like getPriority/advanceDate
// don't need to import from App.tsx itself.
export type Priority = "high"|"medium"|"low";
export type Recurrence = "none"|"daily"|"weekly"|"monthly";

export interface Subtask { id:string; text:string; done:boolean; }
export interface Task {
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
export interface TaskTemplate { id:string; name:string; subject:string; estMins:number; recurrence?:Recurrence; subtasks?:{text:string}[]; }

// One entry in the undo/redo history (see undoStack in HomeworkPlanner).
export type HistoryAction =
  | {type:"delete"; tasks:Task[]}
  // Any other change (complete, edit, archive, snooze, ...): each affected
  // task's state before and after -- see src/lib/history.ts.
  | {type:"change"; before:TaskStates<Task>; after:TaskStates<Task>; label:string};
