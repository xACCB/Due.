// The sync engines in core (createTaskSync, createProfileSync) bound to the
// Firebase JS SDK: the website's counterpart of the phone's
// apps/mobile/src/lib/cloudSync.ts. Same paths and rules on both:
// users/{uid}/tasks, users/{uid}/trash, the task counter users/{uid}/meta/counts
// and the profile doc users/{uid}. HomeworkPlanner (App.tsx) starts both once
// its prepare effect has run (the counter, the legacy task list, whether the
// account is new).
import { collection, deleteField, doc, getDocFromServer, increment, onSnapshot, setDoc, writeBatch, type DocumentReference } from "firebase/firestore";
import { createTaskSync, type TaskSyncAdapter, type TaskSyncEvents, type TaskSyncOptions } from "@dueplanner/core/lib/taskSync";
import { createProfileSync, type ProfileSyncEvents } from "@dueplanner/core/lib/profileSync";
import type { Profile } from "@dueplanner/core/lib/profile";
import { db } from "../firebase";

function taskAdapter(uid: string): TaskSyncAdapter<DocumentReference> {
  return {
    ops: { deleteField, increment },
    refs: id => ({
      task: doc(db, "users", uid, "tasks", String(id)),
      trash: doc(db, "users", uid, "trash", String(id)),
      counts: doc(db, "users", uid, "meta", "counts"),
    }),
    batch() {
      const b = writeBatch(db);
      return {
        set: (ref, data, options) => { if (options) b.set(ref, data, options); else b.set(ref, data); },
        delete: ref => { b.delete(ref); },
        update: (ref, data) => { b.update(ref, data); },
        commit: () => b.commit(),
      };
    },
    existsOnServer: async ref => (await getDocFromServer(ref)).exists(),
    listen(kind, next, error) {
      // includeMetadataChanges: also hear when our writes reach the server (for
      // "Synced just now"); those snapshots change no doc, so they skip the merge.
      return onSnapshot(collection(db, "users", uid, kind), { includeMetadataChanges: true }, snap => {
        next(snap.docs.map(d => d.data()), {
          pending: snap.metadata.hasPendingWrites,
          fromCache: snap.metadata.fromCache,
          changed: snap.docChanges().length > 0,
        });
      }, error);
    },
    isRefused: e => (e as { code?: string })?.code === "permission-denied",
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: t => clearTimeout(t as ReturnType<typeof setTimeout>),
  };
}

export type TaskSync = ReturnType<typeof createTaskSync>;
export type ProfileSync = ReturnType<typeof createProfileSync>;

// Starts syncing this account's tasks and Recently deleted; stop() it when
// the account signs out or changes.
export function startTaskSync(uid: string, events: TaskSyncEvents, opts: TaskSyncOptions): TaskSync {
  const engine = createTaskSync(taskAdapter(uid), events, opts);
  engine.start();
  return engine;
}

// Starts syncing the profile fields with users/{uid}.
export function startProfileSync(uid: string, events: ProfileSyncEvents, initial: Profile): ProfileSync {
  const ref = doc(db, "users", uid);
  const engine = createProfileSync({
    listen: (next, error) => onSnapshot(ref, { includeMetadataChanges: true }, snap => {
      next(snap.exists() ? snap.data() : null, { pending: snap.metadata.hasPendingWrites });
    }, error),
    write: data => setDoc(ref, data, { merge: true }),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: t => clearTimeout(t as ReturnType<typeof setTimeout>),
  }, events, initial);
  engine.start();
  return engine;
}
