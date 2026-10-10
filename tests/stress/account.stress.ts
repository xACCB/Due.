import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { collection, doc, getDoc, getDocs, setDoc, writeBatch } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { addTaskWrite } from "../../src/lib/taskWrites";
import type { SyncRecord } from "../../src/lib/sync";
import { LIMITS } from "../../src/lib/limits";

// One account filled to the task cap, with the real rules (counter enforced)
// and the app's own write builder: how long it takes to write and to read
// back, that the counter is still exact at the end, and that the cap holds
// (one more is refused; deleting one makes room again).
// STRESS_TASKS overrides the size for a quicker run; the cap checks only run
// at the full size.
const N = Number(process.env.STRESS_TASKS || LIMITS.tasks);
const PARALLEL = 20; // writes in flight at once, like a burst of edits syncing

type Task = { id: number; title: string; subject: string; dueDate: string; dueTime: string; estMins: number; done: boolean; order: number; tags: string[] };
const task = (id: number): Task => ({ id, title: `Task number ${id} with a realistic title length`, subject: ["Math", "English", "Science"][id % 3], dueDate: "2026-10-10", dueTime: "", estMins: 30, done: id % 4 === 0, order: id, tags: ["a", "b"] });
const live = (id: number): SyncRecord<Task> => ({ task: task(id) });

// Timings go to coverage/stress.txt as well as the console (vitest only shows
// console output for failing tests).
const report = (line: string) => { mkdirSync("coverage", { recursive: true }); appendFileSync("coverage/stress.txt", `${new Date().toISOString()}  ${line}\n`); console.log(line); };

let env: RulesTestEnvironment;
let db: Firestore;
const refs = (id: number) => ({ task: doc(db, `users/alice/tasks/${id}`), trash: doc(db, `users/alice/trash/${id}`), counts: doc(db, "users/alice/meta/counts") });
const create = (id: number) => { const b = writeBatch(db); addTaskWrite(b, refs(id), id, live(id), undefined, Date.now(), true); return b.commit(); };
const remove = (id: number) => { const b = writeBatch(db); addTaskWrite(b, refs(id), id, undefined, live(id), Date.now(), true); return b.commit(); };

beforeAll(async () => {
  env = await initializeTestEnvironment({ projectId: "dueplanner-stress", firestore: { rules: readFileSync("firestore.rules", "utf8") } });
  await env.clearFirestore();
  db = env.authenticatedContext("alice").firestore();
  await assertSucceeds(setDoc(doc(db, "users/alice/meta/counts"), { n: 0, t: 0, last: "" }));
});
afterAll(async () => { await env.cleanup(); });

describe(`an account with ${N.toLocaleString()} tasks`, () => {
  it("fills up through counted writes, and the counter stays exact", async () => {
    const started = Date.now();
    for (let i = 1; i <= N; i += PARALLEL) {
      await Promise.all(Array.from({ length: Math.min(PARALLEL, N - i + 1) }, (_, k) => create(i + k)));
    }
    const secs = (Date.now() - started) / 1000;
    report(`wrote ${N} tasks in ${secs.toFixed(1)}s (${Math.round(N / secs)} tasks/s)`);
    expect((await getDoc(doc(db, "users/alice/meta/counts"))).data()).toMatchObject({ n: N, t: 0 });
  });

  it("reads the whole list back (what a new device does at sign-in)", async () => {
    const started = Date.now();
    const snap = await getDocs(collection(db, "users/alice/tasks"));
    const ms = Date.now() - started;
    const bytes = snap.docs.reduce((n, d) => n + JSON.stringify(d.data()).length, 0);
    report(`read ${snap.size} tasks in ${ms}ms, about ${(bytes / 1024).toFixed(0)} KB of task data`);
    expect(snap.size).toBe(N);
  });

  it.runIf(N === LIMITS.tasks)("refuses one more than the cap, and accepts it again after a delete", async () => {
    await assertFails(create(N + 1));
    await assertSucceeds(remove(1));
    await assertSucceeds(create(N + 1));
    expect((await getDoc(doc(db, "users/alice/meta/counts"))).data()).toMatchObject({ n: N, t: 0 });
  });
});
