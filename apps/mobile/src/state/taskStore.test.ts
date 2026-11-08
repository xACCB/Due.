import { describe, expect, it } from "vitest";
import { withSyllabusTasks } from "@dueplanner/core/lib/backup";
import { addTask, autoArchive, deleteTask, deleteTasks, emptyTrash, importTasks, moveTask, renameSubject, duplicateTask, editTask, emptyStore, logSession, quietPatch, redo, restoreTask, toggleDone, undo, UNDO_MAX } from "./taskStore";

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

  it("auto-archives tasks done before the cutoff, and leaves the rest alone", () => {
    const base = emptyStore([
      { id: 1, title: "Old", subject: "", dueDate: "", dueTime: "", estMins: 0, done: true, order: 0, completedAt: 1000 },
      { id: 2, title: "Recent", subject: "", dueDate: "", dueTime: "", estMins: 0, done: true, order: 1, completedAt: 5000 },
      { id: 3, title: "Open", subject: "", dueDate: "", dueTime: "", estMins: 0, done: false, order: 2 },
    ]);
    const s = autoArchive(base, 2000);
    expect(s.tasks.map(t => !!t.archived)).toEqual([true, false, false]);
    expect(s.undo).toEqual([]);
    expect(autoArchive(s, 2000)).toBe(s);
  });

  it("empties Recently deleted for good", () => {
    const a = addTask(emptyStore(), "Quiz");
    const gone = deleteTask(a, a.tasks[0].id);
    expect(emptyTrash(gone).trash).toEqual([]);
    const none = emptyStore();
    expect(emptyTrash(none)).toBe(none);
  });

  it("imports syllabus items as tasks, not as an undo step", () => {
    const a = addTask(emptyStore(), "Existing");
    const s = importTasks(a, withSyllabusTasks(a.tasks, [{ title: "Essay 1", dueDate: "2026-12-01" }], "English"));
    expect(s.tasks.map(t => [t.title, t.subject, t.dueDate])).toEqual([["Existing", "", ""], ["Essay 1", "English", "2026-12-01"]]);
    expect(s.undo).toEqual(a.undo);
  });

  it("deletes several tasks as one undo step", () => {
    let s = addTask(addTask(addTask(emptyStore(), "A"), "B"), "C");
    const [a, , c] = s.tasks.map(t => t.id);
    s = deleteTasks(s, [a, c]);
    expect(s.tasks.map(t => t.title)).toEqual(["B"]);
    expect(s.trash).toHaveLength(2);
    expect(undo(s).tasks.map(t => t.title).sort()).toEqual(["A", "B", "C"]);
  });

  it("moves an open task among the open tasks, not as an undo step", () => {
    const s = addTask(addTask(addTask(emptyStore(), "A"), "B"), "C");
    const a = s.tasks.find(t => t.title === "A")!.id;
    const moved = moveTask(s, a, 2);
    const order = [...moved.tasks].sort((x, y) => x.order - y.order).map(t => t.title);
    expect(order).toEqual(["B", "C", "A"]);
    expect(moved.undo).toEqual(s.undo);
    expect(moveTask(s, a, -1)).toBe(s); // already first
  });

  it("renames a subject on tasks and in Recently deleted", () => {
    let s = importTasks(emptyStore(), [
      { id: 1, title: "A", subject: "Maths", dueDate: "", dueTime: "", estMins: 0, done: false, order: 0 },
      { id: 2, title: "B", subject: "Maths", dueDate: "", dueTime: "", estMins: 0, done: false, order: 1 },
      { id: 3, title: "C", subject: "Art", dueDate: "", dueTime: "", estMins: 0, done: false, order: 2 },
    ]);
    s = deleteTask(s, 2);
    s = renameSubject(s, "Maths", "Math");
    expect(s.tasks.map(t => t.subject)).toEqual(["Math", "Art"]);
    expect(s.trash[0].task.subject).toBe("Math");
  });
});
