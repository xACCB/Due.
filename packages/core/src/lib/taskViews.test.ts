import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "../types";
import {
  SEARCH_MAX, allTagsOf, completionStats, filterTasks, groupTasks, heldOpen, isSettled, prioritySplit,
  searchTasks, sortTasks, timeLeft, withHeldOpen,
} from "./taskViews";

const task = (id: number, extra: Partial<Task> = {}): Task =>
  ({ id, title: `Task ${id}`, subject: "Math", dueDate: "", dueTime: "", estMins: 30, done: false, order: id, ...extra });
const ids = (list: Task[]) => list.map(t => t.id);

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 10, 12, 0, 0)); });
afterEach(() => { vi.useRealTimers(); });

describe("held open while the completion animation plays", () => {
  it("a just-ticked task still counts as open; a finished one that has settled doesn't", () => {
    const done = task(1, { done: true });
    expect(heldOpen(done, [1])).toBe(true);
    expect(isSettled(done, [1])).toBe(false);
    expect(heldOpen(done, [])).toBe(false);
    expect(isSettled(done, [])).toBe(true);
    expect(heldOpen(task(2), [])).toBe(true);
  });
  it("shows just-ticked tasks as open, and returns the same list when there are none", () => {
    const list = [task(1, { done: true }), task(2, { done: true })];
    expect(withHeldOpen(list, [1]).map(t => t.done)).toEqual([false, true]);
    expect(withHeldOpen(list, [])).toBe(list);
  });
});

describe("sortTasks", () => {
  it("open tasks in manual order, then finished ones in manual order", () => {
    const list = [task(1, { order: 3 }), task(2, { order: 0, done: true }), task(3, { order: 1 }), task(4, { order: 2, done: true })];
    expect(ids(sortTasks(list, []))).toEqual([3, 1, 2, 4]);
  });
  it("a just-ticked task keeps its place", () => {
    const list = [task(1, { order: 0, done: true }), task(2, { order: 1 })];
    expect(ids(sortTasks(list, [1]))).toEqual([1, 2]);
    expect(ids(sortTasks(list, []))).toEqual([2, 1]);
  });
  it("doesn't reorder the list it was given", () => {
    const list = [task(2, { order: 5 }), task(1, { order: 0 })];
    sortTasks(list, []);
    expect(ids(list)).toEqual([2, 1]);
  });
});

describe("filterTasks", () => {
  const list = [
    task(1), task(2, { done: true }), task(3, { archived: true, done: true }), task(4, { subject: "Art", estMins: 0 }),
    task(5, { subject: "" }), task(6, { done: true, subject: "Art" }),
  ];
  const view = (filter: string, extra: Partial<{ subject: string | null; showDone: boolean; justDone: number[] }> = {}) =>
    ids(filterTasks(list, { filter, subject: null, showDone: true, justDone: [], ...extra }));

  it("all: everything but archived; finished ones only if \"show completed\" is on", () => {
    expect(view("all")).toEqual([1, 2, 4, 5, 6]);
    expect(view("all", { showDone: false })).toEqual([1, 4, 5]);
  });
  it("a just-ticked task stays in view with \"show completed\" off, and under Pending", () => {
    expect(view("all", { showDone: false, justDone: [2] })).toEqual([1, 2, 4, 5]);
    expect(view("pending", { justDone: [2] })).toEqual([1, 2, 4, 5]);
  });
  it("pending, done and archived", () => {
    expect(view("pending")).toEqual([1, 4, 5]);
    expect(view("done")).toEqual([2, 6]);
    expect(view("archived")).toEqual([3]);
  });
  it("noest: open tasks with no estimate", () => {
    expect(view("noest")).toEqual([4]);
  });
  it("a subject narrows any view; \"\" means no subject", () => {
    expect(view("all", { subject: "Art" })).toEqual([4, 6]);
    expect(view("done", { subject: "Art" })).toEqual([6]);
    expect(view("all", { subject: "" })).toEqual([5]);
    expect(view("archived", { subject: "Art" })).toEqual([]);
  });
});

describe("groupTasks", () => {
  it("by subject: in order of first appearance, with a \"No subject\" group", () => {
    const groups = groupTasks([task(1, { subject: "Art" }), task(2, { subject: "" }), task(3, { subject: "Art" }), task(4)], "subject");
    expect(groups.map(g => [g.key, g.label, ids(g.tasks)])).toEqual([["Art", "Art", [1, 3]], ["No subject", "No subject", [2]], ["Math", "Math", [4]]]);
  });
  it("by priority: high, medium, low, with readable headings", () => {
    const groups = groupTasks([task(1, { priorityOverride: "low" }), task(2, { priorityOverride: "high" }), task(3, { priorityOverride: "medium" })], "priority");
    expect(groups.map(g => [g.key, g.label])).toEqual([["high", "High priority"], ["medium", "Medium priority"], ["low", "Low priority"]]);
  });
  it("by due date: earliest first, undated last as \"Anytime\"", () => {
    const groups = groupTasks([task(1), task(2, { dueDate: "2026-10-20" }), task(3, { dueDate: "2026-10-12" }), task(4, { dueDate: "2026-10-20" })], "dueDate");
    expect(groups.map(g => g.key)).toEqual(["2026-10-12", "2026-10-20", "Anytime"]);
    expect(ids(groups[1].tasks)).toEqual([2, 4]);
    expect(groups[2].label).toBe("Anytime");
    expect(groups[0].label).not.toBe("2026-10-12"); // shown as a readable date
  });
});

describe("prioritySplit", () => {
  it("splits unsettled tasks by priority and puts settled ones in done", () => {
    const list = [task(1, { priorityOverride: "high" }), task(2, { priorityOverride: "low" }), task(3, { priorityOverride: "high", done: true }), task(4, { priorityOverride: "medium", done: true })];
    const split = prioritySplit(list, [4]);
    expect([ids(split.high), ids(split.medium), ids(split.low), ids(split.done)]).toEqual([[1], [4], [2], [3]]);
  });
});

describe("timeLeft", () => {
  const today = "2026-10-10";
  it("totals open tasks only, per subject largest first, with the share and time logged", () => {
    const left = timeLeft([
      task(1, { estMins: 30, sessions: [{ mins: 10, at: 1 }, { mins: 5, at: 2 }] }),
      task(2, { estMins: 90, subject: "Art" }),
      task(3, { estMins: 60, subject: "" }),
      task(4, { estMins: 500, done: true }),
      task(5, { estMins: 500, archived: true }),
      task(6, { estMins: 0, subject: "PE" }),
    ], today);
    expect(left.totalMins).toBe(180);
    expect(left.bySubject).toEqual([
      { name: "Art", mins: 90, spent: 0, pct: 50 },
      { name: "", mins: 60, spent: 0, pct: 33 },
      { name: "Math", mins: 30, spent: 15, pct: 17 },
    ]);
    expect(left.noEstimateCount).toBe(1);
    expect(ids(left.openTasks)).toEqual([1, 2, 3, 6]);
  });
  it("splits by when things are due and drops empty groups", () => {
    const left = timeLeft([task(1, { dueDate: "2026-10-09", estMins: 20 }), task(2, { dueDate: "2026-10-10", estMins: 40 }), task(3, { dueDate: "2026-10-10", estMins: 5 })], today);
    expect(left.byDue.map(b => [b.key, b.count, b.mins])).toEqual([["overdue", 1, 20], ["today", 2, 45]]);
  });
  it("is all zeros with nothing open", () => {
    expect(timeLeft([task(1, { done: true })], today)).toMatchObject({ totalMins: 0, bySubject: [], byDue: [], noEstimateCount: 0 });
  });
});

describe("searchTasks", () => {
  const list = [
    task(1, { title: "Essay draft", subject: "English" }), task(2, { title: "Lab", subject: "Science", tags: ["essay-week"] }),
    task(3, { title: "Essay notes", done: true, order: 0 }), task(4, { title: "Old essay", archived: true }), task(5, { title: "Maths" }),
  ];
  it("matches the title, subject or a tag; skips archived; open tasks first", () => {
    expect(ids(searchTasks(list, "essay"))).toEqual([1, 2, 3]);
    expect(ids(searchTasks(list, "science"))).toEqual([2]);
  });
  it("returns nothing for an empty search, and at most the limit", () => {
    expect(searchTasks(list, "")).toEqual([]);
    const many = Array.from({ length: SEARCH_MAX + 20 }, (_, i) => task(i + 1));
    expect(searchTasks(many, "task")).toHaveLength(SEARCH_MAX);
  });
});

describe("allTagsOf and completionStats", () => {
  it("lists each tag once, alphabetically", () => {
    expect(allTagsOf([task(1, { tags: ["b", "a"] }), task(2, { tags: ["a", "c"] }), task(3)])).toEqual(["a", "b", "c"]);
  });
  it("counts done, total and urgent, and the share done", () => {
    const stats = completionStats([task(1, { done: true }), task(2, { priorityOverride: "high" }), task(3, { priorityOverride: "high", done: true }), task(4, { priorityOverride: "low" })]);
    expect(stats).toEqual({ done: 2, total: 4, urgent: 1, pct: 50 });
    expect(completionStats([])).toEqual({ done: 0, total: 0, urgent: 0, pct: 0 });
  });
});
