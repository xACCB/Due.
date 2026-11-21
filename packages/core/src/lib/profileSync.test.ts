import { describe, expect, it } from "vitest";
import { createProfileSync, type ProfileSyncAdapter } from "./profileSync";
import { profileDoc, readProfile, sameProfile, type Profile } from "./profile";
import { DEFAULT_SUBJECT_COLORS } from "../constants";
import { SCHEMA_VERSION } from "./migrations";
import { SYNC_MESSAGES } from "./taskSync";

const base: Profile = {
  layout: "list", colorCodeUrgency: true, subjects: ["Math", "English"],
  subjectColors: { ...DEFAULT_SUBJECT_COLORS }, timeFormat: "12h", weekStart: 0, profiles: [],
};

// One users/{uid} doc shared by any number of devices, with hand-run timers
// and writes that land when the test says so (or at once).
function cloud(initial: Record<string, unknown> | null = null) {
  let data = initial;
  const listeners = new Set<(d: Record<string, unknown> | null, m: { pending: boolean }) => void>();
  const push = (pending: boolean) => listeners.forEach(l => l(data && { ...data }, { pending }));
  function device(start: Profile, opts: { refuse?: boolean } = {}) {
    const timers = new Map<number, () => void>();
    let n = 0;
    const applied: Partial<Profile>[] = [];
    const errors: (string | null)[] = [];
    const newer: boolean[] = [];
    let writes = 0;
    const adapter: ProfileSyncAdapter = {
      listen(next) { listeners.add(next); next(data && { ...data }, { pending: false }); return () => listeners.delete(next); },
      write(d) {
        writes++;
        if (opts.refuse) return Promise.reject(new Error("permission-denied"));
        data = { ...(data ?? {}), ...d };
        push(true); // the local echo first, as Firestore does
        push(false);
        return Promise.resolve();
      },
      setTimer(fn) { timers.set(++n, fn); return n; },
      clearTimer(t) { timers.delete(t as number); },
    };
    let current = start;
    const sync = createProfileSync(adapter, {
      apply(p) { applied.push(p); current = { ...current, ...p }; },
      error: e => errors.push(e),
      newer: b => newer.push(b),
    }, start);
    return {
      sync, applied, errors, newer,
      get current() { return current; },
      change(p: Partial<Profile>) { current = { ...current, ...p }; sync.localChanged(current); },
      async tick() { const fns = [...timers.values()]; timers.clear(); fns.forEach(f => f()); await Promise.resolve(); await Promise.resolve(); },
      pending: () => timers.size,
      writes: () => writes,
    };
  }
  return { device, get data() { return data; }, set(d: Record<string, unknown>) { data = { ...(data ?? {}), ...d }; push(false); } };
}

describe("readProfile", () => {
  it("keeps only fields of the right shape", () => {
    expect(readProfile({ layout: "nope", colorCodeUrgency: "yes", timeFormat: "25h", weekStart: 3, subjects: [1], subjectColors: { Math: 5 } })).toEqual({});
    expect(readProfile({ layout: "kanban", weekStart: 1, subjects: ["Art"] })).toEqual({ layout: "kanban", weekStart: 1, subjects: ["Art"] });
  });
  it("merges colours over the defaults", () => {
    expect(readProfile({ subjectColors: { Art: "#123456" } }).subjectColors).toEqual({ ...DEFAULT_SUBJECT_COLORS, Art: "#123456" });
  });
  it("writes the website's doc", () => {
    expect(profileDoc(base)).toEqual({ ...base, schemaVersion: SCHEMA_VERSION });
  });
  it("compares subjects in order and colours by key", () => {
    expect(sameProfile({ subjects: ["a", "b"] }, { subjects: ["b", "a"] })).toBe(false);
    expect(sameProfile({ subjectColors: { a: "#000000", b: "#ffffff" } }, { subjectColors: { b: "#ffffff", a: "#000000" } })).toBe(true);
    expect(sameProfile({ subjectColors: { a: "#000000" } }, {})).toBe(false);
  });
});

describe("createProfileSync", () => {
  it("a brand-new account (no doc) gets this device's settings", async () => {
    const c = cloud(null);
    const a = c.device({ ...base, layout: "board" });
    a.sync.start();
    expect(a.applied).toEqual([]);
    await a.tick();
    expect(c.data).toEqual(profileDoc({ ...base, layout: "board" }));
  });

  it("signing in takes the account's settings, and writes nothing back", async () => {
    const c = cloud(profileDoc({ ...base, layout: "kanban", weekStart: 1 }));
    const a = c.device({ ...base, layout: "board" });
    a.sync.start();
    expect(a.applied).toEqual([{ layout: "kanban", weekStart: 1 }]);
    a.sync.localChanged(a.current); // the app re-renders with them
    expect(a.pending()).toBe(0);
  });

  it("fills in fields the doc is missing", async () => {
    const c = cloud({ layout: "kanban", schemaVersion: SCHEMA_VERSION });
    const a = c.device(base);
    a.sync.start();
    await a.tick();
    expect(c.data).toEqual(profileDoc({ ...base, layout: "kanban" }));
  });

  it("a change on one device reaches the other", async () => {
    const c = cloud(profileDoc(base));
    const a = c.device(base), b = c.device(base);
    a.sync.start(); b.sync.start();
    a.change({ subjects: ["Math", "English", "Art"], subjectColors: { ...base.subjectColors, Art: "#abcdef" } });
    expect(c.data?.subjects).toEqual(["Math", "English"]); // waits 400ms
    await a.tick();
    expect(b.current.subjects).toEqual(["Math", "English", "Art"]);
    expect(b.current.subjectColors.Art).toBe("#abcdef");
    b.sync.localChanged(b.current);
    expect(b.pending()).toBe(0); // no echo write
  });

  it("a burst of changes is one write", async () => {
    const c = cloud(profileDoc(base));
    const a = c.device(base);
    a.sync.start();
    a.change({ layout: "board" }); a.change({ layout: "kanban" }); a.change({ timeFormat: "24h" });
    expect(a.pending()).toBe(1);
    await a.tick();
    expect(a.writes()).toBe(1);
    expect(c.data).toMatchObject({ layout: "kanban", timeFormat: "24h" });
  });

  it("a field changed here and not yet written survives another device's snapshot", async () => {
    const c = cloud(profileDoc(base));
    const a = c.device(base);
    a.sync.start();
    a.change({ layout: "board" }); // waiting to be written
    c.set({ layout: "pyramid", weekStart: 1 }); // another device, meanwhile
    expect(a.current.layout).toBe("board");
    expect(a.current.weekStart).toBe(1);
    await a.tick();
    expect(c.data).toMatchObject({ layout: "board", weekStart: 1 });
  });

  it("ignores the pending echo of its own write", async () => {
    const c = cloud(profileDoc(base));
    const a = c.device(base);
    a.sync.start();
    a.change({ weekStart: 1 });
    await a.tick();
    expect(a.applied).toEqual([]);
  });

  it("never writes back a doc from a newer app, but reads it", async () => {
    const c = cloud({ ...profileDoc({ ...base, layout: "kanban" }), schemaVersion: SCHEMA_VERSION + 1 });
    const a = c.device(base);
    a.sync.start();
    expect(a.newer).toEqual([true]);
    expect(a.current.layout).toBe("kanban");
    a.change({ layout: "board" });
    await a.tick();
    expect(c.data?.layout).toBe("kanban");
  });

  it("reports a refused write", async () => {
    const c = cloud(null);
    const a = c.device(base, { refuse: true });
    a.sync.start();
    await a.tick();
    expect(a.errors).toContain(SYNC_MESSAGES.save);
  });

  it("flush sends a waiting write at once", async () => {
    const c = cloud(profileDoc(base));
    const a = c.device(base);
    a.sync.start();
    a.change({ colorCodeUrgency: false });
    await a.sync.flush();
    expect(c.data?.colorCodeUrgency).toBe(false);
    expect(a.pending()).toBe(0);
  });

  it("stop() stops listening and drops a waiting write", async () => {
    const c = cloud(profileDoc(base));
    const a = c.device(base);
    a.sync.start();
    a.change({ layout: "board" });
    a.sync.stop();
    c.set({ weekStart: 1 });
    await a.tick();
    expect(a.current.weekStart).toBe(0);
    expect(c.data?.layout).toBe("list");
  });
});
