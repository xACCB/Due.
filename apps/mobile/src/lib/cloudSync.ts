import { collection, doc, getDoc, getDocFromServer, getDocsFromServer, getFirestore, increment, deleteField, onSnapshot, setDoc, updateDoc, writeBatch, type DocumentReference } from "@react-native-firebase/firestore";
import { getAuth } from "@react-native-firebase/auth";
import { deviceAction, pruneDevices, type DeviceEntry, type DeviceMap } from "@dueplanner/core/lib/devices";
import { LIMITS } from "@dueplanner/core/lib/limits";
import { registeredFor, setRegisteredFor, thisDeviceId, thisDeviceName } from "./thisDevice";
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

// ---- Devices (Profile -> Devices), the website's Devices effect. This phone
// keeps an entry in users/{uid}/meta/devices and watches that doc; core's
// deviceAction() says what a snapshot means. Signing a device out is removing
// its entry, and that device signs itself out when it next sees the server's
// list without it. The safety rules, each there so no one is signed out wrongly:
// - Only a snapshot straight from the server counts (not the cache, not one
//   holding our own unsaved write), so being offline can't sign the phone out.
// - hw-device-registered is written only once the server has accepted this
//   phone's entry; without it a missing entry means "add me".
// - If the list can't be read, nothing happens: there's no list.
// - Once it has decided to sign out, or stop() is called, it reacts to nothing more.

const devicesRef = (uid: string) => doc(getFirestore(), "users", uid, "meta", "devices");

export function watchDevices(uid: string, events: { list(map: DeviceMap | null): void; signedOut(): void }): () => void {
  const ref = devicesRef(uid), id = thisDeviceId();
  let done = false, registering = false;
  const unsub = onSnapshot(ref, { includeMetadataChanges: true }, snap => {
    if (done) return;
    const map = ((snap.exists() ? snap.data()?.d : null) ?? {}) as DeviceMap;
    events.list(map);
    if (snap.metadata.fromCache || snap.metadata.hasPendingWrites) return;
    const action = deviceAction(registeredFor() === uid, map[id], Date.now());
    if (action === "register" && !registering) {
      registering = true;
      const at = Date.now();
      const d: Record<string, unknown> = { [id]: { name: thisDeviceName(), createdAt: at, lastSeen: at } satisfies DeviceEntry };
      for (const old of pruneDevices(map, id, LIMITS.devices)) d[old] = deleteField();
      // Resolves only when the server has accepted it; only then is this phone "registered".
      setDoc(ref, { d }, { merge: true })
        .then(() => { if (!done && getAuth().currentUser?.uid === uid) setRegisteredFor(uid); })
        .catch(() => { /* refused or offline: tried again on the next snapshot */ })
        .finally(() => { registering = false; });
    }
    if (action === "touch") updateDoc(ref, { [`d.${id}.lastSeen`]: Date.now() }).catch(() => { /* best effort */ });
    if (action === "signOut") { done = true; events.signedOut(); }
  }, () => events.list(null));
  return () => { done = true; unsub(); };
}

// Signs one other device out (Profile -> Devices -> Sign out).
export function signOutDevice(uid: string, id: string): Promise<void> {
  return updateDoc(devicesRef(uid), { [`d.${id}`]: deleteField() });
}

// Leaves only this phone's own entry (Sign out all other devices).
export function signOutOtherDevices(uid: string, mine: DeviceEntry): Promise<void> {
  return setDoc(devicesRef(uid), { d: { [thisDeviceId()]: mine } });
}

// This phone signing out: off the list (best effort, capped at 2s, since
// offline a write only resolves at the server) and its note forgotten.
export async function forgetThisDevice(uid: string): Promise<void> {
  try { await Promise.race([updateDoc(devicesRef(uid), { [`d.${thisDeviceId()}`]: deleteField() }), new Promise(r => setTimeout(r, 2000))]); } catch { /* not listed, or no list */ }
  setRegisteredFor(null);
}

// Account deletion (Settings -> Danger Zone), the website's
// deleteAccountForever: every task and Recently deleted entry, then the device
// list (on its own and allowed to fail, so it can never block the rest), then
// the profile doc last, so an interrupted run can simply be run again. Read
// from the server, so offline it fails at once rather than queueing deletes.
// The task counter (meta/counts) can't be deleted, by the rules' design, and
// holds only numbers. In chunks: a batch holds at most 500 writes.
export async function deleteCloudData(uid: string): Promise<void> {
  const db = getFirestore();
  const [tasks, trash] = await Promise.all([
    getDocsFromServer(collection(db, "users", uid, "tasks")),
    getDocsFromServer(collection(db, "users", uid, "trash")),
  ]);
  const refs = [...tasks.docs, ...trash.docs].map(d => d.ref);
  for (let i = 0; i < refs.length; i += 450) {
    const batch = writeBatch(db);
    refs.slice(i, i + 450).forEach(r => batch.delete(r));
    await batch.commit();
  }
  try { await writeBatch(db).delete(devicesRef(uid)).commit(); } catch { /* no list */ }
  await writeBatch(db).delete(doc(db, "users", uid)).commit();
}
