import { describe, expect, it } from "vitest";
import { dueShort, subjectGroups } from "./sidebarSubjects";

const task = (id: number, subject: string, dueDate = "", extra: Partial<{ dueTime: string; order: number; done: boolean; archived: boolean }> = {}) =>
  ({ id, subject, dueDate, order: id, done: false, ...extra });

describe("subjectGroups", () => {
  it("lists subjects in the user's order, even ones with nothing open", () => {
    const groups = subjectGroups([task(1, "Math")], ["English", "Math"]);
    expect(groups.map(g => g.name)).toEqual(["English", "Math"]);
    expect(groups[0].tasks).toEqual([]);
    expect(groups[1].tasks.map(t => t.id)).toEqual([1]);
  });

  it("leaves out done and archived tasks", () => {
    const groups = subjectGroups([task(1, "Math", "", { done: true }), task(2, "Math", "", { archived: true }), task(3, "Math")], ["Math"]);
    expect(groups[0].tasks.map(t => t.id)).toEqual([3]);
  });

  it("sorts most urgent first: date, then time, then manual order, undated last", () => {
    const groups = subjectGroups([
      task(1, "Math"),
      task(2, "Math", "2026-10-12"),
      task(3, "Math", "2026-10-11", { dueTime: "15:00" }),
      task(4, "Math", "2026-10-11", { dueTime: "09:00" }),
      task(5, "Math", "2026-10-11"),
      task(6, "Math", "2026-10-12", { order: 0 }),
    ], ["Math"]);
    expect(groups[0].tasks.map(t => t.id)).toEqual([4, 3, 5, 6, 2, 1]);
  });

  it("adds subjects that only exist on tasks, then tasks with no subject last", () => {
    const groups = subjectGroups([task(1, ""), task(2, "Art"), task(3, "Math")], ["Math"]);
    expect(groups.map(g => g.name)).toEqual(["Math", "Art", ""]);
    expect(groups[2].tasks.map(t => t.id)).toEqual([1]);
  });

  it("has no empty-name group when every task has a subject", () => {
    expect(subjectGroups([task(1, "Math")], ["Math"]).map(g => g.name)).toEqual(["Math"]);
  });
});

describe("dueShort", () => {
  const today = "2026-10-10";
  it("names the near days", () => {
    expect(dueShort("", today)).toBe("");
    expect(dueShort("2026-10-09", today)).toBe("Overdue");
    expect(dueShort("2026-10-10", today)).toBe("Today");
    expect(dueShort("2026-10-11", today)).toBe("Tomorrow");
  });
  it("falls back to the date", () => {
    expect(dueShort("2026-10-14", today)).toMatch(/14/);
  });
});
