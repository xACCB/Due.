import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, setDoc } from "firebase/firestore";
import { LIMITS, sanitizeTask } from "../src/lib/limits";

// The contract between the app and the rules, checked by behaviour: anything
// the app can write at its limits (src/lib/limits.ts) is accepted, and one
// step over each limit is refused. The numbers come from LIMITS, not typed in
// here, so this fails if the app's limits and the rules' ever disagree.
// (src/lib/limits.rules.test.ts checks the same numbers by reading the file.)
let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "dueplanner-rules-contract",
    // Counter requirement off: these are single-document writes about shape and
    // size. The counter is covered in firestore.counter.test.ts.
    firestore: { rules: readFileSync("firestore.rules", "utf8").replace("function enforceTaskCap() { return true; }", "function enforceTaskCap() { return false; }") },
  });
});
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const list = <T,>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));
const db = () => env.authenticatedContext("alice").firestore();

// A task using every field the app writes, each at its maximum.
const fullTask = () => ({
  id: 1, title: "t".repeat(LIMITS.title), subject: "s".repeat(LIMITS.subject), dueDate: "2026-10-10", dueTime: "23:59",
  estMins: LIMITS.estMins, done: true, order: 123456,
  subtasks: list(LIMITS.subtasks, i => ({ id: String(i), text: "x", done: false })),
  tags: list(LIMITS.tags, i => `tag${i}`),
  sessions: list(LIMITS.sessions, i => ({ mins: 1, at: i })),
  recurrence: "weekly", priorityOverride: "high", archived: true, completedAt: 1760000000000, spawnedNextId: 2, updatedAt: 1760000000000,
});

describe("everything the app writes, at its limits, is accepted", () => {
  it("a task with every field at its maximum", async () => {
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/1"), fullTask()));
  });
  it("the same task in Recently deleted", async () => {
    await assertSucceeds(setDoc(doc(db(), "users/alice/trash/1"), { ...fullTask(), deletedAt: 1760000000000 }));
  });
  it("a task with only the required fields, and with cleared optional ones", async () => {
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/1"), { id: 1, title: "", subject: "", dueDate: "", dueTime: "", estMins: 0, done: false, order: 0 }));
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/2"), { id: 2, title: "a", subject: "", dueDate: "", dueTime: "", estMins: 0, done: false, order: 0,
      recurrence: "none", priorityOverride: null, completedAt: null, spawnedNextId: null, archived: false, subtasks: [], tags: [], sessions: [] }));
  });
  it("every repeat and priority value the app offers", async () => {
    let n = 0;
    for (const recurrence of ["none", "daily", "weekly", "monthly"]) for (const priorityOverride of ["high", "medium", "low"]) {
      n++;
      await assertSucceeds(setDoc(doc(db(), `users/alice/tasks/${n}`), { ...fullTask(), id: n, sessions: [], subtasks: [], recurrence, priorityOverride }));
    }
  });
  it("whatever sanitizeTask() lets through (an imported backup, however malformed)", async () => {
    const wild = { id: 7, title: "x".repeat(5000), subject: "y".repeat(5000), dueDate: "not a date", dueTime: "25:99pm", estMins: 1e12, done: "yes", order: 3,
      subtasks: list(500, i => ({ id: String(i), text: "s", done: false })), tags: list(500, i => `t${i}`), sessions: list(5000, i => ({ mins: 1, at: i })),
      recurrence: "yearly", priorityOverride: "urgent" };
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/7"), sanitizeTask(wild as unknown as Record<string, unknown>)));
  });
  it("a profile with the most subjects and colours", async () => {
    await assertSucceeds(setDoc(doc(db(), "users/alice"), {
      layout: "checklist", colorCodeUrgency: false, timeFormat: "24h", weekStart: 1,
      subjects: list(LIMITS.subjects, i => `S${i}`), subjectColors: Object.fromEntries(list(LIMITS.subjects, i => [`S${i}`, "#000000"])),
    }));
  });
  it("a device list with the most devices", async () => {
    await assertSucceeds(setDoc(doc(db(), "users/alice/meta/devices"), { d: Object.fromEntries(list(LIMITS.devices, i => [String(i).padStart(24, "0"), { name: "Chrome on Windows", createdAt: 1, lastSeen: 2 }])) }));
  });
});

describe("one step over each limit is refused", () => {
  const over: [string, Record<string, unknown>][] = [
    ["title", { title: "t".repeat(LIMITS.title + 1) }],
    ["subject", { subject: "s".repeat(LIMITS.subject + 1) }],
    ["estimate", { estMins: LIMITS.estMins + 1 }],
    ["subtasks", { subtasks: list(LIMITS.subtasks + 1, i => ({ id: String(i), text: "x", done: false })) }],
    ["tags", { tags: list(LIMITS.tags + 1, i => `tag${i}`) }],
    ["sessions", { sessions: list(LIMITS.sessions + 1, i => ({ mins: 1, at: i })) }],
  ];
  for (const [what, patch] of over) {
    it(`a task's ${what}`, async () => {
      const base = { ...fullTask(), sessions: [], subtasks: [] };
      await assertFails(setDoc(doc(db(), "users/alice/tasks/1"), { ...base, ...patch }));
      await assertFails(setDoc(doc(db(), "users/alice/trash/1"), { ...base, ...patch, deletedAt: 1 }));
    });
  }
  it("subjects and subject colours", async () => {
    await assertFails(setDoc(doc(db(), "users/alice"), { subjects: list(LIMITS.subjects + 1, i => `S${i}`) }));
    await assertFails(setDoc(doc(db(), "users/alice"), { subjectColors: Object.fromEntries(list(LIMITS.subjects + 1, i => [`S${i}`, "#000000"])) }));
  });
  it("devices", async () => {
    await assertFails(setDoc(doc(db(), "users/alice/meta/devices"), { d: Object.fromEntries(list(LIMITS.devices + 1, i => [String(i).padStart(24, "0"), { name: "x", createdAt: 1, lastSeen: 2 }])) }));
  });
});
