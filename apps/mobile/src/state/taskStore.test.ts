import { describe, expect, it } from "vitest";
import { addTask, deleteTask, duplicateTask, editTask, emptyStore, logSession, quietPatch, redo, restoreTask, toggleDone, undo, UNDO_MAX } from "./taskStore";

describe("taskStore", () => {
  it("adds a trimmed one-line task and ignores a blank title", () => {
    const s = addTask(emptyStore(), "  Essay\ndraft ");
    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0]).toMatchObject({ title: "Essay draft", done: false, estMins: 0, dueDate: "" });
    expect(addTask(s, "   ")).toBe(s);
  });

  it("completes and undoes, then redoes", () => {
    const a = addTask(emptyStore(), "Read");
    const id = a.tasks[0].id;
    const done = toggleDone(a, id);
    expect(done.tasks[0].done).toBe(true);
    expect(done.tasks[0].completedAt).toBeTypeOf("number");
    const back = undo(done);
    expect(back.tasks[0].done).toBe(false);
    expect(redo(back).tasks[0].done).toBe(true);
  });

  it("moves a deleted task to Recently deleted, and undo brings it back", () => {
    const a = addTask(emptyStore(), "Lab report");
    const id = a.tasks[0].id;
    const gone = deleteTask(a, id);
    expect(gone.tasks).toEqual([]);
    expect(gone.trash.map(e => e.task.id)).toEqual([id]);
    const back = undo(gone);
    expect(back.tasks.map(t => t.id)).toEqual([id]);
    expect(back.trash).toEqual([]);
    const again = redo(back);
    expect(again.tasks).toEqual([]);
    expect(again.trash.map(e => e.task.id)).toEqual([id]);
  });

  it("a new action clears redo, and undo history is capped", () => {
    let s = addTask(emptyStore(), "One");
    s = undo(s);
    expect(s.redo).toHaveLength(1);
    s = addTask(s, "Two");
    expect(s.redo).toEqual([]);
    for (let i = 0; i < UNDO_MAX + 5; i++) s = addTask(s, `T${i}`);
    expect(s.undo).toHaveLength(UNDO_MAX);
  });

  it("undo with nothing to undo changes nothing", () => {
    const s = emptyStore();
    expect(undo(s)).toBe(s);
    expect(redo(s)).toBe(s);
  });

  it("completing a repeating task spawns the next one, and undo removes it", () => {
    let s = addTask(emptyStore(), "Vocab quiz");
    s = { ...s, tasks: s.tasks.map(t => ({ ...t, recurrence: "weekly" as const, dueDate: "2026-11-09" })) };
    const id = s.tasks[0].id;
    const done = toggleDone(s, id);
    expect(done.tasks).toHaveLength(2);
    expect(done.tasks[1]).toMatchObject({ done: false, dueDate: "2026-11-16" });
    expect(undo(done).tasks).toHaveLength(1);
  });

  it("adds a task from the add questions' answers", () => {
    const s = addTask(emptyStore(), { title: "Essay", subject: "English", dueDate: "2026-11-20", dueTime: "15:00", estMins: 45, recurrence: "weekly" });
    expect(s.tasks[0]).toMatchObject({ title: "Essay", subject: "English", dueDate: "2026-11-20", dueTime: "15:00", estMins: 45, recurrence: "weekly" });
    const none = addTask(emptyStore(), { title: "Read", subject: "", dueDate: "", dueTime: "09:00", estMins: 0, recurrence: "none" });
    expect(none.tasks[0].recurrence).toBeUndefined();
    expect(none.tasks[0].dueTime).toBe(""); // a time without a date means nothing
  });

  it("edits are undoable, and an edit that changes nothing adds no step", () => {
    const a = addTask(emptyStore(), "Read");
    const id = a.tasks[0].id;
    const e = editTask(a, id, { title: "Read ch. 4" });
    expect(e.tasks[0].title).toBe("Read ch. 4");
    expect(e.undo).toHaveLength(2);
    expect(undo(e).tasks[0].title).toBe("Read");
    expect(editTask(e, id, { title: "Read ch. 4" })).toBe(e);
    expect(editTask(e, 999, { title: "x" })).toBe(e);
  });

  it("quiet patches and logged sessions are not undo steps", () => {
    const a = addTask(emptyStore(), "Read");
    const id = a.tasks[0].id;
    const q = quietPatch(a, id, { tags: ["exam"] });
    expect(q.tasks[0].tags).toEqual(["exam"]);
    expect(q.undo).toBe(a.undo);
    const l = logSession(q, id, 25, 1000);
    expect(l.tasks[0].sessions).toEqual([{ mins: 25, at: 1000 }]);
    expect(l.undo).toBe(a.undo);
    expect(logSession(l, id, 0, 2000)).toBe(l);
  });

  it("duplicates a task as a fresh copy, undoably", () => {
    let s = addTask(emptyStore(), "Lab");
    const id = s.tasks[0].id;
    s = toggleDone(s, id);
    const d = duplicateTask(s, id);
    expect(d.tasks).toHaveLength(2);
    expect(d.tasks[1]).toMatchObject({ title: "Lab", done: false });
    expect(d.tasks[1].id).not.toBe(id);
    expect(undo(d).tasks).toHaveLength(1);
  });

  it("restores from Recently deleted", () => {
    let s = addTask(emptyStore(), "Quiz");
    const id = s.tasks[0].id;
    s = deleteTask(s, id);
    const r = restoreTask(s, id);
    expect(r.tasks.map(t => t.id)).toEqual([id]);
    expect(r.trash).toEqual([]);
    expect(restoreTask(r, id)).toBe(r);
  });
});

