// Versioned data migrations. Every synced task and the profile carry a
// schemaVersion (sync metadata, like updatedAt: stamped on the way out, split
// off on the way in, never a field of Task). Data from an older version is
// brought up to date here, one step at a time, wherever it comes in: the cloud
// (cloudRecord in App.tsx), this device's storage (hw-tasks, with its version
// in hw-schema) and backup files (readBackup).
//
// Changing the shape of a task or the profile:
// 1. Bump SCHEMA_VERSION and add a step to TASK_STEPS / PROFILE_STEPS that
//    turns data of the previous version into the new one.
// 2. A step must be safe to run on data that is already new: an older app
//    still open somewhere may rewrite a whole doc without the version, and it
//    then comes back in as version 0 and runs every step again.
// 3. A new synced field still goes in limits.ts and firestore.rules, with the
//    rules deployed first (see TASK_FIELDS).
//
// Data from a NEWER version than this app knows (isFromNewerApp) is left
// alone: the app doesn't write it back, so it can't strip fields it doesn't
// understand, and asks to be reloaded instead.
import type { Task } from "../types";

export const SCHEMA_VERSION = 1;

type Raw = Record<string, unknown>;
// Step n turns version n into version n+1. `i` is the task's position in the
// list it came from (only meaningful for this device's own list).
type TaskStep = (t: Raw, i: number) => Raw;
type ProfileStep = (p: Raw) => Raw;

const TASK_STEPS: TaskStep[] = [
  // 0 -> 1: the backfills the app did before versions existed. A task saved
  // before drag-to-reorder has no order.
  (t, i) => (typeof t.order === "number" ? t : { ...t, order: i }),
];
const PROFILE_STEPS: ProfileStep[] = [
  // 0 -> 1: nothing to change; the profile listener checks each field's shape.
  p => p,
];

// A version as stored: missing or malformed counts as 0 (before versions).
export function versionOf(v: unknown): number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0;
}

export function isFromNewerApp(v: unknown): boolean {
  return versionOf(v) > SCHEMA_VERSION;
}

export function migrateTask(task: Raw, from: unknown, i = 0): Task {
  let t = task;
  for (let v = versionOf(from); v < SCHEMA_VERSION; v++) t = TASK_STEPS[v](t, i);
  return t as unknown as Task;
}

export function migrateTasks(tasks: Raw[], from: unknown): Task[] {
  return tasks.map((t, i) => migrateTask(t, from, i));
}

export function migrateProfile(profile: Raw, from: unknown): Raw {
  let p = profile;
  for (let v = versionOf(from); v < SCHEMA_VERSION; v++) p = PROFILE_STEPS[v](p);
  return p;
}

// Every version below the current one has its step (a test checks this too).
if (TASK_STEPS.length !== SCHEMA_VERSION || PROFILE_STEPS.length !== SCHEMA_VERSION) {
  throw new Error("migrations.ts: every schema version needs a task and a profile step");
}
