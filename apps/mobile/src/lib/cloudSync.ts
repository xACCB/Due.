import { collection, doc, getDoc, getDocFromServer, getFirestore, increment, deleteField, onSnapshot, setDoc, writeBatch, type DocumentReference } from "@react-native-firebase/firestore";
import { createTaskSync, type TaskSyncAdapter, type TaskSyncEvents, type TaskSyncOptions } from "@dueplanner/core/lib/taskSync";
import { createProfileSync, type ProfileSyncEvents } from "@dueplanner/core/lib/profileSync";
import type { Profile } from "@dueplanner/core/lib/profile";
import { startFirebase } from "./firebase";

// Task sync for the phone: core's createTaskSync (the web's engine, moved
// out) over @react-native-firebase. Same paths and rules as the website:
// users/{uid}/tasks, users/{uid}/trash and the task counter users/{uid}/meta/counts.

type Ref = DocumentReference;

function adapter(uid: string): TaskSyncAdapter<Ref> {
  const db = getFirestore();
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
        // `as never`: the SDK's overloads want its own field-value types; the data is plain.
        update: (ref, data) => { b.update(ref, data as never); },
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
    isRefused: e => (e as { code?: string })?.code === "firestore/permission-denied" || (e as { code?: string })?.code === "permission-denied",
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: t => clearTimeout(t as ReturnType<typeof setTimeout>),
  };
}

// What the web's sign-in preparation does before its listeners start: make
// sure the task counter exists (it starts at zero; the rules refuse a new
// task without it, so offline its creation is queued anyway), and find out
// whether this is a brand-new account (no profile doc yet). The web also moves
// a very old single-document task list into tasks/; the phone leaves that to
// the website, which does it on its next visit.
async function prepare(uid: string): Promise<{ isNewAccount: boolean }> {
  const db = getFirestore();
  const counts = doc(db, "users", uid, "meta", "counts");
  try {
    if (!(await getDoc(counts)).exists()) await setDoc(counts, { n: 0, t: 0, last: "" });
  } catch {
    setDoc(counts, { n: 0, t: 0, last: "" }).catch(() => {});
  }
  const profile = await getDoc(doc(db, "users", uid));
  return { isNewAccount: !profile.exists() };
}

export type TaskSync = ReturnType<typeof createTaskSync>;

// Starts syncing this account's tasks. Resolves to the running engine; stop()
// it when the account signs out or changes.
export async function startTaskSync(uid: string, events: TaskSyncEvents, opts: Omit<TaskSyncOptions, "isNewAccount">): Promise<TaskSync> {
  await startFirebase();
  const { isNewAccount } = await prepare(uid);
  const engine = createTaskSync(adapter(uid), events, { ...opts, isNewAccount });
  engine.start();
  return engine;
}

export type ProfileSync = ReturnType<typeof createProfileSync>;

// Starts syncing the profile fields (layout, urgency colours, subjects and
// their colours, 12h/24h, week start) with users/{uid}: core's
// createProfileSync over @react-native-firebase. Start it after
// startTaskSync has resolved, since that reads whether the profile doc exists
// (a brand-new account) before this writes it.
export function startProfileSync(uid: string, events: ProfileSyncEvents, initial: Profile): ProfileSync {
  const ref = doc(getFirestore(), "users", uid);
  const engine = createProfileSync({
    listen: (next, error) => onSnapshot(ref, { includeMetadataChanges: true }, snap => {
      next(snap.exists() ? (snap.data() ?? null) : null, { pending: snap.metadata.hasPendingWrites });
    }, error),
    write: data => setDoc(ref, data, { merge: true }),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: t => clearTimeout(t as ReturnType<typeof setTimeout>),
  }, events, initial);
  engine.start();
  return engine;
}
