import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { doc, setDoc, getDoc, deleteDoc } from "firebase/firestore";

// Proves firestore.rules actually enforces what CLAUDE.md claims (shape
// validation on top of ownership) instead of trusting it untested in
// production. Requires the Firestore emulator -- run via `npm run test:rules`,
// not the default `npm test`.
let testEnv: RulesTestEnvironment;

const validTask = { id:1, title:"Essay", subject:"English", dueDate:"2025-01-01", dueTime:"", estMins:30, done:false, order:0 };

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "dueplanner-rules-test",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
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
