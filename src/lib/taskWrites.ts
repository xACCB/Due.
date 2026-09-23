// Builds the Firestore batch for one task's change -- shared by the app's
// tasks-sync effect and tests/firestore.rules.test.ts, so the rules are tested
// against exactly the writes the app sends.
import { deleteField, increment } from "firebase/firestore";
import type { DocumentReference, WriteBatch } from "firebase/firestore";
import { changedFields, countDelta, homeOf } from "./sync";
import type { SyncRecord } from "./sync";

export type TaskRefs = { task: DocumentReference; trash: DocumentReference; counts: DocumentReference };

// The normal write: move/update the task's doc from where `B` (what we last
// knew the cloud held) says it is to where `L` (local) says it should be. An
// edit to an existing task only sends its changed fields (a merge). When
// `counted`, the counts doc is bumped in the same batch (see firestore.rules).
export function addTaskWrite<T extends object>(batch: WriteBatch, refs: TaskRefs, id: number,
  L: SyncRecord<T> | undefined, B: SyncRecord<T> | undefined, updatedAt: number, counted: boolean): void {
  if (!L) { batch.delete(refs.task); batch.delete(refs.trash); }
  else if (L.deletedAt !== undefined) {
    batch.set(refs.trash, { ...L.task, deletedAt: L.deletedAt, updatedAt });
    if (B?.deletedAt === undefined) batch.delete(refs.task);
  }
  else if (!B || B.deletedAt !== undefined) { batch.set(refs.task, { ...L.task, updatedAt }); if (B) batch.delete(refs.trash); }
  else batch.set(refs.task, { ...changedFields(B.task, L.task, deleteField()), updatedAt }, { merge: true });
  if (counted) addCount(batch, refs, id, countDelta(homeOf(B), homeOf(L)));
}

// The fallback when the normal write was rejected because `B` was stale (e.g.
// another device moved or deleted the task first, so the count didn't match):
// given which docs really exist now, write the whole task where it belongs and
// remove it from anywhere else, with the count adjusted to match.
export function addTaskWriteFromActual<T extends object>(batch: WriteBatch, refs: TaskRefs, id: number,
  L: SyncRecord<T> | undefined, has: { tasks: boolean; trash: boolean }, updatedAt: number, counted: boolean): void {
  const home = homeOf(L);
  if (L && home === "tasks") batch.set(refs.task, { ...L.task, updatedAt });
  else if (has.tasks) batch.delete(refs.task);
  if (L && home === "trash") batch.set(refs.trash, { ...L.task, deletedAt: L.deletedAt, updatedAt });
  else if (has.trash) batch.delete(refs.trash);
  if (counted) addCount(batch, refs, id, {
    n: (home === "tasks" ? 1 : 0) - (has.tasks ? 1 : 0),
    t: (home === "trash" ? 1 : 0) - (has.trash ? 1 : 0),
  });
}

function addCount(batch: WriteBatch, refs: TaskRefs, id: number, d: { n: number; t: number }) {
  if (d.n || d.t) batch.update(refs.counts, { n: increment(d.n), t: increment(d.t), last: String(id) });
}
