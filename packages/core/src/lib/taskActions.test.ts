import { describe, expect, it } from "vitest";
import type { Task, TaskTemplate } from "../types";
import { SUBJECT_COLOR_PALETTE } from "../constants";
import { LIMITS } from "./limits";
import {
  TRASH_MAX, dueDatePatch, duplicateOf, freshSubtasks, movedOrder, patchTask, patchTasks, recolouredSubjects,
  renamedSubjects, restoredInto, skipPatch, snoozePatch, subjectRename, subjectToAdd, taskFromTemplate,
  tasksRenamedSubject, templateFromTask, templatesRenamedSubject, trashRenamedSubject, withNewTask, withOrder,
  withTrashed, withoutSubjectColor, withoutTasks, withoutTrashed,
} from "./taskActions";

const task = (id: number, extra: Partial<Task> = {}): Task =>
  ({ id, title: `Task ${id}`, subject: "Math", dueDate: "", dueTime: "", estMins: 30, done: false, order: id, ...extra });

describe("changing tasks in place", () => {
  it("patches one task and returns the others untouched", () => {
    const before = [task(1), task(2)];
    const after = patchTask(before, 2, { archived: true, title: "New" });
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toEqual({ ...before[1], archived: true, title: "New" });
    expect(before[1].archived).toBeUndefined();
  });
  it("an explicit undefined clears a field (how priority goes back to automatic)", () => {
    const after = patchTask([task(1, { priorityOverride: "high" })], 1, { priorityOverride: undefined });
    expect(after[0].priorityOverride).toBeUndefined();
  });
  it("patches several tasks, asking per task", () => {
    const after = patchTasks([task(1), task(2), task(3)], [1, 3], t => ({ title: `x${t.id}` }));
    expect(after.map(t => t.title)).toEqual(["x1", "Task 2", "x3"]);
  });
  it("removes tasks by id", () => {
    expect(withoutTasks([task(1), task(2), task(3)], [2, 9]).map(t => t.id)).toEqual([1, 3]);
  });
});

describe("skip, snooze and bulk due date", () => {
  it("skip moves a repeating task one repeat on, from today if it has no date", () => {
    expect(skipPatch(task(1, { recurrence: "weekly", dueDate: "2026-10-12" }), "2026-10-10")).toEqual({ dueDate: "2026-10-19" });
    expect(skipPatch(task(1, { recurrence: "daily" }), "2026-10-10")).toEqual({ dueDate: "2026-10-11" });
  });
  it("snooze keeps the task's own time unless the snooze sets one", () => {
    expect(snoozePatch(task(1, { dueTime: "09:00" }), { dueDate: "2026-10-11" })).toEqual({ dueDate: "2026-10-11", dueTime: "09:00" });
    expect(snoozePatch(task(1, { dueTime: "09:00" }), { dueDate: "2026-10-10", dueTime: "15:15" })).toEqual({ dueDate: "2026-10-10", dueTime: "15:15" });
    expect(snoozePatch(task(1), { dueDate: "2026-10-11" })).toEqual({ dueDate: "2026-10-11", dueTime: "" });
  });
  it("a bulk due date keeps each time; clearing the date clears the time", () => {
    const t = task(1, { dueDate: "2026-10-10", dueTime: "09:00" });
    expect(dueDatePatch("2026-10-20")(t)).toEqual({ dueDate: "2026-10-20", dueTime: "09:00" });
    expect(dueDatePatch("")(t)).toEqual({ dueDate: "", dueTime: "" });
  });
});

describe("new tasks", () => {
  it("duplicates as a fresh, open task at the end of the list", () => {
    const src = task(1, { done: true, completedAt: 5, archived: true, spawnedNextId: 9, sessions: [{ mins: 10, at: 1 }], order: 0,
      subtasks: [{ id: "a", text: "Read", done: true }], tags: ["exam"], recurrence: "weekly" });
    const copy = duplicateOf(src, [src, task(2, { order: 6 })]);
    expect(copy).toMatchObject({ title: src.title, done: false, completedAt: null, archived: false, spawnedNextId: null, sessions: [], order: 7, tags: ["exam"], recurrence: "weekly" });
    expect(copy.id).not.toBe(src.id);
    expect(copy.subtasks).toHaveLength(1);
    expect(copy.subtasks![0]).toMatchObject({ text: "Read", done: false });
    expect(copy.subtasks![0].id).not.toBe("a");
    expect(src.subtasks![0].done).toBe(true); // the original isn't changed
  });
  it("a task without subtasks duplicates without the field", () => {
    expect("subtasks" in duplicateOf(task(1), [task(1)])).toBe(false);
  });
  it("turns a template's subtasks into real, unchecked ones", () => {
    expect(freshSubtasks(null)).toBeUndefined();
    const subs = freshSubtasks([{ text: "A" }, { text: "B" }])!;
    expect(subs.map(s => [s.text, s.done])).toEqual([["A", false], ["B", false]]);
    expect(new Set(subs.map(s => s.id)).size).toBe(2);
  });
  it("adds a new task at the end with its own id and order", () => {
    const before = [task(1, { order: 3 })];
    const after = withNewTask(before, { ...task(0), title: "New", done: true } as Task);
    expect(after).toHaveLength(2);
    expect(after[1]).toMatchObject({ title: "New", done: false, order: 4 });
    expect(after[1].id).not.toBe(0);
    expect("subtasks" in after[1]).toBe(false);
    expect(withNewTask(before, task(0), [{ id: "s", text: "x", done: false }])[1].subtasks).toHaveLength(1);
    expect(before).toHaveLength(1);
  });
});

describe("templates", () => {
  it("saves a task's subject, estimate, repeat and subtask names", () => {
    const tpl = templateFromTask(task(1, { subject: "Art", estMins: 45, recurrence: "weekly", subtasks: [{ id: "a", text: "Sketch", done: true }] }), "Weekly sketch");
    expect(tpl).toMatchObject({ name: "Weekly sketch", subject: "Art", estMins: 45, recurrence: "weekly", subtasks: [{ text: "Sketch" }] });
    expect(typeof tpl.id).toBe("string");
    expect(templateFromTask(task(1), "x").subtasks).toEqual([]);
  });
  it("a template answers everything but the due date", () => {
    const tpl: TaskTemplate = { id: "t", name: "Reading", subject: "English", estMins: 20, recurrence: "daily" };
    expect(taskFromTemplate(tpl)).toEqual({ title: "Reading", subject: "English", dueDate: "", dueTime: "", estMins: 20, recurrence: "daily" });
  });
});

describe("recently deleted", () => {
  const entry = (id: number, at = 1) => ({ task: task(id), deletedAt: at });
  it("puts new entries on top and replaces an older entry for the same task", () => {
    const after = withTrashed([entry(1, 1), entry(2, 1)], [entry(2, 9), entry(3, 9)]);
    expect(after.map(e => [e.task.id, e.deletedAt])).toEqual([[2, 9], [3, 9], [1, 1]]);
  });
  it("keeps only the newest entries past the limit", () => {
    const old = Array.from({ length: TRASH_MAX }, (_, i) => entry(i + 10));
    const after = withTrashed(old, [entry(1, 9)]);
    expect(after).toHaveLength(TRASH_MAX);
    expect(after[0].task.id).toBe(1);
    expect(after.some(e => e.task.id === TRASH_MAX + 9)).toBe(false); // the last one fell off
  });
  it("removes entries by id", () => {
    expect(withoutTrashed([entry(1), entry(2)], [1]).map(e => e.task.id)).toEqual([2]);
  });
  it("restores a task to the end of the list, once", () => {
    const tasks = [task(1, { order: 4 })];
    const after = restoredInto(tasks, { task: task(2, { order: 0 }), deletedAt: 1 });
    expect(after.map(t => [t.id, t.order])).toEqual([[1, 4], [2, 5]]);
    expect(restoredInto(after, { task: task(2), deletedAt: 1 })).toBe(after);
  });
});

describe("manual order", () => {
  it("moves a task and renumbers the open ones", () => {
    const moved = movedOrder([5, 6, 7], 7, -2)!;
    expect([...moved.order]).toEqual([[7, 0], [5, 1], [6, 2]]);
    expect(moved).toMatchObject({ position: 1, count: 3 });
    expect(movedOrder([5, 6, 7], 5, 1)!.position).toBe(2);
  });
  it("can't move past either end, or a task that isn't there", () => {
    expect(movedOrder([5, 6], 5, -1)).toBeNull();
    expect(movedOrder([5, 6], 6, 1)).toBeNull();
    expect(movedOrder([5, 6], 9, 1)).toBeNull();
  });
  it("doesn't change the list it was given", () => {
    const ids = [5, 6, 7]; movedOrder(ids, 5, 2);
    expect(ids).toEqual([5, 6, 7]);
  });
  it("applies the new numbers, leaving other tasks (finished ones) alone", () => {
    const after = withOrder([task(5), task(6), task(9, { order: 42 })], new Map([[5, 1], [6, 0]]));
    expect(after.map(t => [t.id, t.order])).toEqual([[5, 1], [6, 0], [9, 42]]);
  });
});

describe("subjects", () => {
  it("adds a trimmed name with the first unused palette colour", () => {
    expect(subjectToAdd("  Music ", ["Math"], { Math: SUBJECT_COLOR_PALETTE[0] })).toEqual({ name: "Music", color: SUBJECT_COLOR_PALETTE[1] });
  });
  it("refuses an empty name, a duplicate (any case) or a full list", () => {
    expect(subjectToAdd("  ", [], {})).toBeNull();
    expect(subjectToAdd("math", ["Math"], {})).toBeNull();
    expect(subjectToAdd("New", Array.from({ length: LIMITS.subjects }, (_, i) => `S${i}`), {})).toBeNull();
  });
  it("reuses palette colours once they've all been taken", () => {
    const colors = Object.fromEntries(SUBJECT_COLOR_PALETTE.map((c, i) => [`S${i}`, c]));
    const subjects = Object.keys(colors);
    expect(subjectToAdd("New", subjects, colors)!.color).toBe(SUBJECT_COLOR_PALETTE[subjects.length % SUBJECT_COLOR_PALETTE.length]);
  });
  it("allows a rename to a free name or a change of case, not to another subject's name", () => {
    expect(subjectRename("Math", " Maths ", ["Math", "Art"])).toBe("Maths");
    expect(subjectRename("Math", "MATH", ["Math", "Art"])).toBe("MATH");
    expect(subjectRename("Math", "art", ["Math", "Art"])).toBeNull();
    expect(subjectRename("Math", " ", ["Math"])).toBeNull();
  });
  it("carries a rename to the list, the colours, tasks, trash and templates", () => {
    expect(renamedSubjects(["Math", "Art"], "Math", "Maths")).toEqual(["Maths", "Art"]);
    expect(recolouredSubjects({ Math: "#111", Art: "#222" }, "Math", "Maths", "#333")).toEqual({ Art: "#222", Maths: "#333" });
    expect(withoutSubjectColor({ Math: "#111", Art: "#222" }, "Math")).toEqual({ Art: "#222" });
    expect(tasksRenamedSubject([task(1), task(2, { subject: "Art" })], "Math", "Maths").map(t => t.subject)).toEqual(["Maths", "Art"]);
    expect(trashRenamedSubject([{ task: task(1), deletedAt: 3 }], "Math", "Maths")[0]).toEqual({ task: { ...task(1), subject: "Maths" }, deletedAt: 3 });
    const tpl: TaskTemplate = { id: "t", name: "x", subject: "Math", estMins: 1 };
    expect(templatesRenamedSubject([tpl], "Math", "Maths")[0].subject).toBe("Maths");
  });
});
