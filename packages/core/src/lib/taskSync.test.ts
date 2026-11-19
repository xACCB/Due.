import { describe, expect, it } from "vitest";

// core has no ambient platform types (see its tsconfig); the test runs in Node, which has these.
declare function queueMicrotask(cb: () => void): void;
declare function setTimeout(cb: (...a: unknown[]) => void, ms: number): unknown;
declare function clearTimeout(t: unknown): void;
import type { Task } from "../types";
import type { TrashEntry } from "./trash";
import { createTaskSync, SYNC_MESSAGES, type CloudDoc, type SnapshotMeta, type TaskSyncAdapter } from "./taskSync";
import { SCHEMA_VERSION } from "./migrations";

// An in-memory stand-in for Firestore: docs by path ("tasks/1", "trash/1",
// "counts"), merge writes, deleteField and increment, and listeners told after
// every commit. Two "devices" (engines) on one fake cloud is one account.
const DELETE = Symbol("deleteField");
type Inc = { inc: number };
class FakeCloud {
  docs = new Map<string, CloudDoc>([["counts", { n: 0, t: 0, last: "" }]]);
  listeners = { tasks: new Set<(d: CloudDoc[], m: SnapshotMeta) => void>(), trash: new Set<(d: CloudDoc[], m: SnapshotMeta) => void>() };
  refuseNext = 0;
  commits = 0;
  list(kind: "tasks" | "trash") { return [...this.docs].filter(([p]) => p.startsWith(kind + "/")).map(([, d]) => d); }
  notify() { for (const k of ["tasks", "trash"] as const) for (const l of this.listeners[k]) l(this.list(k), { pending: false, fromCache: false, changed: true }); }
  apply(ops: (() => void)[]) {
    this.commits++;
    if (this.refuseNext > 0) { this.refuseNext--; return Promise.reject({ code: "permission-denied" }); }
    for (const op of ops) op();
    queueMicrotask(() => this.notify());
    return Promise.resolve();
  }
}

function adapter(cloud: FakeCloud): TaskSyncAdapter<string> {
  return {
    ops: { deleteField: () => DELETE, increment: (n: number) => ({ inc: n }) },
    refs: id => ({ task: `tasks/${id}`, trash: `trash/${id}`, counts: "counts" }),
    batch() {
      const ops: (() => void)[] = [];
      return {
        set(ref, data, options) {
          ops.push(() => {
            const next: CloudDoc = { ...(options?.merge ? cloud.docs.get(ref) ?? {} : {}) };
            for (const [k, v] of Object.entries(data)) { if (v === DELETE) delete next[k]; else next[k] = v; }
            cloud.docs.set(ref, next);
          });
        },
        delete(ref) { ops.push(() => { cloud.docs.delete(ref); }); },
        update(ref, data) {
          ops.push(() => {
            const next: CloudDoc = { ...cloud.docs.get(ref) };
            for (const [k, v] of Object.entries(data)) next[k] = typeof v === "object" && v && "inc" in v ? (Number(next[k]) || 0) + (v as Inc).inc : v;
            cloud.docs.set(ref, next);
          });
        },
        commit: () => cloud.apply(ops),
      };
    },
    existsOnServer: ref => Promise.resolve(cloud.docs.has(ref)),
    listen(kind, next) {
      cloud.listeners[kind].add(next);
      queueMicrotask(() => next(cloud.list(kind), { pending: false, fromCache: false, changed: true }));
      return () => { cloud.listeners[kind].delete(next); };
    },
    isRefused: e => (e as { code?: string })?.code === "permission-denied",
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: t => clearTimeout(t as ReturnType<typeof setTimeout>),
  };
}

const task = (id: number, title: string, extra: Partial<Task> = {}): Task =>
  ({ id, order: id, title, subject: "", dueDate: "", dueTime: "", estMins: 0, done: false, ...extra });

// A device: its own tasks, saved locally, and an engine syncing them.
function device(cloud: FakeCloud, opts: { tasks?: Task[]; isNewAccount?: boolean; mergeLocal?: boolean } = {}) {
  let state: { tasks: Task[]; trash: TrashEntry[] } = { tasks: opts.tasks ?? [], trash: [] };
  const errors: (string | null)[] = [];
  let newer = false;
  const engine = createTaskSync(adapter(cloud), {
    merged(tasks, trash) { state = { tasks, trash }; engine.localChanged(tasks, trash); },
    ready() {},
    status() {},
    error(m) { errors.push(m); },
    newer(any) { newer = any; },
  }, { getLocal: () => state, isNewAccount: opts.isNewAccount ?? false, mergeLocal: opts.mergeLocal ?? false, debounceMs: 0 });
  engine.start();
  return {
    engine, errors,
    get: () => state,
    newer: () => newer,
    set(tasks: Task[], trash: TrashEntry[] = state.trash) { state = { tasks, trash }; engine.localChanged(tasks, trash); },
  };
}

// Lets timers, commits and listener callbacks run until things settle.
const settle = () => new Promise(r => setTimeout(r, 30));

describe("task sync between two devices", () => {
  it("sends a new task to the other device and counts it", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud), b = device(cloud);
    await settle();
    a.set([task(1, "Essay")]);
    await settle();
    expect(b.get().tasks.map(t => t.title)).toEqual(["Essay"]);
    expect(cloud.docs.get("tasks/1")).toMatchObject({ id: 1, title: "Essay", schemaVersion: SCHEMA_VERSION });
    expect(cloud.docs.get("counts")).toMatchObject({ n: 1, t: 0, last: "1" });
  });

  it("merges edits to different fields made on both devices", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud), b = device(cloud);
    await settle();
    a.set([task(1, "Essay", { estMins: 30 })]);
    await settle();
    // Both edit before hearing from the other: A the title, B the estimate.
    a.set([{ ...a.get().tasks[0], title: "Essay draft" }]);
    b.set([{ ...b.get().tasks[0], estMins: 90 }]);
    await settle();
    await settle();
    for (const d of [a, b]) expect(d.get().tasks[0]).toMatchObject({ title: "Essay draft", estMins: 90 });
  });

  it("moves a deleted task to Recently deleted on the other device", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud), b = device(cloud);
    await settle();
    a.set([task(1, "Essay"), task(2, "Quiz")]);
    await settle();
    a.set([task(2, "Quiz")], [{ task: task(1, "Essay"), deletedAt: 1000 }]);
    await settle();
    expect(b.get().tasks.map(t => t.id)).toEqual([2]);
    expect(b.get().trash.map(e => e.task.id)).toEqual([1]);
    expect(cloud.docs.has("tasks/1")).toBe(false);
    expect(cloud.docs.get("counts")).toMatchObject({ n: 1, t: 1 });
  });

  it("keeps tasks made while signed out on an explicit sign-in, and uploads them", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    await settle();
    a.set([task(1, "From the cloud")]);
    await settle();
    const phone = device(cloud, { tasks: [task(7, "Made signed out")], mergeLocal: true });
    await settle();
    expect(phone.get().tasks.map(t => t.title).sort()).toEqual(["From the cloud", "Made signed out"]);
    await settle();
    expect(a.get().tasks.map(t => t.title).sort()).toEqual(["From the cloud", "Made signed out"]);
  });

  it("drops a local task the cloud no longer has on a restored session (deleted elsewhere)", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    await settle();
    a.set([task(1, "Keep")]);
    await settle();
    const phone = device(cloud, { tasks: [task(1, "Keep"), task(9, "Deleted elsewhere")] });
    await settle();
    expect(phone.get().tasks.map(t => t.id)).toEqual([1]);
  });

  it("leaves local tasks alone for a brand-new account, then uploads them", async () => {
    const cloud = new FakeCloud();
    const phone = device(cloud, { tasks: [task(3, "First task")], isNewAccount: true });
    await settle();
    await settle();
    expect(phone.get().tasks.map(t => t.id)).toEqual([3]);
    expect(cloud.docs.get("tasks/3")).toMatchObject({ title: "First task" });
  });

  it("never writes back a task saved by a newer app", async () => {
    const cloud = new FakeCloud();
    cloud.docs.set("tasks/5", { ...task(5, "From the future"), updatedAt: 1, schemaVersion: 999, futureField: true });
    const phone = device(cloud);
    await settle();
    expect(phone.newer()).toBe(true);
    phone.set([{ ...phone.get().tasks[0], title: "Edited here" }]);
    await settle();
    expect(cloud.docs.get("tasks/5")).toMatchObject({ title: "From the future", futureField: true });
  });

  it("retries a refused write from what really exists", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    await settle();
    cloud.refuseNext = 1;
    a.set([task(1, "Essay")]);
    await settle();
    expect(cloud.docs.get("tasks/1")).toMatchObject({ title: "Essay" });
    expect(cloud.docs.get("counts")).toMatchObject({ n: 1 });
    expect(a.errors.filter(Boolean)).toEqual([]);
  });

  it("says when the task limit stops a new task syncing", async () => {
    const cloud = new FakeCloud();
    const a = device(cloud);
    await settle();
    cloud.refuseNext = 2; // the write and its retry
    a.set([task(1, "One too many")]);
    await settle();
    expect(a.errors).toContain(SYNC_MESSAGES.limit);
  });

  it("sends a waiting write at once on flush (sign-out)", async () => {
    const cloud = new FakeCloud();
    let state: { tasks: Task[]; trash: TrashEntry[] } = { tasks: [], trash: [] };
    const engine = createTaskSync(adapter(cloud), { merged() {}, ready() {}, status() {}, error() {}, newer() {} },
      { getLocal: () => state, isNewAccount: false, mergeLocal: false, debounceMs: 60_000 });
    engine.start();
    await settle();
    state = { tasks: [task(4, "Last edit")], trash: [] };
    engine.localChanged(state.tasks, state.trash);
    expect(cloud.docs.has("tasks/4")).toBe(false);
    await engine.flush();
    expect(cloud.docs.get("tasks/4")).toMatchObject({ title: "Last edit" });
    engine.stop();
  });
});
