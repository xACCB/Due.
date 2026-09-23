import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { deleteDoc, doc, getDoc, setDoc, updateDoc, writeBatch, increment } from "firebase/firestore";
import type { Firestore } from "firebase/firestore";
import { addTaskWrite, addTaskWriteFromActual } from "../src/lib/taskWrites";
import type { SyncRecord } from "../src/lib/sync";

// The task counter (users/{uid}/meta/counts) against the real rules, using the
// same batch builder the app uses. Runs once with the counter requirement off
// (phase A) and once with it on (phase B, deployed since 2026-09-22).
type Task = { id:number; title:string; subject:string; dueDate:string; dueTime:string; estMins:number; done:boolean; order:number };
const task = (id:number):Task => ({ id, title:`Task ${id}`, subject:"", dueDate:"", dueTime:"", estMins:0, done:false, order:id });
const live = (id:number):SyncRecord<Task> => ({ task:task(id) });
const trashed = (id:number):SyncRecord<Task> => ({ task:task(id), deletedAt:1 });

// Both phases, whichever one firestore.rules is currently set to.
const rulesFile = readFileSync("firestore.rules", "utf8");
const OFF = "function enforceTaskCap() { return false; }", ON = "function enforceTaskCap() { return true; }";
if (!rulesFile.includes(OFF) && !rulesFile.includes(ON)) throw new Error("enforceTaskCap() toggle not found in firestore.rules");
const baseRules = rulesFile.replace(ON, OFF);
const enforcedRules = rulesFile.replace(OFF, ON);

for (const [phase, rules] of [["cap off (phase A)", baseRules], ["cap on (phase B)", enforcedRules]] as const) {
  const enforced = rules === enforcedRules;
  describe(`task counter -- ${phase}`, () => {
    let env: RulesTestEnvironment;
    let db: Firestore;
    const refs = (id:number) => ({ task:doc(db, `users/alice/tasks/${id}`), trash:doc(db, `users/alice/trash/${id}`), counts:doc(db, "users/alice/meta/counts") });
    const write = (id:number, L:SyncRecord<Task>|undefined, B:SyncRecord<Task>|undefined, counted = true) => {
      const b = writeBatch(db); addTaskWrite(b, refs(id), id, L, B, 5, counted); return b.commit();
    };
    const counts = async () => (await getDoc(doc(db, "users/alice/meta/counts"))).data();
    const seedCounts = (n:number, t:number) => env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "users/alice/meta/counts"), { n, t, last:"" }));

    beforeAll(async () => {
      env = await initializeTestEnvironment({ projectId:`dueplanner-counter-${enforced ? "b" : "a"}`, firestore:{ rules } });
    });
    afterAll(async () => { await env.cleanup(); });
    beforeEach(async () => {
      await env.clearFirestore();
      db = env.authenticatedContext("alice").firestore();
      await assertSucceeds(setDoc(doc(db, "users/alice/meta/counts"), { n:0, t:0, last:"" }));
    });

    it("counts a task through its whole life: create, edit, trash, restore, trash, empty", async () => {
      await assertSucceeds(write(1, live(1), undefined));
      expect(await counts()).toMatchObject({ n:1, t:0 });
      await assertSucceeds(write(1, { task:{ ...task(1), title:"Edited" } }, live(1)));
      expect(await counts()).toMatchObject({ n:1, t:0 });
      await assertSucceeds(write(1, trashed(1), live(1)));
      expect(await counts()).toMatchObject({ n:0, t:1 });
      await assertSucceeds(write(1, live(1), trashed(1)));
      expect(await counts()).toMatchObject({ n:1, t:0 });
      await assertSucceeds(write(1, trashed(1), live(1)));
      await assertSucceeds(write(1, undefined, trashed(1)));
      expect(await counts()).toMatchObject({ n:0, t:0 });
    });

    it("rejects a count that doesn't match what actually changed", async () => {
      await assertSucceeds(write(1, live(1), undefined));
      // Claims a new task while writing to one that already exists.
      await assertFails(write(1, live(1), undefined));
      // Bumps the count with no task at all.
      await assertFails(updateDoc(doc(db, "users/alice/meta/counts"), { n:increment(1), last:"99" }));
      // Lowers the count without deleting anything.
      await assertFails(updateDoc(doc(db, "users/alice/meta/counts"), { n:increment(-1), last:"1" }));
    });

    it("recovers from a stale view by writing from what actually exists", async () => {
      await assertSucceeds(write(1, live(1), undefined));
      // Another device moved it to the trash; this one still thinks it's live and edits it.
      await env.withSecurityRulesDisabled(async c => {
        const o = c.firestore();
        await deleteDoc(doc(o, "users/alice/tasks/1"));
        await setDoc(doc(o, "users/alice/trash/1"), { ...task(1), deletedAt:1, updatedAt:1 });
        await updateDoc(doc(o, "users/alice/meta/counts"), { n:0, t:1 });
      });
      const edit = { task:{ ...task(1), title:"Edited here" } };
      await assertFails(write(1, edit, live(1))); // stale: merge-creates a task doc without counting it... or miscounts
      const b = writeBatch(db);
      addTaskWriteFromActual(b, refs(1), 1, edit, { tasks:false, trash:true }, 6, true);
      await assertSucceeds(b.commit());
      expect(await counts()).toMatchObject({ n:1, t:0 });
    });

    it("never blocks a delete, even over the cap", async () => {
      await assertSucceeds(write(1, live(1), undefined));
      await seedCounts(5000, 500);
      await assertSucceeds(write(1, undefined, live(1)));
      await assertSucceeds(deleteDoc(doc(db, "users/alice/trash/7")));
    });

    it("caps tasks at 5000 and the trash at 500", async () => {
      await seedCounts(4999, 499);
      await assertSucceeds(write(1, live(1), undefined));      // 5000th task
      await assertFails(write(2, live(2), undefined));         // 5001st
      await assertSucceeds(write(3, trashed(3), undefined));   // 500th trash entry
      await assertFails(write(4, trashed(4), undefined));      // 501st
    });

    it("protects the counts doc itself", async () => {
      await assertFails(deleteDoc(doc(db, "users/alice/meta/counts")));
      await assertFails(setDoc(doc(db, "users/alice/meta/counts"), { n:0, t:0, last:"" })); // reset = update to 0
      const bob = env.authenticatedContext("bob").firestore();
      await assertFails(getDoc(doc(bob, "users/alice/meta/counts")));
      await assertFails(setDoc(doc(bob, "users/bob/meta/counts"), { n:-100, t:0, last:"" })); // must start at 0
      await assertSucceeds(setDoc(doc(bob, "users/bob/meta/counts"), { n:0, t:0, last:"" }));
    });

    it(enforced ? "requires the count when creating a task" : "still allows uncounted creates from older app versions", async () => {
      const uncounted = write(1, live(1), undefined, false);
      if (enforced) await assertFails(uncounted); else await assertSucceeds(uncounted);
      const uncountedTrash = write(2, trashed(2), undefined, false);
      if (enforced) await assertFails(uncountedTrash); else await assertSucceeds(uncountedTrash);
      // Edits never need the count.
      await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), "users/alice/tasks/3"), { ...task(3), updatedAt:1 }));
      await assertSucceeds(write(3, { task:{ ...task(3), done:true } }, live(3), false));
    });
  });
}
