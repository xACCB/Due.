import { describe, expect, it } from "vitest";
import { LIMITS, PROFILE_FIELDS, TASK_FIELDS, TRASH_FIELDS } from "./limits";
// The rules file as text (Vite's ?raw import), so this runs in plain `npm test`.
import rules from "../../firestore.rules?raw";

// The limits live in two places: src/lib/limits.ts (what the app stays inside)
// and firestore.rules (what the cloud enforces). If they drift apart, a save
// over the rules' number is kept on the device but silently refused by the
// cloud. This reads the numbers straight out of the rules file and checks each
// one against LIMITS, so changing one without the other fails `npm test`.
// (tests/firestore.contract.test.ts checks the same thing by behaviour, on the
// emulator.)

// Every "<expression> <= <number>" in the rules for the given expression.
function caps(expression: string): number[] {
  const escaped = expression.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...rules.matchAll(new RegExp(`${escaped}\\s*<=\\s*(\\d+)`, "g"))].map(m => Number(m[1]));
}

const expected: [string, string, number][] = [
  ["a task's title", "data.title.size()", LIMITS.title],
  ["a task's subject", "data.subject.size()", LIMITS.subject],
  ["subtasks per task", "data.subtasks.size()", LIMITS.subtasks],
  ["tags per task", "data.tags.size()", LIMITS.tags],
  ["sessions per task", "data.sessions.size()", LIMITS.sessions],
  ["tag text per task", "data.tags.join('').size()", LIMITS.tags * LIMITS.tag],
  ["subject text per account", "data.subjects.join('').size()", LIMITS.subjects * LIMITS.subject],
  ["subject colour names per account", "data.subjectColors.keys().join('').size()", LIMITS.subjects * LIMITS.subject],
  ["a task's estimate", "data.estMins", LIMITS.estMins],
  ["subjects per account", "data.subjects.size()", LIMITS.subjects],
  ["subject colours per account", "data.subjectColors.size()", LIMITS.subjects],
  ["tasks per account", "a.n", LIMITS.tasks],
  ["Recently deleted entries per account", "a.t", LIMITS.trash],
  ["devices per account", "data.d.size()", LIMITS.devices],
];

describe("firestore.rules agrees with LIMITS", () => {
  for (const [what, expression, limit] of expected) {
    it(`${what}: ${expression} <= ${limit}`, () => {
      const found = caps(expression);
      expect(found.length, `no "${expression} <= N" found in firestore.rules; was the rule renamed?`).toBeGreaterThan(0);
      for (const n of found) expect(n).toBe(limit);
    });
  }

  it("covers every limit the app defines", () => {
    // A new entry in LIMITS needs a line in `expected` above (and a rule).
    // LIMITS.tag only appears multiplied (tags x tag), which the "tag text" row checks.
    const covered = new Set([...expected.map(([, , limit]) => limit), LIMITS.tag]);
    for (const [name, value] of Object.entries(LIMITS)) expect(covered.has(value), `LIMITS.${name} isn't checked against the rules`).toBe(true);
  });
});

// The same for which fields a document may hold: the rules refuse any other,
// so a field the app writes but the rules don't list would stop that task
// syncing, and one the rules list but the app never writes is room to abuse.
function fieldList(name: string): string[] {
  const at = rules.indexOf(`function ${name}() { return [`);
  expect(at, `no "function ${name}() { return [...] }" found in firestore.rules; was it renamed?`).toBeGreaterThan(-1);
  const list = rules.slice(rules.indexOf("[", at) + 1, rules.indexOf("]", at));
  return [...list.matchAll(/'([^']+)'/g)].map(m => m[1]);
}

describe("firestore.rules agrees on which fields are synced", () => {
  it("a task's fields", () => {
    expect(fieldList("taskFields").sort()).toEqual([...TASK_FIELDS].sort());
  });
  it("a trash entry is a task plus deletedAt", () => {
    expect(rules).toContain("function trashFields() { return taskFields().concat(['deletedAt']); }");
    expect([...TRASH_FIELDS].sort()).toEqual([...TASK_FIELDS, "deletedAt"].sort());
  });
  it("a profile's fields", () => {
    expect(fieldList("profileFields").sort()).toEqual([...PROFILE_FIELDS].sort());
  });
});
