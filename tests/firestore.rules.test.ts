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
    await assertSucceeds(setDoc(doc(db, "users/alice"), { themeName:"midnight", layout:"list", scratchpad:"hi" }, { merge:true }));
  });
  it("rejects a wrong-typed field", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "users/alice"), { themeName:123 }, { merge:true }));
  });
  it("rejects a scratchpad over the size cap", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "users/alice"), { scratchpad:"x".repeat(50001) }, { merge:true }));
  });
  it("rejects writing another user's profile", async () => {
    const db = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "users/bob"), { themeName:"midnight" }, { merge:true }));
  });
  it("rejects reads and writes from a signed-out client", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "users/alice")));
    await assertFails(setDoc(doc(db, "users/alice"), { themeName:"midnight" }));
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
