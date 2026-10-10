import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../types";
import { buildSuggestion, dateInDays, isUntouchedExample, nextOrder, setDone, snoozeTarget } from "./tasks";

const task = (id: number, extra: Partial<Task> = {}): Task =>
  ({ id, title: `Task ${id}`, subject: "Math", dueDate: "", dueTime: "", estMins: 30, done: false, order: id, ...extra });

describe("nextOrder", () => {
  it("is one past the highest order, not the list length", () => {
    expect(nextOrder([])).toBe(0);
    expect(nextOrder([task(1, { order: 0 }), task(2, { order: 7 })])).toBe(8);
  });
});

describe("setDone", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 12, 0, 0)); });
  afterEach(() => { vi.useRealTimers(); });

  it("marks a task done with the time it was finished, leaving the others alone", () => {
    const before = [task(1), task(2)];
    const after = setDone(before, [1], true);
    expect(after[0]).toMatchObject({ id: 1, done: true, completedAt: Date.now() });
    expect(after[1]).toBe(before[1]);
    expect(before[0].done).toBe(false); // the input isn't changed
  });

  it("does nothing for a task already in that state, or an unknown id", () => {
    const before = [task(1, { done: true, completedAt: 5 })];
    expect(setDone(before, [1, 99], true)).toEqual(before);
  });

  it("un-completing clears the finished time and un-archives", () => {
    const after = setDone([task(1, { done: true, completedAt: 5, archived: true })], [1], false);
    expect(after[0]).toMatchObject({ done: false, completedAt: null, archived: false });
  });

  it("completing a repeating task adds the next one: later date, fresh subtasks, no sessions", () => {
    const before = [task(1, { recurrence: "weekly", dueDate: "2026-10-12", dueTime: "09:00",
      subtasks: [{ id: "a", text: "Read", done: true }], sessions: [{ mins: 20, at: 1 }], order: 4 })];
    const after = setDone(before, [1], true);
    expect(after).toHaveLength(2);
    const [orig, copy] = after;
    expect(orig.spawnedNextId).toBe(copy.id);
    expect(copy).toMatchObject({ done: false, completedAt: null, dueDate: "2026-10-19", dueTime: "09:00", order: 5, sessions: [], spawnedNextId: null });
    expect(copy.id).not.toBe(1);
    expect(copy.subtasks).toHaveLength(1);
    expect(copy.subtasks![0]).toMatchObject({ text: "Read", done: false });
    expect(copy.subtasks![0].id).not.toBe("a");
  });

  it("a repeating task with no due date spawns a copy that also has none", () => {
    const after = setDone([task(1, { recurrence: "daily" })], [1], true);
    expect(after[1].dueDate).toBe("");
  });

  it("un-completing takes the spawned copy back, unless that copy was itself finished", () => {
    const done = setDone([task(1, { recurrence: "daily", dueDate: "2026-10-10" })], [1], true);
    const undone = setDone(done, [1], false);
    expect(undone.map(t => t.id)).toEqual([1]);
    expect(undone[0].spawnedNextId).toBeNull();

    const copyId = done[1].id;
    const copyDone = setDone(done, [copyId], true);         // finish the copy too (spawns a third)
    const origUndone = setDone(copyDone, [1], false);
    expect(origUndone.some(t => t.id === copyId)).toBe(true); // the finished copy stays
  });

  it("completing twice doesn't spawn twice", () => {
    const once = setDone([task(1, { recurrence: "daily", dueDate: "2026-10-10" })], [1], true);
    const again = setDone(once.map(t => t.id === 1 ? { ...t, done: false } : t), [1], true);
    expect(again).toHaveLength(2);
  });

  it("handles several ids in one go", () => {
    expect(setDone([task(1), task(2), task(3)], [1, 3], true).map(t => t.done)).toEqual([true, false, true]);
  });
});

describe("buildSuggestion", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 12, 0, 0)); });
  afterEach(() => { vi.useRealTimers(); });

  it("has a line for nothing left and for one left", () => {
    expect(buildSuggestion([])).toBe("Nothing left to do. Great work!");
    expect(buildSuggestion([task(1, { done: true }), task(2, { archived: true })])).toBe("Nothing left to do. Great work!");
    expect(buildSuggestion([task(1, { title: "Essay" })])).toBe(`Just one task left: "Essay". You've got this!`);
  });

  it("names the most urgent task, by priority and then by date", () => {
    const text = buildSuggestion([
      task(1, { title: "Later", dueDate: "2026-10-30" }),
      task(2, { title: "Overdue one", dueDate: "2026-10-09", estMins: 20 }),
      task(3, { title: "Today", dueDate: "2026-10-10" }),
    ]);
    expect(text).toBe(`Most urgent: "Overdue one"\noverdue, ~20m`);
  });

  it("leaves the estimate out when there isn't one", () => {
    const text = buildSuggestion([task(1, { title: "A", dueDate: "2026-10-10", estMins: 0 }), task(2, { title: "B", dueDate: "2026-10-20" })]);
    expect(text).toBe(`Most urgent: "A"\ndue today`);
  });
});

describe("dateInDays and snoozeTarget", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("counts days in local time, across a month end", () => {
    vi.setSystemTime(new Date(2026, 9, 30, 23, 30, 0));
    expect(dateInDays(0)).toBe("2026-10-30");
    expect(dateInDays(2)).toBe("2026-11-01");
  });

  it("snoozes to tomorrow or next week with no time", () => {
    vi.setSystemTime(new Date(2026, 9, 10, 12, 0, 0));
    expect(snoozeTarget("tomorrow")).toEqual({ dueDate: "2026-10-11" });
    expect(snoozeTarget("week")).toEqual({ dueDate: "2026-10-17" });
  });

  it("snoozes \"later\" to three hours on, rounded up to a quarter hour, even past midnight", () => {
    vi.setSystemTime(new Date(2026, 9, 10, 12, 7, 30));
    expect(snoozeTarget("later")).toEqual({ dueDate: "2026-10-10", dueTime: "15:15" });
    vi.setSystemTime(new Date(2026, 9, 10, 12, 0, 0));
    expect(snoozeTarget("later")).toEqual({ dueDate: "2026-10-10", dueTime: "15:00" });
    vi.setSystemTime(new Date(2026, 9, 10, 22, 50, 0));
    expect(snoozeTarget("later")).toEqual({ dueDate: "2026-10-11", dueTime: "02:00" });
  });
});

describe("isUntouchedExample", () => {
  const example = task(1, { title: "Chapter 5 Review", subject: "Math", estMins: 45 });
  it("recognises a seeded example exactly as it was", () => {
    expect(isUntouchedExample(example)).toBe(true);
  });
  it("doesn't touch one the user changed, finished or added to", () => {
    expect(isUntouchedExample({ ...example, title: "Chapter 5 review" })).toBe(false);
    expect(isUntouchedExample({ ...example, done: true })).toBe(false);
    expect(isUntouchedExample({ ...example, tags: ["x"] })).toBe(false);
    expect(isUntouchedExample({ ...example, id: 9 })).toBe(false);
    expect(isUntouchedExample(task(7, { title: "My own task" }))).toBe(false);
  });
});
