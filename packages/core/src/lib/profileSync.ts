// Keeps the profile fields (lib/profile.ts: layout, urgency colours, subjects
// and their colours, 12h/24h, week start) in step with users/{uid}. No
// Firebase here: the platform passes an adapter (the phone's is
// apps/mobile/src/lib/profileSync.ts). Unit-tested in profileSync.test.ts.
//
// What it does, as the website's two profile effects in App.tsx do, plus two
// guards the website doesn't have:
// - The first reading wins: signing in on a device takes the account's
//   settings. With no profile doc yet (a brand-new account), this device's
//   settings are written.
// - After that, a change here is written (400ms after the last one, so a burst
//   is one write), and a change from another device is taken.
// - A field changed here and not yet written keeps this device's value when
//   another device's snapshot arrives meanwhile, and is still written.
// - A snapshot of our own write before the server has it (pending) is ignored.
// - A doc saved by a newer app is still read, but never written back.
import { isFromNewerApp } from "./migrations";
import { PROFILE_KEYS, profileDoc, readProfile, sameProfile, type Profile } from "./profile";
import { SYNC_MESSAGES } from "./taskSync";

export interface ProfileSyncAdapter {
  // Every snapshot of users/{uid}: its data (null when there's no doc) and
  // whether it holds a write of ours the server hasn't confirmed yet.
  listen(next: (data: Record<string, unknown> | null, meta: { pending: boolean }) => void, error: (e: unknown) => void): () => void;
  // A merge write of the given fields.
  write(data: Record<string, unknown>): Promise<void>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(t: unknown): void;
}

export interface ProfileSyncEvents {
  // Settings from the cloud to take: only the fields that differ.
  apply(p: Partial<Profile>): void;
  // The first snapshot has been handled.
  ready?(): void;
  // A message for the sync status line, or null when it's fine again.
  error?(message: string | null): void;
  // Whether the doc was saved by a newer app (shown as SYNC_MESSAGES.newer).
  newer?(newer: boolean): void;
  // The error behind a message, for an error report (the web's Sentry).
  report?(err: unknown, where: "read" | "save"): void;
}

const WRITE_DELAY = 400;

const pick = (p: Partial<Profile>, keys: readonly (keyof Profile)[]): Partial<Profile> =>
  Object.fromEntries(keys.filter(k => p[k] !== undefined).map(k => [k, p[k]])) as Partial<Profile>;

export function createProfileSync(adapter: ProfileSyncAdapter, events: ProfileSyncEvents, initial: Profile) {
  let local: Profile = initial;
  let cloud: Partial<Profile> | null = null; // what we last knew the doc held
  let ready = false;
  let newer = false;
  let timer: unknown = null;
  let writing: Promise<void> | null = null;
  let unsub: (() => void) | null = null;

  // Fields where this device holds a value the cloud doesn't yet.
  const dirtyKeys = () => PROFILE_KEYS.filter(k => !cloud || !sameProfile(pick(local, [k]), pick(cloud, [k])));

  function write(): Promise<void> {
    timer = null;
    if (!ready || newer || !dirtyKeys().length) return writing ?? Promise.resolve();
    cloud = { ...local }; // optimistic: Firestore applies it to its cache at once and retries it
    const p = adapter.write(profileDoc(local))
      .then(() => events.error?.(null))
      .catch(e => { events.report?.(e, "save"); events.error?.(SYNC_MESSAGES.save); })
      .finally(() => { if (writing === p) writing = null; });
    writing = p;
    return p;
  }
  function schedule() {
    if (timer !== null) adapter.clearTimer(timer);
    timer = adapter.setTimer(() => { void write(); }, WRITE_DELAY);
  }

  function onSnapshot(data: Record<string, unknown> | null, meta: { pending: boolean }) {
    if (meta.pending) return; // our own write, before the server has it
    const isNewer = !!data && isFromNewerApp(data.schemaVersion);
    if (isNewer !== newer) { newer = isNewer; events.newer?.(newer); }
    const read = data ? readProfile(data) : {};
    // Before the first snapshot nothing counts as changed here: the cloud wins.
    const keep = ready ? dirtyKeys() : [];
    cloud = data ? read : null;
    const incoming = pick(read, PROFILE_KEYS.filter(k => !keep.includes(k)));
    const changed = pick(incoming, PROFILE_KEYS.filter(k => incoming[k] !== undefined && !sameProfile(pick(incoming, [k]), pick(local, [k]))));
    if (Object.keys(changed).length) {
      local = { ...local, ...changed };
      events.apply(changed);
    }
    events.error?.(null);
    if (!ready) { ready = true; events.ready?.(); }
    if (dirtyKeys().length) schedule();
  }

  return {
    start() {
      unsub = adapter.listen(onSnapshot, e => { events.report?.(e, "read"); events.error?.(SYNC_MESSAGES.read); });
    },
    stop() {
      unsub?.(); unsub = null;
      if (timer !== null) { adapter.clearTimer(timer); timer = null; }
    },
    // The device's current values, after every change (from the user or from apply()).
    localChanged(p: Profile) {
      local = p;
      if (ready && dirtyKeys().length) schedule();
    },
    // Sends a waiting write now (sign-out). Resolves when it's done.
    flush(): Promise<void> {
      if (timer !== null) { adapter.clearTimer(timer); return write(); }
      return writing ?? Promise.resolve();
    },
    isReady: () => ready,
  };
}

export type ProfileSync = ReturnType<typeof createProfileSync>;
