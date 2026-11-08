import { describe, expect, it } from "vitest";
import { addTask, deleteTask, emptyStore, redo, toggleDone, undo, UNDO_MAX } from "./taskStore";

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
});
