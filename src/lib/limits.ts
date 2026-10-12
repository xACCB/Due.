// Size limits shared by the app and firestore.rules. The rules reject any
// synced write over these, so the app has to stay inside them too -- otherwise
// the change saves locally but is silently refused by the cloud and the
// devices drift apart. Keep the numbers here and in firestore.rules in step
// (tests/firestore.rules.test.ts checks the rules side at these values).
import type { Task } from "../types";

export const LIMITS = {
  title: 500,
  subject: 200,
  subjects: 200,      // subjects per account (profile doc)
  subtasks: 100,      // per task
  tags: 30,           // per task
  tag: 100,           // characters in one tag (the rules cap the total: tags x tag)
  sessions: 1000,     // logged work sessions per task; oldest drop off
  estMins: 100000,
  tasks: 5000,        // per account, via the counter doc in firestore.rules
  trash: 500,         // Recently deleted entries per account (the app keeps 200)
  devices: 20,        // signed-in devices listed per account; the longest idle drop off
} as const;

// The fields a synced document may hold. firestore.rules refuses a new task
// or profile holding any other, and an edit that adds or changes any other
// (taskFields() / profileFields() there; src/lib/limits.rules.test.ts checks
// the two lists agree). A new synced field goes in both places, and the rules
// are deployed before the app that writes it.
// Written as a map from every key of Task so that adding a field to the type
// without listing it here doesn't compile.
const TASK_FIELD_MAP: Record<keyof Task, true> = {
  id: true, title: true, subject: true, dueDate: true, dueTime: true, estMins: true, done: true, order: true,
  subtasks: true, recurrence: true, archived: true, completedAt: true, tags: true, priorityOverride: true,
  sessions: true, spawnedNextId: true,
};
// updatedAt is sync's own (when the edit happened); a trash entry adds deletedAt.
export const TASK_FIELDS: readonly string[] = [...Object.keys(TASK_FIELD_MAP), "updatedAt"];
export const TRASH_FIELDS: readonly string[] = [...TASK_FIELDS, "deletedAt"];
export const PROFILE_FIELDS: readonly string[] = ["layout", "colorCodeUrgency", "subjects", "subjectColors", "timeFormat", "weekStart"];

// A task as it is sent to the cloud: only the fields the rules accept. A task
// kept on the device since an early version, or brought in from a backup, can
// hold others (the first versions had `notes`); sent whole, the rules would
// refuse it and it would stop syncing.
export function syncedTask(task: object): Record<string, unknown> {
  return Object.fromEntries(Object.entries(task).filter(([k]) => TASK_FIELDS.includes(k)));
}
// The same for an edit's changed fields: a field the rules don't know may be
// removed (`removed` is the caller's deleteField()), never set.
export function syncedChanges(changes: Record<string, unknown>, removed: unknown): Record<string, unknown> {
  return Object.fromEntries(Object.entries(changes).filter(([k, v]) => v === removed || TASK_FIELDS.includes(k)));
}

const RECURRENCES = ["none", "daily", "weekly", "monthly"];
const PRIORITIES = ["high", "medium", "low"];

// Text as a one-line field would hold it: line breaks become spaces. The rules
// refuse a tag or subject name with a line break in it (see allText() there).
export function oneLine(s: string): string { return s.replace(/[\r\n]+/g, " "); }

// Appends a work session, keeping only the newest LIMITS.sessions.
export function addSession<S>(sessions: S[] | undefined, s: S): S[] {
  return [...(sessions || []), s].slice(-LIMITS.sessions);
}

// Brings a task from outside the app (a JSON backup, possibly hand-edited)
// inside the limits and formats the rules enforce: strings trimmed to length,
// dates/times that aren't YYYY-MM-DD / HH:MM dropped, numbers clamped, lists
// cut to size, unknown enum values removed.
export function sanitizeTask<T extends Record<string, unknown>>(t: T): T {
  const out: Record<string, unknown> = { ...t };
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  out.title = str(t.title, LIMITS.title);
  out.subject = str(t.subject, LIMITS.subject);
  out.dueDate = typeof t.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate) ? t.dueDate : "";
  out.dueTime = out.dueDate && typeof t.dueTime === "string" && /^\d{2}:\d{2}$/.test(t.dueTime) ? t.dueTime : "";
  out.estMins = typeof t.estMins === "number" && Number.isFinite(t.estMins) ? Math.min(LIMITS.estMins, Math.max(0, Math.round(t.estMins))) : 0;
  out.done = !!t.done;
  for (const [key, max] of [["subtasks", LIMITS.subtasks], ["tags", LIMITS.tags], ["sessions", LIMITS.sessions]] as const) {
    if (key in t) {
      const v = t[key];
      // Tags are text on one line, each within the length the tag field allows
      // (the rules refuse a new task whose tags run too long in total, hold
      // something that isn't text, or contain a line break).
      if (Array.isArray(v) && key === "tags") out[key] = v.filter(g => typeof g === "string").slice(0, max).map(g => oneLine(g as string).slice(0, LIMITS.tag));
      else if (Array.isArray(v)) out[key] = key === "sessions" ? v.slice(-max) : v.slice(0, max);
      else delete out[key];
    }
  }
  if ("recurrence" in t && !RECURRENCES.includes(t.recurrence as string)) delete out.recurrence;
  if ("priorityOverride" in t && !PRIORITIES.includes(t.priorityOverride as string)) delete out.priorityOverride;
  return out as T;
}
