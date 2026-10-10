import { afterAll, beforeAll, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, setDoc } from "firebase/firestore";

// Random-input testing of the task rules. Hundreds of tasks that are each
// broken in one to three ways must all be refused, and hundreds of randomly
// built valid ones must all be accepted. The generator is seeded, so a failure
// can be replayed: the message names the seed and the case.
const SEED = 20261010;
const BROKEN_CASES = 300, VALID_CASES = 150;

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "dueplanner-rules-fuzz",
    firestore: { rules: readFileSync("firestore.rules", "utf8").replace("function enforceTaskCap() { return true; }", "function enforceTaskCap() { return false; }") },
  });
});
afterAll(async () => { await env.cleanup(); });

// mulberry32: a small, well-known seeded random number generator.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const random = rng(SEED);
const int = (max: number) => Math.floor(random() * max);
const pick = <T,>(items: readonly T[]): T => items[int(items.length)];
const text = (len: number) => Array.from({ length: len }, () => "abcdefghij klmnop"[int(17)]).join("");
const list = <T,>(n: number, make: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => make(i));

type Doc = Record<string, unknown>;
// A random task that follows every rule: required fields, and a random
// selection of the optional ones with random allowed values.
function validTask(id: number): Doc {
  const t: Doc = {
    id, title: text(int(501)), subject: text(int(201)), dueDate: pick(["", "2026-10-10", "2027-01-31"]), dueTime: pick(["", "09:00", "23:59"]),
    estMins: int(100001), done: random() < 0.5, order: int(100000),
  };
  if (random() < 0.5) t.subtasks = list(int(101), i => ({ id: String(i), text: "s", done: random() < 0.5 }));
  if (random() < 0.5) t.tags = list(int(31), i => `t${i}`);
  if (random() < 0.3) t.sessions = list(int(40), i => ({ mins: 1 + int(90), at: i }));
  if (random() < 0.5) t.recurrence = pick(["none", "daily", "weekly", "monthly", null]);
  if (random() < 0.5) t.priorityOverride = pick(["high", "medium", "low", null]);
  if (random() < 0.5) t.archived = random() < 0.5;
  if (random() < 0.5) t.completedAt = pick([null, 1760000000000]);
  if (random() < 0.5) t.spawnedNextId = pick([null, 12345]);
  if (random() < 0.5) t.updatedAt = 1760000000000;
  return t;
}
// Ways to break a task. Every one of these, on its own, must be refused.
const breakers: [string, (t: Doc) => void][] = [
  ["no id", t => { delete t.id; }], ["no title", t => { delete t.title; }], ["no subject", t => { delete t.subject; }],
  ["no dueDate", t => { delete t.dueDate; }], ["no dueTime", t => { delete t.dueTime; }], ["no estMins", t => { delete t.estMins; }],
  ["no done", t => { delete t.done; }], ["no order", t => { delete t.order; }],
  ["id is text", t => { t.id = "1"; }], ["title is a number", t => { t.title = 5; }], ["title too long", t => { t.title = text(501 + int(50)); }],
  ["subject is a list", t => { t.subject = ["Math"]; }], ["subject too long", t => { t.subject = text(201 + int(50)); }],
  ["dueDate too long", t => { t.dueDate = "2026-10-10T00"; }], ["dueDate is a number", t => { t.dueDate = 20261010; }],
  ["dueTime too long", t => { t.dueTime = "09:00:00"; }], ["dueTime is null", t => { t.dueTime = null; }],
  ["estMins negative", t => { t.estMins = -1 - int(100); }], ["estMins too big", t => { t.estMins = 100001 + int(1000); }], ["estMins is text", t => { t.estMins = "30"; }],
  ["done is text", t => { t.done = "yes"; }], ["order is text", t => { t.order = "3"; }],
  ["subtasks is text", t => { t.subtasks = "none"; }], ["too many subtasks", t => { t.subtasks = list(101 + int(5), i => ({ id: String(i), text: "s", done: false })); }],
  ["tags is a map", t => { t.tags = { a: true }; }], ["too many tags", t => { t.tags = list(31 + int(5), i => `t${i}`); }],
  ["too many sessions", t => { t.sessions = list(1001, i => ({ mins: 1, at: i })); }], ["sessions is a number", t => { t.sessions = 3; }],
  ["unknown repeat", t => { t.recurrence = pick(["yearly", "", 7, true]); }], ["unknown priority", t => { t.priorityOverride = pick(["urgent", "", 1, false]); }],
  ["archived is text", t => { t.archived = "no"; }], ["completedAt is text", t => { t.completedAt = "yesterday"; }],
  ["spawnedNextId is text", t => { t.spawnedNextId = "12"; }], ["updatedAt is text", t => { t.updatedAt = "now"; }],
  ["padded with extra fields", t => { for (let i = 0; i < 25; i++) t[`extra${i}`] = i; }],
];

describe(`random tasks against the rules (seed ${SEED})`, () => {
  it(`${VALID_CASES} random valid tasks are all accepted`, async () => {
    const db = env.authenticatedContext("alice").firestore();
    for (let i = 0; i < VALID_CASES; i++) {
      const t = validTask(i + 1);
      try { await assertSucceeds(setDoc(doc(db, `users/alice/tasks/${i + 1}`), t)); }
      catch (e) { throw new Error(`valid case ${i} (seed ${SEED}) was refused: ${JSON.stringify(t).slice(0, 400)}`, { cause: e }); }
    }
  }, 120000);

  it(`${BROKEN_CASES} random broken tasks are all refused`, async () => {
    const db = env.authenticatedContext("alice").firestore();
    for (let i = 0; i < BROKEN_CASES; i++) {
      const t = validTask(100000 + i);
      const applied: string[] = [];
      for (let k = 1 + int(3); k > 0; k--) { const [name, breakIt] = pick(breakers); breakIt(t); applied.push(name); }
      const where = random() < 0.2 ? "trash" : "tasks";
      if (where === "trash") t.deletedAt = 1;
      try { await assertFails(setDoc(doc(db, `users/alice/${where}/${100000 + i}`), t)); }
      catch (e) { throw new Error(`broken case ${i} (seed ${SEED}) was ACCEPTED in ${where}; broken by: ${applied.join(", ")}\n${JSON.stringify(t).slice(0, 400)}`, { cause: e }); }
    }
  }, 240000);
});
