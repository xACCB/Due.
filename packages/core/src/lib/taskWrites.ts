// Builds the Firestore batch for one task's change -- shared by the app's
// tasks-sync effect and tests/firestore.rules.test.ts, so the rules are tested
// against exactly the writes the app sends.
// No Firebase import here, so the web app (JS SDK) and the phone app
// (@react-native-firebase) can share it: each passes in its SDK's
// deleteField/increment through makeTaskWrites(), and its own batch and refs.
import { changedFields, countDelta, homeOf } from "./sync";
import { syncedChanges, syncedTask } from "./limits";
import type { SyncRecord } from "./sync";
import { SCHEMA_VERSION } from "./migrations";

// What these functions need from an SDK's write batch and field values.
export interface BatchLike<R> {
  set(ref: R, data: Record<string, unknown>, options?: { merge: boolean }): unknown;
  delete(ref: R): unknown;
  update(ref: R, data: Record<string, unknown>): unknown;
}
export type WriteOps = { deleteField: () => unknown; increment: (n: number) => unknown };
export type TaskRefs<R> = { task: R; trash: R; counts: R };

export function makeTaskWrites<R>({ deleteField, increment }: WriteOps) {
  // The normal write: move/update the task's doc from where `B` (what we last
  // knew the cloud held) says it is to where `L` (local) says it should be. An
  // edit to an existing task only sends its changed fields (a merge). Only the
  // fields the rules know are sent (syncedTask in limits.ts). When
  // `counted`, the counts doc is bumped in the same batch (see firestore.rules).
  function addTaskWrite<T extends object>(batch: BatchLike<R>, refs: TaskRefs<R>, id: number,
    L: SyncRecord<T> | undefined, B: SyncRecord<T> | undefined, updatedAt: number, counted: boolean): void {
    if (!L) { batch.delete(refs.task); batch.delete(refs.trash); }
    else if (L.deletedAt !== undefined) {
      batch.set(refs.trash, { ...syncedTask(L.task), deletedAt: L.deletedAt, ...stamp(updatedAt) });
      if (B?.deletedAt === undefined) batch.delete(refs.task);
    }
    else if (!B || B.deletedAt !== undefined) { batch.set(refs.task, { ...syncedTask(L.task), ...stamp(updatedAt) }); if (B) batch.delete(refs.trash); }
    else { const gone = deleteField(); batch.set(refs.task, { ...syncedChanges(changedFields(B.task, L.task, gone), gone), ...stamp(updatedAt) }, { merge: true }); }
    if (counted) addCount(batch, refs, id, countDelta(homeOf(B), homeOf(L)));
  }

  // The fallback when the normal write was rejected because `B` was stale (e.g.
  // another device moved or deleted the task first, so the count didn't match):
  // given which docs really exist now, write the whole task where it belongs and
  // remove it from anywhere else, with the count adjusted to match.
  function addTaskWriteFromActual<T extends object>(batch: BatchLike<R>, refs: TaskRefs<R>, id: number,
    L: SyncRecord<T> | undefined, has: { tasks: boolean; trash: boolean }, updatedAt: number, counted: boolean): void {
    const home = homeOf(L);
    if (L && home === "tasks") batch.set(refs.task, { ...syncedTask(L.task), ...stamp(updatedAt) });
    else if (has.tasks) batch.delete(refs.task);
    if (L && home === "trash") batch.set(refs.trash, { ...syncedTask(L.task), deletedAt: L.deletedAt, ...stamp(updatedAt) });
    else if (has.trash) batch.delete(refs.trash);
    if (counted) addCount(batch, refs, id, {
      n: (home === "tasks" ? 1 : 0) - (has.tasks ? 1 : 0),
      t: (home === "trash" ? 1 : 0) - (has.trash ? 1 : 0),
    });
  }

  // Sync metadata on every doc written: when the edit happened, and which shape
  // of task it holds (src/lib/migrations.ts).
  function stamp(updatedAt: number) { return { updatedAt, schemaVersion: SCHEMA_VERSION }; }

  function addCount(batch: BatchLike<R>, refs: TaskRefs<R>, id: number, d: { n: number; t: number }) {
    if (d.n || d.t) batch.update(refs.counts, { n: increment(d.n), t: increment(d.t), last: String(id) });
  }

  return { addTaskWrite, addTaskWriteFromActual };
}
