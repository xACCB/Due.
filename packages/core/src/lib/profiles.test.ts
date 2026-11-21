import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { LIMITS } from "./limits";
import { currentProfile, inProfile, newTasksJoin, presetsLeft, profileCount, profileFor, profileToAdd, withoutProfile } from "./profiles";

const task = (id: number, profile?: string): Task => ({
  id, title: `T${id}`, subject: "", dueDate: "", dueTime: "", estMins: 0, done: false, order: id, ...(profile ? { profile } : {}),
});

describe("profileToAdd", () => {
  it("trims the name and keeps it on one line", () => {
    expect(profileToAdd("  Band\npractice ", [])).toBe("Band practice");
  });
  it("refuses an empty name or one already there, ignoring case", () => {
    expect(profileToAdd("   ", [])).toBeNull();
    expect(profileToAdd("homework", ["Homework"])).toBeNull();
  });
  it("stops at the limit", () => {
    const full = Array.from({ length: LIMITS.profiles }, (_, i) => `P${i}`);
    expect(profileToAdd("One more", full)).toBeNull();
    expect(profileToAdd("One more", full.slice(1))).toBe("One more");
  });
  it("shortens a long name to the limit", () => {
    expect(profileToAdd("x".repeat(LIMITS.profileName + 10), [])).toHaveLength(LIMITS.profileName);
  });
});

describe("presetsLeft", () => {
  it("offers the presets not added yet", () => {
    expect(presetsLeft([])).toEqual(["Homework", "Sports"]);
    expect(presetsLeft(["sports"])).toEqual(["Homework"]);
    expect(presetsLeft(["Homework", "Sports", "Coding"])).toEqual([]);
  });
});

describe("currentProfile", () => {
  it("is the saved name while it's in the list, else All (null)", () => {
    expect(currentProfile("Sports", ["Homework", "Sports"])).toBe("Sports");
    expect(currentProfile("Sports", ["Homework"])).toBeNull();
    expect(currentProfile(null, ["Homework"])).toBeNull();
    expect(currentProfile(3, ["Homework"])).toBeNull();
  });
});

describe("inProfile and profileFor", () => {
  it("All shows every task; a profile only its own", () => {
    expect(inProfile(task(1), null)).toBe(true);
    expect(inProfile(task(1, "Sports"), null)).toBe(true);
    expect(inProfile(task(1, "Sports"), "Sports")).toBe(true);
    expect(inProfile(task(1, "Sports"), "Homework")).toBe(false);
    expect(inProfile(task(1), "Homework")).toBe(false);
  });
  it("gives a new task the profile showing, or none under All", () => {
    expect(profileFor("Sports")).toEqual({ profile: "Sports" });
    expect(profileFor(null)).toEqual({});
  });
});

describe("withoutProfile and profileCount", () => {
  it("keeps a deleted profile's tasks, without the profile", () => {
    const tasks = [task(1, "Sports"), task(2, "Homework"), task(3)];
    const after = withoutProfile(tasks, "Sports");
    expect(after.map(t => t.id)).toEqual([1, 2, 3]);
    expect("profile" in after[0]).toBe(false);
    expect(after[1]).toBe(tasks[1]); // untouched tasks are the same objects
    expect(after[2]).toBe(tasks[2]);
  });
  it("counts a profile's tasks", () => {
    expect(profileCount([task(1, "Sports"), task(2, "Sports"), task(3)], "Sports")).toBe(2);
  });
});

describe("newTasksJoin", () => {
  it("gives only the newly added tasks the profile showing", () => {
    const prev = [task(1)];
    const next = [...prev, task(2), task(3)];
    const out = newTasksJoin(prev, next, "Homework");
    expect(out[0]).toBe(prev[0]);
    expect(out.slice(1).map(t => t.profile)).toEqual(["Homework", "Homework"]);
    expect(newTasksJoin(prev, next, null)).toBe(next);
  });
});
