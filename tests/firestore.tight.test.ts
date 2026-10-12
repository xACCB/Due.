import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import type { RulesTestEnvironment } from "@firebase/rules-unit-testing";
import { readFileSync } from "node:fs";
import { deleteField, doc, setDoc, updateDoc, writeBatch, increment } from "firebase/firestore";

// The stricter task checks added 2026-10-10 (isTightTask / keepsOrTightens in
// firestore.rules): the id must match the document, dates and times must be
// real formats, the estimate a whole number, tag text bounded, and no
// timestamps from the far future. Each is checked two ways: that a NEW
// document must pass it, and that an OLD document which doesn't pass it (as an
// earlier app version or a hand-edited import might have stored) can still be
// edited, completed, moved to the trash's sibling fields and so on, as long as
// the write doesn't make that particular field worse.
let env: RulesTestEnvironment;
const DAY = 86400000;
const task = (id = 1, extra: Record<string, unknown> = {}) => ({ id, title: "Essay", subject: "English", dueDate: "2026-10-10", dueTime: "09:00", estMins: 30, done: false, order: 0, ...extra });

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "dueplanner-rules-tight",
    // Counter requirement off: these are about a single document's contents.
    firestore: { rules: readFileSync("firestore.rules", "utf8").replace("function enforceTaskCap() { return true; }", "function enforceTaskCap() { return false; }") },
  });
});
afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });
const db = () => env.authenticatedContext("alice").firestore();
// Puts a document in place without the rules, the way old data is already there.
const seed = (path: string, data: Record<string, unknown>) => env.withSecurityRulesDisabled(async ctx => { await setDoc(doc(ctx.firestore(), path), data); });

describe("a task's id is its document's name", () => {
  it("refuses a new task stored under a different name, in tasks and in trash", async () => {
    await assertFails(setDoc(doc(db(), "users/alice/tasks/2"), task(1)));
    await assertFails(setDoc(doc(db(), "users/alice/trash/2"), task(1, { deletedAt: 1 })));
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/1"), task(1)));
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/1760000000123"), task(1760000000123)));
  });
  it("refuses changing an existing task's id", async () => {
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/1"), task(1)));
    await assertFails(updateDoc(doc(db(), "users/alice/tasks/1"), { id: 2 }));
    await assertFails(setDoc(doc(db(), "users/alice/tasks/1"), task(2)));
    await assertSucceeds(updateDoc(doc(db(), "users/alice/tasks/1"), { title: "Renamed" }));
  });
});

describe("dates, times and estimates", () => {
  it("a new task needs a real date and time format (or none) and a whole-number estimate", async () => {
    for (const bad of [{ dueDate: "10/10/2026" }, { dueDate: "tomorrow" }, { dueDate: "2026-1-5" }, { dueTime: "9:00" }, { dueTime: "9am" }, { dueTime: "0900" }, { estMins: 30.5 }]) {
      await assertFails(setDoc(doc(db(), "users/alice/tasks/1"), task(1, bad)));
    }
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/1"), task(1, { dueDate: "", dueTime: "", estMins: 0 })));
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/2"), task(2, { dueDate: "2027-01-31", dueTime: "23:59", estMins: 90 })));
  });
  it("an existing task can't have one of them changed to something invalid", async () => {
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/1"), task(1)));
    await assertFails(updateDoc(doc(db(), "users/alice/tasks/1"), { dueDate: "next week" }));
    await assertFails(updateDoc(doc(db(), "users/alice/tasks/1"), { dueTime: "9:00" }));
    await assertFails(updateDoc(doc(db(), "users/alice/tasks/1"), { estMins: 12.5 }));
    await assertSucceeds(updateDoc(doc(db(), "users/alice/tasks/1"), { dueDate: "2026-11-01", dueTime: "", estMins: 45 }));
  });
  it("old data that wouldn't pass today stays editable, and can be corrected", async () => {
    await seed("users/alice/tasks/1", task(1, { dueDate: "5/1/26", dueTime: "9:00", estMins: 22.5 }));
    const ref = doc(db(), "users/alice/tasks/1");
    await assertSucceeds(updateDoc(ref, { title: "Still editable", updatedAt: Date.now() }));
    await assertSucceeds(updateDoc(ref, { done: true, completedAt: Date.now() }));
    await assertSucceeds(updateDoc(ref, { subtasks: [{ id: "a", text: "x", done: false }], priorityOverride: "high" }));
    await assertFails(updateDoc(ref, { dueTime: "noon" }));           // changing it to another bad value: no
    await assertSucceeds(updateDoc(ref, { dueTime: "12:00" }));       // fixing it: yes
    await assertSucceeds(updateDoc(ref, { dueDate: "2026-05-01", estMins: 23 }));
  });
});

describe("tag text", () => {
  const tags = (n: number, len: number) => Array.from({ length: n }, (_, i) => String(i % 10).repeat(len));
  it("a new task's tags hold at most 3,000 characters in total", async () => {
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/1"), task(1, { tags: tags(30, 100) })));
    await assertFails(setDoc(doc(db(), "users/alice/tasks/2"), task(2, { tags: tags(30, 101) })));
    await assertFails(setDoc(doc(db(), "users/alice/tasks/3"), task(3, { tags: ["x".repeat(3001)] })));
  });
  it("oversized tags already stored don't block other edits, but can't be replaced by oversized ones", async () => {
    await seed("users/alice/tasks/1", task(1, { tags: ["x".repeat(9000)] }));
    const ref = doc(db(), "users/alice/tasks/1");
    await assertSucceeds(updateDoc(ref, { title: "Edited" }));
    await assertFails(updateDoc(ref, { tags: ["y".repeat(9000)] }));
    await assertSucceeds(updateDoc(ref, { tags: ["short"] }));
    await assertSucceeds(updateDoc(ref, { tags: deleteField() }));
  });
});

describe("no timestamps from the far future", () => {
  it("accepts times up to two days ahead (a device with the wrong clock or time zone still syncs)", async () => {
    const soon = Date.now() + DAY;
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/1"), task(1, { updatedAt: soon, done: true, completedAt: soon })));
    await assertSucceeds(setDoc(doc(db(), "users/alice/trash/2"), task(2, { updatedAt: soon, deletedAt: soon })));
    await assertSucceeds(updateDoc(doc(db(), "users/alice/tasks/1"), { title: "x", updatedAt: Date.now() + 1.5 * DAY }));
  });
  it("refuses a new task or trash entry stamped further ahead than that", async () => {
    const far = Date.now() + 3 * DAY;
    await assertFails(setDoc(doc(db(), "users/alice/tasks/1"), task(1, { updatedAt: far })));
    await assertFails(setDoc(doc(db(), "users/alice/tasks/1"), task(1, { done: true, completedAt: far })));
    await assertFails(setDoc(doc(db(), "users/alice/trash/1"), task(1, { deletedAt: far })));
    await assertFails(setDoc(doc(db(), "users/alice/tasks/1"), task(1, { updatedAt: 32503680000000 }))); // the year 3000
  });
  it("refuses an edit stamped far ahead, so one device can't win every conflict forever", async () => {
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/1"), task(1, { updatedAt: Date.now() })));
    const ref = doc(db(), "users/alice/tasks/1");
    await assertFails(updateDoc(ref, { title: "Mine wins", updatedAt: Date.now() + 30 * DAY }));
    await assertFails(updateDoc(ref, { done: true, completedAt: Date.now() + 30 * DAY }));
    await assertSucceeds(updateDoc(ref, { title: "Fine", updatedAt: Date.now() }));
    await assertSucceeds(updateDoc(ref, { done: true, completedAt: Date.now() }));
    await assertSucceeds(updateDoc(ref, { done: false, completedAt: null }));
  });
  it("a far-future time already stored doesn't block other edits, and can be corrected", async () => {
    await seed("users/alice/tasks/1", task(1, { updatedAt: 32503680000000, completedAt: 32503680000000, done: true }));
    await seed("users/alice/trash/2", task(2, { deletedAt: 32503680000000 }));
    await assertSucceeds(updateDoc(doc(db(), "users/alice/tasks/1"), { tags: ["a"] }));
    await assertSucceeds(updateDoc(doc(db(), "users/alice/tasks/1"), { title: "Corrected", updatedAt: Date.now() }));
    await assertSucceeds(updateDoc(doc(db(), "users/alice/trash/2"), { title: "Renamed in trash" }));
    await assertFails(updateDoc(doc(db(), "users/alice/trash/2"), { deletedAt: 32503680000001 }));
  });
});

// Added 2026-10-11. Same two halves as above: new data must be right, and
// data that is already stored and isn't can still be used.
describe("tags are text", () => {
  it("refuses a new task with a tag that isn't text, wherever it is in the list", async () => {
    await assertFails(setDoc(doc(db(), "users/alice/tasks/1"), task(1, { tags: [5] })));
    await assertFails(setDoc(doc(db(), "users/alice/tasks/1"), task(1, { tags: ["a", { b: 1 }] })));
    await assertFails(setDoc(doc(db(), "users/alice/tasks/1"), task(1, { tags: [...Array.from({ length: 29 }, (_, i) => "t" + i), true] })));
    await assertFails(setDoc(doc(db(), "users/alice/trash/1"), task(1, { tags: [null], deletedAt: 1 })));
    await assertFails(setDoc(doc(db(), "users/alice/tasks/1"), task(1, { tags: ["two\nlines"] })));
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/1"), task(1, { tags: [] })));
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/2"), task(2, { tags: Array.from({ length: 30 }, (_, i) => "t" + i) })));
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/3"), task(3, { tags: ["", "5", "true", "a, b", "naïve café", "日本語", " spaced "] })));
  });
  it("an existing task's tags can't be changed to something that isn't text", async () => {
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/1"), task(1, { tags: ["exam"] })));
    await assertFails(updateDoc(doc(db(), "users/alice/tasks/1"), { tags: ["exam", 7] }));
    await assertSucceeds(updateDoc(doc(db(), "users/alice/tasks/1"), { tags: ["exam", "reading"] }));
    await assertSucceeds(updateDoc(doc(db(), "users/alice/tasks/1"), { tags: deleteField() }));
  });
  it("an old task whose tags aren't text can still be edited, and its tags fixed", async () => {
    await seed("users/alice/tasks/1", task(1, { tags: [1, 2] }));
    await assertSucceeds(updateDoc(doc(db(), "users/alice/tasks/1"), { title: "Renamed", done: true }));
    await assertFails(updateDoc(doc(db(), "users/alice/tasks/1"), { tags: [1, 2, 3] }));
    await assertSucceeds(updateDoc(doc(db(), "users/alice/tasks/1"), { tags: ["one"] }));
  });
});

describe("the device list's ids", () => {
  const id = (n: number) => String(n).padStart(24, "0");
  const entry = (extra: Record<string, unknown> = {}) => ({ name: "Chrome on Windows", createdAt: 1, lastSeen: 2, ...extra });
  const ref = () => doc(db(), "users/alice/meta/devices");

  it("a device id is 24 hex characters", async () => {
    for (const bad of ["dev0", "A".repeat(24), "g".repeat(24), "0".repeat(23), "0".repeat(25), "0".repeat(24) + ","]) {
      await assertFails(setDoc(ref(), { d: { [bad]: entry() } }));
    }
    await assertSucceeds(setDoc(ref(), { d: {} }));
    await assertSucceeds(setDoc(ref(), { d: { "0123456789abcdef01234567": entry() } }));
    await assertFails(setDoc(ref(), { d: { nothex: entry() } }, { merge: true }));
    await assertSucceeds(setDoc(ref(), { d: { [id(2)]: entry() } }, { merge: true }));
  });
  it("what the app sends is accepted: register, last active, a stub, sign out", async () => {
    await assertSucceeds(setDoc(ref(), { d: { [id(1)]: entry() } }, { merge: true }));
    await assertSucceeds(setDoc(ref(), { d: { [id(2)]: entry(), [id(1)]: deleteField() } }, { merge: true }));
    await assertSucceeds(updateDoc(ref(), { [`d.${id(2)}.lastSeen`]: 3 }));
    // "Last active" for a device that was just removed leaves an entry with only lastSeen.
    await assertSucceeds(updateDoc(ref(), { [`d.${id(3)}.lastSeen`]: 4 }));
    await assertSucceeds(updateDoc(ref(), { [`d.${id(2)}`]: deleteField() }));
  });
  it("a list that already holds an odd id can still be used, but not added to", async () => {
    await seed("users/alice/meta/devices", { d: { oldstyle: entry(), [id(1)]: entry(), [id(2)]: entry() } });
    // Refreshing and removing work, including beside the odd ones.
    await assertSucceeds(updateDoc(ref(), { [`d.${id(2)}.lastSeen`]: 9 }));
    await assertSucceeds(updateDoc(ref(), { [`d.${id(2)}`]: deleteField() }));
    // A new device can't join while an odd id is in the list.
    await assertFails(setDoc(ref(), { d: { [id(3)]: entry() } }, { merge: true }));
    // Removing the odd id puts the list right, and then a new device can join.
    await assertSucceeds(updateDoc(ref(), { "d.oldstyle": deleteField() }));
    await assertSucceeds(setDoc(ref(), { d: { [id(3)]: entry() } }, { merge: true }));
    await assertSucceeds(updateDoc(ref(), { [`d.${id(1)}`]: deleteField() }));
  });
});

describe("subject names are text", () => {
  const ref = () => doc(db(), "users/alice");
  it("refuses a subject list holding something that isn't text", async () => {
    for (const bad of [["Math", 5], [true], [null, "Art"], [{ name: "Math" }], ["Art\nHistory"]]) await assertFails(setDoc(ref(), { subjects: bad }));
    await assertSucceeds(setDoc(ref(), { subjects: [] }));
    await assertSucceeds(setDoc(ref(), { subjects: ["Math", "English", "5", "Art & Design", "日本語"] }));
    await assertFails(setDoc(ref(), { subjects: ["Math", 7] }, { merge: true }));
    await assertSucceeds(setDoc(ref(), { subjects: ["Math", "Music"], layout: "board" }, { merge: true }));
  });
  it("a list that already holds one can still sync other settings, and be put right", async () => {
    await seed("users/alice", { subjects: ["Math", 5], layout: "list" });
    await assertSucceeds(setDoc(ref(), { subjects: ["Math", 5], layout: "board", weekStart: 1 }, { merge: true }));
    await assertFails(setDoc(ref(), { subjects: ["Math", 5, "Art"] }, { merge: true }));
    await assertSucceeds(setDoc(ref(), { subjects: ["Math", "Art"] }, { merge: true }));
  });
});

describe("the counter starts small", () => {
  it("refuses a new counter whose last id is long", async () => {
    await assertFails(setDoc(doc(db(), "users/alice/meta/counts"), { n: 0, t: 0, last: "9".repeat(31) }));
    await assertFails(setDoc(doc(db(), "users/alice/meta/counts"), { n: 0, t: 0, last: 5 }));
    await assertSucceeds(setDoc(doc(db(), "users/alice/meta/counts"), { n: 0, t: 0, last: "" }));
  });
});

describe("subjects, colours, devices and the counter", () => {
  it("bounds the total text in the subject list and the colour map", async () => {
    const ref = doc(db(), "users/alice");
    await assertSucceeds(setDoc(ref, { subjects: Array.from({ length: 200 }, (_, i) => String(i % 10).repeat(200)) }));
    await assertFails(setDoc(ref, { subjects: ["x".repeat(40001)] }));
    await assertSucceeds(setDoc(ref, { subjectColors: { Math: "#FF6B6B", ["s".repeat(200)]: "#000000" } }));
    // Firestore itself refuses one very long name, so the total is what the rule adds:
    // 40 names of 1,000 characters fit, 50 don't.
    const named = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i).padStart(3, "0") + "k".repeat(997), "#000000"]));
    await assertSucceeds(setDoc(ref, { subjectColors: named(40) }));
    await assertFails(setDoc(ref, { subjectColors: named(50) }));
    await assertFails(setDoc(ref, { subjectColors: { Math: "c".repeat(6401) } }));
  });
  it("bounds the device ids", async () => {
    const ref = doc(db(), "users/alice/meta/devices");
    const entry = { name: "Chrome on Windows", createdAt: 1, lastSeen: 2 };
    await assertSucceeds(setDoc(ref, { d: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`${String(i).padStart(2, "0")}${"a".repeat(22)}`, entry])) }));
    await assertFails(setDoc(ref, { d: { ["x".repeat(1281)]: entry } }));
  });
  it("the counter's last id must look like a task id", async () => {
    const d = db(); // one connection: a batch can't mix documents from two
    const counts = doc(d, "users/alice/meta/counts");
    await assertSucceeds(setDoc(counts, { n: 0, t: 0, last: "" }));
    const create = (id: string, last: string) => { const b = writeBatch(d); b.set(doc(d, `users/alice/tasks/${id}`), task(Number(id))); b.update(counts, { n: increment(1), t: increment(0), last }); return b.commit(); };
    await assertSucceeds(create("5", "5"));
    await assertFails(create("6", "six"));
    await assertFails(create("7", "7; drop"));
  });
});

// Added 2026-10-12. A document holds only the fields the app knows
// (taskFields() / trashFields() / profileFields() in firestore.rules), so it
// can't be padded with fields of its own choosing. Same two halves again.
describe("known fields only", () => {
  it("refuses a new task or trash entry holding a field the app doesn't have", async () => {
    await assertFails(setDoc(doc(db(), "users/alice/tasks/1"), task(1, { notes: "x" })));
    await assertFails(setDoc(doc(db(), "users/alice/tasks/1"), task(1, { blob: "x".repeat(100000) })));
    await assertFails(setDoc(doc(db(), "users/alice/trash/1"), task(1, { deletedAt: 1, junk: true })));
    // deletedAt belongs to a trash entry, not to a live task.
    await assertFails(setDoc(doc(db(), "users/alice/tasks/1"), task(1, { deletedAt: 1 })));
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/1"), task(1)));
    await assertSucceeds(setDoc(doc(db(), "users/alice/trash/2"), task(2, { deletedAt: 1, updatedAt: 1 })));
  });
  it("an edit can't add one", async () => {
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/1"), task(1)));
    await assertFails(updateDoc(doc(db(), "users/alice/tasks/1"), { notes: "x" }));
    await assertFails(setDoc(doc(db(), "users/alice/tasks/1"), { junk: 1, title: "Renamed" }, { merge: true }));
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/1"), { title: "Renamed", tags: ["a"], updatedAt: Date.now() }, { merge: true }));
    await assertSucceeds(setDoc(doc(db(), "users/alice/trash/2"), task(2, { deletedAt: 1 })));
    await assertFails(updateDoc(doc(db(), "users/alice/trash/2"), { junk: 1 }));
  });
  it("a field an older version stored stays, can be removed, and can't be changed or joined by another", async () => {
    await seed("users/alice/tasks/1", task(1, { notes: "from the first version" }));
    await seed("users/alice/trash/2", task(2, { deletedAt: 1, notes: "old" }));
    const ref = doc(db(), "users/alice/tasks/1");
    await assertSucceeds(updateDoc(ref, { title: "Still editable", done: true, completedAt: Date.now(), updatedAt: Date.now() }));
    await assertFails(updateDoc(ref, { notes: "x".repeat(100000) }));
    await assertFails(updateDoc(ref, { other: 1 }));
    await assertSucceeds(updateDoc(doc(db(), "users/alice/trash/2"), { title: "Renamed in trash" }));
    await assertSucceeds(updateDoc(ref, { notes: deleteField() }));
    await assertFails(updateDoc(ref, { notes: "back again" }));
  });
  it("a profile holds only the settings that sync", async () => {
    const ref = doc(db(), "users/alice");
    await assertFails(setDoc(ref, { layout: "list", junk: "x".repeat(100000) }));
    await assertFails(setDoc(ref, { themeName: "stealth" }, { merge: true }));
    await assertSucceeds(setDoc(ref, { layout: "list", colorCodeUrgency: true, subjects: ["Math"], subjectColors: { Math: "#FF6B6B" }, timeFormat: "12h", weekStart: 0 }));
    await assertFails(setDoc(ref, { junk: 1 }, { merge: true }));
  });
  it("a profile from an older version still syncs, and its old task list can be cleared", async () => {
    await seed("users/alice", { layout: "list", scratchpad: "old notes", themeName: "ocean", tasks: [task(1)] });
    const ref = doc(db(), "users/alice");
    await assertSucceeds(setDoc(ref, { layout: "board", colorCodeUrgency: false, subjects: ["Math"], subjectColors: {}, timeFormat: "24h", weekStart: 1 }, { merge: true }));
    await assertFails(setDoc(ref, { scratchpad: "x".repeat(100000) }, { merge: true }));
    await assertSucceeds(updateDoc(ref, { tasks: deleteField() })); // the one-time move to tasks/
  });
});

describe("a task's order and id are ordinary numbers", () => {
  it("refuses a new task ordered at infinity or at not-a-number", async () => {
    for (const bad of [Infinity, -Infinity, NaN, 1e300]) await assertFails(setDoc(doc(db(), "users/alice/tasks/1"), task(1, { order: bad })));
    await assertFails(setDoc(doc(db(), "users/alice/tasks/Infinity"), task(Infinity)));
    await assertFails(setDoc(doc(db(), "users/alice/tasks/NaN"), task(NaN)));
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/1"), task(1, { order: -3 })));
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/2"), task(2, { order: 2.5 })));
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/3"), task(3, { order: 1760000000123 })));
  });
  it("an existing task can't be moved there, and one already there can be edited and put right", async () => {
    await assertSucceeds(setDoc(doc(db(), "users/alice/tasks/1"), task(1)));
    await assertFails(updateDoc(doc(db(), "users/alice/tasks/1"), { order: Infinity }));
    await assertSucceeds(updateDoc(doc(db(), "users/alice/tasks/1"), { order: 12 }));
    await seed("users/alice/tasks/2", task(2, { order: Infinity }));
    await assertSucceeds(updateDoc(doc(db(), "users/alice/tasks/2"), { title: "Still editable" }));
    await assertSucceeds(updateDoc(doc(db(), "users/alice/tasks/2"), { order: 3 }));
  });
});
