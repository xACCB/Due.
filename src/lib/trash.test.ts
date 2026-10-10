import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../types";
import { TRASH_DAYS, localRecords, pruneTrash, trashEntries } from "./trash";

const task = (id: number): Task => ({ id, title: `Task ${id}`, subject: "", dueDate: "", dueTime: "", estMins: 0, done: false, order: id });
const DAY = 86400000;

describe("trash", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 12, 0, 0)); });
  afterEach(() => { vi.useRealTimers(); });

  it("stamps deleted tasks with the time they were deleted", () => {
    expect(trashEntries([task(1), task(2)])).toEqual([{ task: task(1), deletedAt: Date.now() }, { task: task(2), deletedAt: Date.now() }]);
  });

  it("drops entries older than the limit and keeps the rest", () => {
    const fresh = { task: task(1), deletedAt: Date.now() - DAY };
    const edge = { task: task(2), deletedAt: Date.now() - TRASH_DAYS * DAY };
    const old = { task: task(3), deletedAt: Date.now() - TRASH_DAYS * DAY - 1 };
    expect(pruneTrash([fresh, edge, old])).toEqual([fresh, edge]);
  });

  it("returns the same list when there's nothing to drop, so nothing re-renders", () => {
    const list = [{ task: task(1), deletedAt: Date.now() }];
    expect(pruneTrash(list)).toBe(list);
  });
});

describe("localRecords", () => {
  it("lists live and deleted tasks by id", () => {
    const records = localRecords([task(1)], [{ task: task(2), deletedAt: 9 }]);
    expect(records.get(1)).toEqual({ task: task(1) });
    expect(records.get(2)).toEqual({ task: task(2), deletedAt: 9 });
    expect(records.size).toBe(2);
  });

  it("treats a task that's in both as live", () => {
    const records = localRecords([task(1)], [{ task: task(1), deletedAt: 9 }]);
    expect(records.get(1)).toEqual({ task: task(1) });
  });
});
