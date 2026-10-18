import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, isFromNewerApp, migrateProfile, migrateTask, migrateTasks, versionOf } from "./migrations";

const base = { id: 1, title: "Essay", subject: "", dueDate: "", dueTime: "", estMins: 0, done: false };

describe("versionOf", () => {
  it("reads a stored version, treating missing or malformed as 0", () => {
    expect(versionOf(1)).toBe(1);
    expect(versionOf(undefined)).toBe(0);
    expect(versionOf("1")).toBe(0);
    expect(versionOf(-1)).toBe(0);
    expect(versionOf(1.5)).toBe(0);
  });
});

describe("isFromNewerApp", () => {
  it("is true only above this app's version", () => {
    expect(isFromNewerApp(SCHEMA_VERSION)).toBe(false);
    expect(isFromNewerApp(undefined)).toBe(false);
    expect(isFromNewerApp(SCHEMA_VERSION + 1)).toBe(true);
  });
});

describe("migrateTask", () => {
  it("backfills order from the position for a task from before versions", () => {
    expect(migrateTasks([{ ...base }, { ...base, id: 2 }], undefined).map(t => t.order)).toEqual([0, 1]);
  });
  it("keeps an existing order", () => {
    expect(migrateTask({ ...base, order: 7 }, 0, 3).order).toBe(7);
  });
  it("leaves current data untouched", () => {
    const t = { ...base, order: 2 };
    expect(migrateTask(t, SCHEMA_VERSION)).toBe(t);
  });
  it("is safe to run again on data that is already current", () => {
    const once = migrateTask({ ...base }, 0, 4);
    expect(migrateTask(once as unknown as Record<string, unknown>, 0, 9)).toEqual(once);
  });
  it("leaves data from a newer app alone", () => {
    const t = { ...base, order: 1, future: true };
    expect(migrateTask(t, SCHEMA_VERSION + 5)).toBe(t);
  });
});

describe("migrateProfile", () => {
  it("returns the profile unchanged at version 1", () => {
    const p = { layout: "list" };
    expect(migrateProfile(p, 0)).toEqual(p);
  });
});
