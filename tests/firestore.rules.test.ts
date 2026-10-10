import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, setDoc, getDoc, deleteDoc, updateDoc, deleteField } from "firebase/firestore";

// Proves firestore.rules actually enforces what CLAUDE.md claims (shape
// validation on top of ownership) instead of trusting it untested in
// production. Requires the Firestore emulator -- run via `npm run test:rules`,
// not the default `npm test`.
let testEnv: RulesTestEnvironment;

const validTask = { id:1, title:"Essay", subject:"English", dueDate:"2025-01-01", dueTime:"", estMins:30, done:false, order:0 };

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "dueplanner-rules-test",
    // With the task cap's counter requirement off: these tests are about the
    // shape and size of documents, written as plain single-doc writes. The
    // counter (and the rules with it on) is covered in firestore.counter.test.ts.
    firestore: { rules: readFileSync("firestore.rules", "utf8").replace("function enforceTaskCap() { return true; }", "function enforceTaskCap() { return false; }") },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
});

describe("profile doc (users/{uid})", () => {
  it("lets an owner write a valid profile", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertSucceeds(setDoc(doc(db, "users/alice"), {
      layout:"list", colorCodeUrgency:true, subjects:["Math","English"], subjectColors:{ Math:"#FF6B6B" },
    }, { merge:true }));
  });
  it("rejects a wrong-typed layout", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "users/alice"), { layout:123 }, { merge:true }));
  });
  it("rejects a non-boolean colorCodeUrgency", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "users/alice"), { colorCodeUrgency:"yes" }, { merge:true }));
  });
  it("rejects subjects that aren't a list, or a list over the size cap", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "users/alice"), { subjects:"Math" }, { merge:true }));
    await assertFails(setDoc(doc(db, "users/alice"), { subjects:Array.from({length:201},(_,i)=>`S${i}`) }, { merge:true }));
  });
  it("rejects subjectColors that aren't a map", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "users/alice"), { subjectColors:["#FF6B6B"] }, { merge:true }));
  });
  it("accepts only known time formats and week starts", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertSucceeds(setDoc(doc(db, "users/alice"), { timeFormat:"24h", weekStart:1 }, { merge:true }));
    await assertFails(setDoc(doc(db, "users/alice"), { timeFormat:"25h" }, { merge:true }));
    await assertFails(setDoc(doc(db, "users/alice"), { weekStart:3 }, { merge:true }));
  });
  it("rejects writing another user's profile", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "users/bob"), { layout:"list" }, { merge:true }));
  });
  it("rejects reads and writes from a signed-out client", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "users/alice")));
    await assertFails(setDoc(doc(db, "users/alice"), { layout:"list" }));
  });
});

describe("tasks subcollection (users/{uid}/tasks/{taskId})", () => {
  it("lets an owner write a valid task", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertSucceeds(setDoc(doc(db, "users/alice/tasks/1"), validTask));
  });
  it("rejects a task missing a required field", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    const missingOrder:Record<string,unknown> = { ...validTask };
    delete missingOrder.order;
    await assertFails(setDoc(doc(db, "users/alice/tasks/1"), missingOrder));
  });
  it("rejects a wrong-typed field", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "users/alice/tasks/1"), { ...validTask, done:"false" }));
  });
  it("rejects writing into another user's tasks subcollection", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "users/bob/tasks/1"), validTask));
  });
  it("rejects deleting another user's task", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/bob/tasks/1"), validTask);
    });
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(deleteDoc(doc(db, "users/bob/tasks/1")));
  });
});

describe("trash subcollection (users/{uid}/trash/{taskId})", () => {
  const trashed = { ...validTask, deletedAt: 1_700_000_000_000, updatedAt: 1_700_000_000_000 };
  it("lets an owner move a task to the trash", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertSucceeds(setDoc(doc(db, "users/alice/trash/1"), trashed));
    await assertSucceeds(deleteDoc(doc(db, "users/alice/trash/1")));
  });
  it("rejects a trashed task without deletedAt, or with a malformed task", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "users/alice/trash/1"), { ...validTask, updatedAt: 1 }));
    await assertFails(setDoc(doc(db, "users/alice/trash/1"), { ...trashed, done: "no" }));
  });
  it("rejects another user's trash", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "users/bob/trash/1"), trashed));
    await assertFails(getDoc(doc(db, "users/bob/trash/1")));
  });
});

describe("task sync metadata", () => {
  it("accepts a numeric updatedAt and rejects any other type", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertSucceeds(setDoc(doc(db, "users/alice/tasks/1"), { ...validTask, updatedAt: 5 }));
    await assertFails(setDoc(doc(db, "users/alice/tasks/2"), { ...validTask, id: 2, updatedAt: "now" }));
  });
  it("allows a partial (merge) update of an existing task", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertSucceeds(setDoc(doc(db, "users/alice/tasks/1"), validTask));
    await assertSucceeds(setDoc(doc(db, "users/alice/tasks/1"), { title: "Essay v2", updatedAt: 6 }, { merge: true }));
  });
});

// Mirrors src/lib/limits.ts -- the app stays inside these, the rules enforce them.
describe("size caps", () => {
  const full = { ...validTask, subtasks:[{ id:"a", text:"x", done:false }], recurrence:"weekly", archived:false,
    completedAt:null, tags:["exam"], priorityOverride:"high", sessions:[{ mins:25, at:1 }], spawnedNextId:null, updatedAt:1 };
  const list = (n:number, f:(i:number)=>unknown) => Array.from({ length:n }, (_, i) => f(i));
  it("accepts a task using every optional field the app writes", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertSucceeds(setDoc(doc(db, "users/alice/tasks/1"), full));
  });
  it("caps subtasks at 100, tags at 30 and sessions at 1000 per task", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    const ref = doc(db, "users/alice/tasks/1");
    await assertSucceeds(setDoc(ref, { ...validTask, subtasks:list(100, i => ({ id:String(i), text:"s", done:false })) }));
    await assertFails(setDoc(ref, { ...validTask, subtasks:list(101, i => ({ id:String(i), text:"s", done:false })) }));
    await assertSucceeds(setDoc(ref, { ...validTask, tags:list(30, i => `t${i}`) }));
    await assertFails(setDoc(ref, { ...validTask, tags:list(31, i => `t${i}`) }));
    await assertSucceeds(setDoc(ref, { ...validTask, sessions:list(1000, i => ({ mins:1, at:i })) }));
    await assertFails(setDoc(ref, { ...validTask, sessions:list(1001, i => ({ mins:1, at:i })) }));
  });
  it("rejects over-long strings, bad dates/times lengths and out-of-range estimates", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    const ref = doc(db, "users/alice/tasks/1");
    await assertFails(setDoc(ref, { ...validTask, title:"x".repeat(501) }));
    await assertFails(setDoc(ref, { ...validTask, subject:"x".repeat(201) }));
    await assertFails(setDoc(ref, { ...validTask, dueDate:"2025-01-01T00:00:00Z" }));
    await assertFails(setDoc(ref, { ...validTask, dueTime:"09:00:00" }));
    await assertFails(setDoc(ref, { ...validTask, estMins:-1 }));
    await assertFails(setDoc(ref, { ...validTask, estMins:100001 }));
  });
  it("only accepts known recurrence and priority values", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    const ref = doc(db, "users/alice/tasks/1");
    await assertFails(setDoc(ref, { ...validTask, recurrence:"hourly" }));
    await assertFails(setDoc(ref, { ...validTask, priorityOverride:"urgent" }));
    await assertFails(setDoc(ref, { ...validTask, tags:"a,b" }));
    await assertFails(setDoc(ref, { ...validTask, archived:"yes" }));
  });
  it("rejects a task padded with lots of extra fields", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    const padded = { ...validTask, ...Object.fromEntries(list(20, i => [`junk${i}`, i])) };
    await assertFails(setDoc(doc(db, "users/alice/tasks/1"), padded));
  });
  it("applies the caps to a merge update too (the stored result is checked)", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    const ref = doc(db, "users/alice/tasks/1");
    await assertSucceeds(setDoc(ref, validTask));
    await assertFails(setDoc(ref, { tags:list(31, i => `t${i}`) }, { merge:true }));
  });
  it("caps the trash the same way", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "users/alice/trash/1"), { ...validTask, deletedAt:1, tags:list(31, i => `t${i}`) }));
  });
  it("caps the profile's subject colors, layout, and field count", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    const ref = doc(db, "users/alice");
    await assertSucceeds(setDoc(ref, { subjectColors:Object.fromEntries(list(200, i => [`S${i}`, "#000000"])) }, { merge:true }));
    await assertFails(setDoc(ref, { subjectColors:Object.fromEntries(list(201, i => [`X${i}`, "#000000"])) }));
    await assertFails(setDoc(ref, { layout:"x".repeat(41) }, { merge:true }));
    await assertFails(setDoc(doc(db, "users/alice"), Object.fromEntries(list(41, i => [`f${i}`, true]))));
  });
});

describe("device list (users/{uid}/meta/devices)", () => {
  const device = (n = 1) => ({ name:`Chrome on Windows ${n}`, createdAt:1, lastSeen:2 });
  const devices = (count: number) => Object.fromEntries(Array.from({ length:count }, (_, i) => [`dev${i}`, device(i)]));

  it("lets an owner register a device, refresh it, and read the list", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    const ref = doc(db, "users/alice/meta/devices");
    await assertSucceeds(setDoc(ref, { d:{ abc123:device() } }, { merge:true }));
    await assertSucceeds(setDoc(ref, { d:{ def456:device(2) } }, { merge:true }));
    await assertSucceeds(updateDoc(ref, { "d.abc123.lastSeen":3 }));
    await assertSucceeds(getDoc(ref));
  });
  it("lets an owner sign a device out (remove its entry), sign out all others, and delete the list", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    const ref = doc(db, "users/alice/meta/devices");
    await assertSucceeds(setDoc(ref, { d:devices(3) }));
    await assertSucceeds(updateDoc(ref, { "d.dev1":deleteField() }));
    await assertSucceeds(setDoc(ref, { d:{ dev0:device(0) } }));
    await assertSucceeds(deleteDoc(ref));
  });
  it("caps the list at 20 devices, on a merge too", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    const ref = doc(db, "users/alice/meta/devices");
    await assertFails(setDoc(ref, { d:devices(21) }));
    await assertSucceeds(setDoc(ref, { d:devices(20) }));
    await assertFails(setDoc(ref, { d:{ onemore:device() } }, { merge:true }));
  });
  it("rejects anything but the one map", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    const ref = doc(db, "users/alice/meta/devices");
    await assertFails(setDoc(ref, { d:"abc" }));
    await assertFails(setDoc(ref, { d:[device()] }));
    await assertFails(setDoc(ref, { d:{}, extra:true }));
    await assertFails(setDoc(ref, { other:{} }));
  });
  it("keeps another user, and a signed-out visitor, out", async () => {
    await testEnv.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), "users/alice/meta/devices"), { d:devices(1) }); });
    for (const db of [testEnv.authenticatedContext("bob").firestore(), testEnv.unauthenticatedContext().firestore()]) {
      const ref = doc(db, "users/alice/meta/devices");
      await assertFails(getDoc(ref));
      await assertFails(setDoc(ref, { d:{} }));
      await assertFails(updateDoc(ref, { "d.dev0":deleteField() }));
      await assertFails(deleteDoc(ref));
    }
  });
  it("doesn't open up any other doc under meta/", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "users/alice/meta/other"), { d:{} }));
    await assertFails(getDoc(doc(db, "users/alice/meta/other")));
  });
});
