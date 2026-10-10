import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { dailySummary, offsetReminders } from "./reminders";

const task = (id: number, extra: Partial<Task> = {}): Task =>
  ({ id, title: `Task ${id}`, subject: "", dueDate: "", dueTime: "", estMins: 0, done: false, order: id, ...extra });
const at = (y: number, mo: number, d: number, h: number, mi: number) => new Date(y, mo - 1, d, h, mi).getTime();
const today = "2026-10-10";

describe("dailySummary", () => {
  it("is silent when nothing is due", () => {
    expect(dailySummary([task(1, { dueDate: "2026-10-11" }), task(2), task(3, { dueDate: today, done: true }), task(4, { dueDate: today, archived: true })], today, ["0"])).toBeNull();
  });
  it("names a single task, or counts several and lists the first three", () => {
    expect(dailySummary([task(1, { title: "Essay", dueDate: today })], today, ["0"])).toEqual({ title: `"Essay" is due`, body: "Essay" });
    const many = [1, 2, 3, 4].map(i => task(i, { dueDate: "2026-10-09" }));
    expect(dailySummary(many, today, ["0"])).toEqual({ title: "4 tasks due or overdue", body: "Task 1, Task 2, Task 3" });
  });
  it("leaves tasks due today at a time to the offset reminders, unless those are all off or the task is overdue", () => {
    const timed = task(1, { dueDate: today, dueTime: "15:00" });
    expect(dailySummary([timed], today, ["1h"])).toBeNull();
    expect(dailySummary([timed], today, [])).not.toBeNull();
    expect(dailySummary([task(1, { dueDate: "2026-10-09", dueTime: "15:00" })], today, ["1h"])).not.toBeNull();
  });
});

describe("offsetReminders", () => {
  const due3pm = task(1, { title: "Lab", dueDate: today, dueTime: "15:00" });

  it("sends nothing before the first enabled reminder time", () => {
    const r = offsetReminders([due3pm], ["1h"], {}, at(2026, 10, 10, 13, 59), false);
    expect(r).toEqual({ notes: [], sent: {}, changed: false });
  });
  it("sends the reminder once its time arrives, and records it", () => {
    const r = offsetReminders([due3pm], ["1h"], {}, at(2026, 10, 10, 14, 0), false);
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0].title).toBe(`"Lab" is due in 1h`);
    expect(r.sent).toEqual({ "1-1h-2026-10-10T15:00": true });
    expect(r.changed).toBe(true);
  });
  it("doesn't send the same reminder twice", () => {
    const r = offsetReminders([due3pm], ["1h"], { "1-1h-2026-10-10T15:00": true }, at(2026, 10, 10, 14, 30), false);
    expect(r.notes).toEqual([]);
    expect(r.changed).toBe(false);
  });
  it("opening late sends only the closest reminder and marks the earlier ones sent", () => {
    const r = offsetReminders([due3pm], ["1d", "3h", "1h"], {}, at(2026, 10, 10, 14, 30), false);
    expect(r.notes.map(n => n.title)).toEqual([`"Lab" is due in 30 min`]);
    expect(Object.keys(r.sent).sort()).toEqual(["1-1d-2026-10-10T15:00", "1-1h-2026-10-10T15:00", "1-3h-2026-10-10T15:00"]);
  });
  it("\"at due time\" has a 15 minute grace window; the others stop at the due time", () => {
    expect(offsetReminders([due3pm], ["0"], {}, at(2026, 10, 10, 15, 10), false).notes.map(n => n.title)).toEqual([`"Lab" is due now`]);
    expect(offsetReminders([due3pm], ["0"], {}, at(2026, 10, 10, 15, 15), false).notes).toEqual([]);
    expect(offsetReminders([due3pm], ["1h"], {}, at(2026, 10, 10, 15, 1), false).notes).toEqual([]);
  });
  it("words the time left in minutes, hours or days", () => {
    const week = offsetReminders([task(1, { title: "Big", dueDate: "2026-10-16", dueTime: "09:00" })], ["1w"], {}, at(2026, 10, 10, 9, 0), false);
    expect(week.notes[0].title).toBe(`"Big" is due in 6 days`);
    const hours = offsetReminders([due3pm], ["3h"], {}, at(2026, 10, 10, 12, 30), false);
    expect(hours.notes[0].title).toBe(`"Lab" is due in 2h 30m`);
  });
  it("skips finished, archived, undated and untimed tasks", () => {
    const r = offsetReminders([{ ...due3pm, done: true }, { ...due3pm, id: 2, archived: true }, task(3, { dueDate: today }), task(4)], ["0", "1h"], {}, at(2026, 10, 10, 14, 30), false);
    expect(r.notes).toEqual([]);
  });
  it("rescheduling makes reminders owed again and drops the old records", () => {
    const moved = { ...due3pm, dueTime: "18:00" };
    const r = offsetReminders([moved], ["1h"], { "1-1h-2026-10-10T15:00": true }, at(2026, 10, 10, 17, 30), false);
    expect(r.notes).toHaveLength(1);
    expect(r.sent).toEqual({ "1-1h-2026-10-10T18:00": true });
  });
  it("drops records for tasks that are gone or finished, and doesn't change the record it was given", () => {
    const given = { "9-1h-2026-10-01T10:00": true as const, "1-1h-2026-10-10T15:00": true as const };
    const r = offsetReminders([{ ...due3pm, done: true }], ["1h"], given, at(2026, 10, 10, 14, 30), false);
    expect(r.sent).toEqual({});
    expect(r.changed).toBe(true);
    expect(Object.keys(given)).toHaveLength(2);
  });
  it("shows the due time in the chosen clock format", () => {
    const base = offsetReminders([due3pm], ["1h"], {}, at(2026, 10, 10, 14, 30), true).notes[0].body;
    expect(base).toContain("15:00");
    expect(offsetReminders([due3pm], ["1h"], {}, at(2026, 10, 10, 14, 30), false).notes[0].body).toContain("3:00");
  });
});
