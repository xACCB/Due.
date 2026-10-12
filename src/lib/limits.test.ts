import { describe, it, expect } from "vitest";
import { LIMITS, addSession, sanitizeTask, syncedChanges, syncedTask } from "./limits";

describe("addSession", () => {
  it("appends, keeping only the newest LIMITS.sessions", () => {
    expect(addSession(undefined, 1)).toEqual([1]);
    const full = Array.from({ length: LIMITS.sessions }, (_, i) => i);
    const next = addSession(full, -1);
    expect(next.length).toBe(LIMITS.sessions);
    expect(next[0]).toBe(1); // oldest dropped
    expect(next[next.length - 1]).toBe(-1);
  });
});

describe("sanitizeTask", () => {
  const base = { id: 1, title: "Essay", subject: "English", dueDate: "2026-09-22", dueTime: "09:00", estMins: 30, done: false, order: 0 };
  it("puts a tag with line breaks on one line", () => {
    expect(sanitizeTask({ ...base, tags: ["two\nlines", "win\r\ndows"] }).tags).toEqual(["two lines", "win dows"]);
  });
  it("keeps tags that are text, each trimmed to the tag length", () => {
    const out = sanitizeTask({ ...base, tags: ["ok", "x".repeat(500), 7, null] as unknown as string[] });
    expect(out.tags).toEqual(["ok", "x".repeat(LIMITS.tag)]);
  });
  it("leaves a normal task alone", () => {
    expect(sanitizeTask(base)).toEqual(base);
  });
  it("trims long strings and clamps numbers", () => {
    const out = sanitizeTask({ ...base, title: "x".repeat(900), subject: "y".repeat(300), estMins: -5 });
    expect(out.title.length).toBe(LIMITS.title);
    expect(out.subject.length).toBe(LIMITS.subject);
    expect(out.estMins).toBe(0);
    expect(sanitizeTask({ ...base, estMins: 1e9 }).estMins).toBe(LIMITS.estMins);
  });
  it("drops malformed dates and times (and a time without a date)", () => {
    expect(sanitizeTask({ ...base, dueDate: "next friday" })).toMatchObject({ dueDate: "", dueTime: "" });
    expect(sanitizeTask({ ...base, dueTime: "9am" }).dueTime).toBe("");
  });
  it("cuts lists to size, keeping the newest sessions", () => {
    const out = sanitizeTask({ ...base,
      subtasks: Array.from({ length: 150 }, (_, i) => ({ id: String(i), text: "s", done: false })),
      tags: Array.from({ length: 50 }, (_, i) => `t${i}`),
      sessions: Array.from({ length: 1200 }, (_, i) => ({ mins: 1, at: i })) });
    expect(out.subtasks.length).toBe(LIMITS.subtasks);
    expect(out.tags.length).toBe(LIMITS.tags);
    expect(out.sessions.length).toBe(LIMITS.sessions);
    expect(out.sessions[out.sessions.length - 1].at).toBe(1199);
  });
  it("removes unknown enum values and non-list lists", () => {
    const out = sanitizeTask({ ...base, recurrence: "hourly", priorityOverride: "urgent", tags: "a,b" } as Record<string, unknown>);
    expect(out).not.toHaveProperty("recurrence");
    expect(out).not.toHaveProperty("priorityOverride");
    expect(out).not.toHaveProperty("tags");
    expect(sanitizeTask({ ...base, recurrence: "weekly", priorityOverride: "high" })).toMatchObject({ recurrence: "weekly", priorityOverride: "high" });
  });
});

describe("syncedTask", () => {
  const base = { id: 1, title: "Essay", subject: "English", dueDate: "2026-09-22", dueTime: "09:00", estMins: 30, done: false, order: 0 };
  it("sends a task whole", () => {
    const full = { ...base, subtasks: [{ id: "a", text: "x", done: false }], recurrence: "weekly", archived: false, completedAt: null,
      tags: ["exam"], priorityOverride: "high", sessions: [{ mins: 25, at: 1 }], spawnedNextId: null };
    expect(syncedTask(full)).toEqual(full);
  });
  it("leaves out a field the rules don't know", () => {
    expect(syncedTask({ ...base, notes: "from the first version", junk: 1 })).toEqual(base);
  });
});

describe("syncedChanges", () => {
  const gone = Symbol("deleteField");
  it("keeps changes to known fields and removals of anything", () => {
    expect(syncedChanges({ title: "New", tags: gone, notes: gone }, gone)).toEqual({ title: "New", tags: gone, notes: gone });
  });
  it("drops a new value for a field the rules don't know", () => {
    expect(syncedChanges({ title: "New", notes: "changed" }, gone)).toEqual({ title: "New" });
  });
});
