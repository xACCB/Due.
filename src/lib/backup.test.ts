import { describe, expect, it } from "vitest";
import type { Task, TaskTemplate } from "../types";
import { LIMITS } from "./limits";
import { readBackup, tasksCsv, withImportedColors, withImportedSubjects, withImportedTemplates, withSyllabusTasks } from "./backup";

const task = (id: number, extra: Partial<Task> = {}): Task =>
  ({ id, title: `Task ${id}`, subject: "Math", dueDate: "", dueTime: "", estMins: 30, done: false, order: id, ...extra });

describe("tasksCsv", () => {
  it("has a header row and one quoted-where-needed row per task", () => {
    const csv = tasksCsv([task(1, { title: "Read, then write", dueDate: "2026-10-10", dueTime: "09:00", tags: ["a", "b"], recurrence: "weekly", done: true, priorityOverride: "low" })]);
    const [header, row] = csv.split("\n");
    expect(header).toBe("title,subject,dueDate,dueTime,estMins,done,priority,tags,recurrence");
    expect(row).toBe(`"Read, then write",Math,2026-10-10,09:00,30,yes,low,a; b,weekly`);
  });
  it("is just the header for no tasks, and says \"none\" for a task that doesn't repeat", () => {
    expect(tasksCsv([])).toBe("title,subject,dueDate,dueTime,estMins,done,priority,tags,recurrence");
    expect(tasksCsv([task(1)]).split("\n")[1].endsWith(",none")).toBe(true);
  });
});

describe("readBackup", () => {
  it("rejects a file that has neither tasks nor subjects", () => {
    expect(readBackup({}, [], [])).toBeNull();
    expect(readBackup({ tasks: "nope" }, [], [])).toBeNull();
    expect(readBackup(null, [], [])).toBeNull();
    expect(readBackup({ tasks: [{ title: "no id" }, null, 3] }, [], [])).toBeNull();
  });
  it("takes tasks that aren't here yet, after the existing ones, and counts the rest as skipped", () => {
    const read = readBackup({ tasks: [task(1, { title: "Old copy" }), task(7), task(8)] }, [task(1, { order: 4 })], [])!;
    expect(read.fresh.map(t => [t.id, t.order])).toEqual([[7, 5], [8, 6]]);
    expect(read.skipped).toBe(1);
  });
  it("cleans imported tasks up to the limits", () => {
    const read = readBackup({ tasks: [{ ...task(5), title: "x".repeat(900), dueDate: "next friday", estMins: -4 }] }, [], [])!;
    expect(read.fresh[0].title).toHaveLength(LIMITS.title);
    expect(read.fresh[0]).toMatchObject({ dueDate: "", estMins: 0 });
  });
  it("lists subjects that aren't here (any case), or null when the file has none", () => {
    expect(readBackup({ subjects: ["math", "Music", 7] }, [], ["Math"])!.extraSubjects).toEqual(["Music"]);
    expect(readBackup({ tasks: [task(1)] }, [], [])!.extraSubjects).toBeNull();
  });
  it("passes on string colours only, and templates as found", () => {
    const read = readBackup({ subjects: [], subjectColors: { Music: "#123456", Bad: 5 }, templates: [{ id: "t", name: "n" }] }, [], [])!;
    expect(read.colors).toEqual({ Music: "#123456" });
    expect(read.templates).toHaveLength(1);
    expect(readBackup({ subjects: [] }, [], [])).toMatchObject({ colors: null, templates: null, fresh: [], skipped: 0 });
  });
});

describe("merging a backup's subjects, colours and templates", () => {
  it("adds subjects at the end, trimmed and capped", () => {
    expect(withImportedSubjects(["Math"], ["Music", "y".repeat(500)])).toEqual(["Math", "Music", "y".repeat(LIMITS.subject)]);
    const full = Array.from({ length: LIMITS.subjects }, (_, i) => `S${i}`);
    expect(withImportedSubjects(full, ["More"])).toHaveLength(LIMITS.subjects);
  });
  it("keeps existing colours and adds new ones", () => {
    expect(withImportedColors({ Math: "#111111" }, { Math: "#999999", Music: "#222222" })).toEqual({ Math: "#111111", Music: "#222222" });
  });
  it("adds templates that aren't here and ignores anything malformed", () => {
    const have: TaskTemplate[] = [{ id: "a", name: "A", subject: "", estMins: 0 }];
    const merged = withImportedTemplates(have, [{ id: "a", name: "dup" }, { id: "b", name: "B", subject: "", estMins: 5 }, { name: "no id" }, null, "x"]);
    expect(merged.map(t => t.id)).toEqual(["a", "b"]);
  });
});

describe("withSyllabusTasks", () => {
  it("adds one open task per item, in order, after the existing ones", () => {
    const after = withSyllabusTasks([task(1, { order: 9 })], [{ title: "Quiz", dueDate: "2026-10-12" }, { title: "Essay", dueDate: "2026-10-20" }], "English");
    expect(after).toHaveLength(3);
    expect(after.slice(1).map(t => [t.title, t.subject, t.dueDate, t.dueTime, t.estMins, t.done, t.order])).toEqual([
      ["Quiz", "English", "2026-10-12", "", 0, false, 10], ["Essay", "English", "2026-10-20", "", 0, false, 11]]);
    expect(new Set(after.map(t => t.id)).size).toBe(3);
  });
});
