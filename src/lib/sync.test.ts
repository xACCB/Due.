import { describe, it, expect } from "vitest";
import { same, mergeFields, mergeRecord, reconcile, changedFields } from "./sync";
import type { SyncRecord, CloudRecord } from "./sync";

type T = { id: number; title: string; done: boolean; dueDate?: string };
const t = (over: Partial<T> = {}): T => ({ id: 1, title: "Essay", done: false, ...over });
const live = (task: T): SyncRecord<T> => ({ task });
const cloud = (task: T, updatedAt: number, deletedAt?: number): CloudRecord<T> =>
  deletedAt === undefined ? { task, updatedAt } : { task, updatedAt, deletedAt };

describe("same", () => {
  it("ignores key order and undefined fields", () => {
    expect(same({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(true);
    expect(same({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(same({ a: 1 }, { a: 2 })).toBe(false);
  });
});

describe("mergeFields", () => {
  const base = t();
  it("keeps each side's change to different fields", () => {
    const m = mergeFields(base, t({ title: "Essay v2" }), t({ done: true }), 100, 200);
    expect(m).toEqual(t({ title: "Essay v2", done: true }));
  });
  it("newest edit wins when both changed the same field", () => {
    expect(mergeFields(base, t({ title: "Mine" }), t({ title: "Theirs" }), 300, 200).title).toBe("Mine");
    expect(mergeFields(base, t({ title: "Mine" }), t({ title: "Theirs" }), 100, 200).title).toBe("Theirs");
  });
  it("respects a field removed on one side", () => {
    const b = t({ dueDate: "2026-10-01" });
    expect(mergeFields(b, t(), t({ dueDate: "2026-10-01", done: true }), 100, 200)).toEqual(t({ done: true }));
  });
});

describe("mergeRecord", () => {
  const base = live(t());
  it("takes the cloud version when this device has no unsaved change", () => {
    expect(mergeRecord(base, base, cloud(t({ done: true }), 5), undefined)).toEqual(live(t({ done: true })));
    expect(mergeRecord(base, base, undefined, undefined)).toBeUndefined();
  });
  it("keeps an unsaved local edit the cloud hasn't touched (the old 400ms overwrite bug)", () => {
    const local = live(t({ title: "Edited" }));
    expect(mergeRecord(base, local, cloud(t(), 1), 500)).toEqual(local);
  });
  it("delete vs. edit: newest wins", () => {
    const deleted = cloud(t(), 900, 900);
    expect(mergeRecord(base, live(t({ title: "Edited" })), deleted, 500)).toEqual({ task: t(), deletedAt: 900 });
    expect(mergeRecord(base, live(t({ title: "Edited" })), deleted, 1000)).toEqual(live(t({ title: "Edited" })));
  });
  it("a brand-new local task survives a snapshot that doesn't have it yet", () => {
    expect(mergeRecord(undefined, live(t()), undefined, 100)).toEqual(live(t()));
  });
});

describe("reconcile", () => {
  it("merges a whole set", () => {
    const base = new Map([[1, live(t())], [2, live(t({ id: 2 }))]]);
    const local = new Map([[1, live(t({ title: "Mine" }))], [2, live(t({ id: 2 }))], [3, live(t({ id: 3 }))]]);
    const cl = new Map([[1, cloud(t({ done: true }), 50)], [4, cloud(t({ id: 4 }), 60)]]);
    const out = reconcile(base, local, cl, new Map([[1, 100], [3, 100]]));
    expect([...out.keys()].sort()).toEqual([1, 3, 4]); // 2 was deleted elsewhere
    expect(out.get(1)).toEqual(live(t({ title: "Mine", done: true })));
  });
});

describe("changedFields", () => {
  it("lists changed and removed fields", () => {
    const DEL = Symbol("del");
    expect(changedFields(t({ dueDate: "x" }), t({ title: "New" }), DEL)).toEqual({ title: "New", dueDate: DEL });
  });
});
