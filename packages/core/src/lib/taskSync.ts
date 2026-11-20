// Task sync with Firestore (users/{uid}/tasks and users/{uid}/trash), as an
// engine with no Firebase import: the app hands it an adapter over its SDK
// (the phone: @react-native-firebase, apps/mobile/src/lib/cloudSync.ts) and
// gets the merged tasks back through `events`. It is the web's tasks
// listeners and save effect in HomeworkPlanner (apps/web/src/App.tsx), moved
// out step for step, so the two apps sync the same way:
// - both collections are listened to, and merging waits until each has
//   arrived once;
// - an incoming snapshot is merged with what this device has (reconcile in
//   sync.ts), never applied wholesale, so an edit not yet written survives;
// - writes are debounced 400ms behind local changes, one small batch per
//   changed task (addTaskWrite in taskWrites.ts), each bumping the task
//   counter; a write refused because this device's view was stale is retried
//   once from what really exists (addTaskWriteFromActual);
// - while a write is in flight, the merge uses what was written instead of
//   the cloud's in-between state (one batch can touch both collections, which
//   the two listeners hear separately), and re-merges when it lands;
// - a doc saved by a newer app version is read but never written back.

import type { Task } from "../types";
import { reconcile, same, type CloudRecord, type SyncRecord } from "./sync";
import { localRecords, type TrashEntry } from "./trash";
import { isFromNewerApp, migrateTask } from "./migrations";
import { LIMITS } from "./limits";
import { LEGACY_EXAMPLE_TASKS } from "./tasks";
import { makeTaskWrites, type BatchLike, type TaskRefs, type WriteOps } from "./taskWrites";

export type CloudDoc = Record<string, unknown>;
// What a snapshot says besides its docs: writes of ours not yet on the
// server, whether it came from the local cache, and whether any doc changed
// (a metadata-only snapshot, e.g. a write reaching the server, has none).
export type SnapshotMeta = { pending: boolean; fromCache: boolean; changed: boolean };

export interface TaskSyncAdapter<R> {
  ops: WriteOps;
  refs(id: number): TaskRefs<R>;
  batch(): BatchLike<R> & { commit(): Promise<void> };
  existsOnServer(ref: R): Promise<boolean>;
  listen(kind: "tasks" | "trash", next: (docs: CloudDoc[], meta: SnapshotMeta) => void, error: (e: unknown) => void): () => void;
  // A write refused by the rules (the web checks code "permission-denied").
  isRefused(e: unknown): boolean;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(t: unknown): void;
}

export interface TaskSyncEvents {
  // The merged state, to show and save. Not an undo step.
  merged(tasks: Task[], trash: TrashEntry[]): void;
  // The first merge for this account has happened; local changes now sync.
  ready(): void;
  // pending: writes not yet on the server. syncedAt: when everything was last
  // confirmed by the server (null until it has been). fromCache: what's shown
  // came from this device's cache, not the server, which is Firestore's way
  // of saying it can't reach the cloud (offline) or hasn't yet (starting up).
  status(s: { pending: boolean; syncedAt: number | null; fromCache: boolean }): void;
  // A message to show, or null when the last problem has cleared.
  error(message: string | null): void;
  // Whether any task was saved by a newer version of the app.
  newer(any: boolean): void;
  // The error behind a message, for an error report (the web's Sentry).
  report?(err: unknown, where: "read" | "save"): void;
}

export const SYNC_MESSAGES = {
  read: "Couldn't sync with the cloud. Your changes are saved on this device, but may not reach your other devices until this is resolved.",
  save: "Couldn't save to the cloud. Your changes are safe on this device, but won't reach your other devices until this is resolved.",
  limit: `You've reached the limit of ${LIMITS.tasks.toLocaleString("en-US")} tasks (including archived and recently deleted ones). New tasks are saved on this device, but won't sync until you delete some.`,
  newer: "A newer version of DuePlanner saved some of your data on another device. Update this app. Until then, changes to that data stay on this device.",
};

// A tasks/ or trash/ doc as a cloud record (the web's cloudRecord): updatedAt,
// deletedAt and schemaVersion are sync metadata, not task fields, so they're
// split off, and an older shape is brought up to date. A doc from a newer app
// goes into `newer`, so it isn't written back.
export function cloudRecordOf(data: CloudDoc, deleted: boolean, newer: Set<number>): CloudRecord<Task> | null {
  const { updatedAt, deletedAt, schemaVersion, ...raw } = data;
  if (typeof raw.id !== "number" || typeof raw.title !== "string") return null; // shape guard
  if (isFromNewerApp(schemaVersion)) newer.add(raw.id);
  const rec: CloudRecord<Task> = { task: migrateTask(raw, schemaVersion), updatedAt: typeof updatedAt === "number" ? updatedAt : 0 };
  if (deleted) rec.deletedAt = typeof deletedAt === "number" ? deletedAt : 0;
  return rec;
}

export type TaskSyncOptions = {
  // This device's tasks and Recently deleted right now (read at each merge).
  getLocal(): { tasks: Task[]; trash: TrashEntry[] };
  // No profile doc existed at sign-in: a brand-new account, so an empty cloud
  // means "nothing synced yet", not "every task was deleted elsewhere".
  isNewAccount: boolean;
  // An explicit sign-in (not a restored session): keep tasks made while
  // signed out instead of letting the cloud replace them.
  mergeLocal: boolean;
  debounceMs?: number;
};

export function createTaskSync<R>(adapter: TaskSyncAdapter<R>, events: TaskSyncEvents, opts: TaskSyncOptions) {
  const { addTaskWrite, addTaskWriteFromActual } = makeTaskWrites<R>(adapter.ops);
  const debounce = opts.debounceMs ?? 400;
  let base = new Map<number, SyncRecord<Task>>();      // what we last knew the cloud held
  const dirtyAt = new Map<number, number>();            // when an unsaved local change was made
  let prevLocal = new Map<number, SyncRecord<Task>>();
  const inFlight = new Map<number, number>();           // writes of ours on their way, per task
  let cloudTasks: Map<number, CloudRecord<Task>> | null = null;
  let cloudTrash: Map<number, CloudRecord<Task>> | null = null;
  const newer = { tasks: new Set<number>(), trash: new Set<number>() };
  let mergeLocal = opts.mergeLocal;
  let synced = false, stopped = false;
  let timer: unknown = null;
  let pending: (() => Promise<void>) | null = null;
  let unsubs: (() => void)[] = [];
  let tasksMeta = { pending: false, fromCache: true }, trashMeta = { pending: false, fromCache: true };
  let lastError: string | null = null;
  const setError = (m: string | null) => { if (m !== lastError) { lastError = m; events.error(m); } };

  function apply() {
    if (stopped || !cloudTasks || !cloudTrash) return;
    const cloud = new Map([...cloudTrash, ...cloudTasks]);
    for (const id of inFlight.keys()) {
      const mine = base.get(id);
      if (mine) cloud.set(id, { ...mine, updatedAt: cloud.get(id)?.updatedAt ?? 0 }); else cloud.delete(id);
    }
    if (cloud.size === 0 && opts.isNewAccount && base.size === 0) {
      // A new account: leave local tasks alone, the first save pushes them up.
      mergeLocal = false;
      if (!synced) { synced = true; events.ready(); localChanged(opts.getLocal().tasks, opts.getLocal().trash); }
      return;
    }
    const now = opts.getLocal();
    const local = localRecords(now.tasks, now.trash);
    if (mergeLocal) {
      const isStarter = (t: Task) => !t.done && LEGACY_EXAMPLE_TASKS.some(d => d.id === t.id && d.title === t.title);
      const at = adapter.now();
      for (const [id, r] of local) if (!cloud.has(id) && r.deletedAt === undefined && !isStarter(r.task)) dirtyAt.set(id, at);
      mergeLocal = false;
    }
    const merged = reconcile(base, local, cloud, dirtyAt);
    base = new Map([...cloud].map(([id, r]) => [id, r.deletedAt !== undefined ? { task: r.task, deletedAt: r.deletedAt } : { task: r.task }]));
    for (const id of [...dirtyAt.keys()]) if (same(merged.get(id), base.get(id))) dirtyAt.delete(id);
    // Keep the on-screen order of existing tasks; new ones go last.
    const pos = new Map(now.tasks.map((t, i) => [t.id, i]));
    const live: Task[] = [], deleted: TrashEntry[] = [];
    for (const r of merged.values()) if (r.deletedAt !== undefined) deleted.push({ task: r.task, deletedAt: r.deletedAt }); else live.push(r.task);
    live.sort((x, y) => (pos.get(x.id) ?? Infinity) - (pos.get(y.id) ?? Infinity));
    deleted.sort((x, y) => y.deletedAt - x.deletedAt);
    if (!same(live, now.tasks) || !same(deleted, now.trash)) events.merged(live, deleted);
    if (!synced) {
      synced = true;
      events.ready();
      // Anything local the merge kept (made while signed out) goes up now.
      localChanged(live, deleted);
    }
  }

  function toMap(docs: CloudDoc[], deleted: boolean) {
    const m = new Map<number, CloudRecord<Task>>();
    const found = new Set<number>();
    for (const d of docs) { const r = cloudRecordOf(d, deleted, found); if (r) m.set(r.task.id, r); }
    newer[deleted ? "trash" : "tasks"] = found;
    events.newer(newer.tasks.size > 0 || newer.trash.size > 0);
    return m;
  }

  function status() {
    const p = tasksMeta.pending || trashMeta.pending;
    const fromCache = tasksMeta.fromCache || trashMeta.fromCache;
    events.status({ pending: p, syncedAt: !p && !fromCache ? adapter.now() : null, fromCache });
  }

  function start() {
    unsubs.push(adapter.listen("tasks", (docs, meta) => {
      tasksMeta = { pending: meta.pending, fromCache: meta.fromCache };
      if (!cloudTasks || meta.changed) { cloudTasks = toMap(docs, false); apply(); }
      status();
      setError(null);
    }, e => { events.report?.(e, "read"); setError(SYNC_MESSAGES.read); }));
    unsubs.push(adapter.listen("trash", (docs, meta) => {
      trashMeta = { pending: meta.pending, fromCache: meta.fromCache };
      if (!cloudTrash || meta.changed) { cloudTrash = toMap(docs, true); apply(); }
      status();
    }, e => {
      // Don't let a trash problem hold up syncing the tasks themselves.
      events.report?.(e, "read");
      setError(SYNC_MESSAGES.read);
      trashMeta = { pending: false, fromCache: false };
      if (!cloudTrash) { cloudTrash = new Map(); apply(); }
    }));
  }

  function stop() {
    stopped = true;
    if (timer != null) adapter.clearTimer(timer);
    for (const u of unsubs) u();
    unsubs = [];
  }

  // The local tasks changed: note when each changed (for conflict merging),
  // then write what differs from the cloud after a short wait.
  function localChanged(tasks: Task[], trash: TrashEntry[]) {
    if (!synced || stopped) return;
    const local = localRecords(tasks, trash);
    const at = adapter.now();
    for (const id of new Set([...local.keys(), ...base.keys()])) {
      const r = local.get(id);
      if (same(r, base.get(id))) dirtyAt.delete(id);
      else if (!dirtyAt.has(id) || !same(r, prevLocal.get(id))) dirtyAt.set(id, at);
    }
    prevLocal = local;
    if (timer != null) adapter.clearTimer(timer);
    const run = (): Promise<void> => {
      pending = null;
      timer = null;
      const commits: Promise<void>[] = [];
      for (const id of new Set([...local.keys(), ...base.keys()])) {
        const L = local.get(id), B = base.get(id);
        if (same(L, B)) continue;
        if (newer.tasks.has(id) || newer.trash.has(id)) continue; // a newer app's data
        const updatedAt = dirtyAt.get(id) ?? adapter.now();
        const refs = adapter.refs(id);
        const batch = adapter.batch();
        addTaskWrite(batch, refs, id, L, B, updatedAt, true);
        inFlight.set(id, (inFlight.get(id) ?? 0) + 1);
        commits.push(batch.commit().catch(async err => {
          // Refused, most often because B was stale (another device moved or
          // deleted this task first). Retry once from what exists now.
          if (!adapter.isRefused(err)) throw err;
          const [tk, tr] = await Promise.all([adapter.existsOnServer(refs.task), adapter.existsOnServer(refs.trash)]);
          const retry = adapter.batch();
          addTaskWriteFromActual(retry, refs, id, L, { tasks: tk, trash: tr }, updatedAt, true);
          await retry.commit().catch(err2 => {
            // Still refused while adding: most likely the per-account cap.
            if (L && !tk && !tr) setError(SYNC_MESSAGES.limit);
            throw err2;
          });
        }).finally(() => {
          const left = (inFlight.get(id) ?? 1) - 1;
          if (left > 0) inFlight.set(id, left); else inFlight.delete(id);
          apply();
        }));
        // Optimistic: the SDK applies the write to its cache at once and keeps
        // retrying it until the server answers.
        if (L) base.set(id, L); else base.delete(id);
        dirtyAt.delete(id);
      }
      if (commits.length === 0) return Promise.resolve();
      return Promise.all(commits)
        .then(() => { if (lastError !== SYNC_MESSAGES.limit) setError(null); })
        .catch(err => { events.report?.(err, "save"); if (lastError !== SYNC_MESSAGES.limit) setError(SYNC_MESSAGES.save); });
    };
    pending = run;
    timer = adapter.setTimer(() => { void run(); }, debounce);
  }

  // Sends a waiting write now (sign-out does this before leaving).
  function flush(): Promise<void> {
    if (timer != null) adapter.clearTimer(timer);
    timer = null;
    return pending ? pending() : Promise.resolve();
  }

  return { start, stop, localChanged, flush, isReady: () => synced };
}
