import { describe, it, expect } from "vitest";
import { normalizeQuestionPrefs, moveQuestion } from "./addQuestions";

const KEYS = ["subject", "dueDate", "estMins", "recurrence"] as const;

describe("normalizeQuestionPrefs", () => {
  it("defaults to every question, on, in the built-in order", () => {
    expect(normalizeQuestionPrefs(undefined, KEYS)).toEqual(KEYS.map(key => ({ key, on: true })));
    expect(normalizeQuestionPrefs("list", KEYS)).toEqual(KEYS.map(key => ({ key, on: true })));
  });
  it("keeps saved order and on/off", () => {
    const saved = [{ key: "dueDate", on: true }, { key: "subject", on: false }, { key: "recurrence", on: false }, { key: "estMins", on: true }];
    expect(normalizeQuestionPrefs(saved, KEYS)).toEqual(saved);
  });
  it("drops unknown and repeated keys, and appends missing ones turned on", () => {
    const saved = [{ key: "estMins", on: false }, { key: "gone", on: true }, { key: "estMins", on: true }, null, { key: "subject" }];
    expect(normalizeQuestionPrefs(saved, KEYS)).toEqual([
      { key: "estMins", on: false },
      { key: "subject", on: true },
      { key: "dueDate", on: true },
      { key: "recurrence", on: true },
    ]);
  });
});

describe("moveQuestion", () => {
  const prefs = KEYS.map(key => ({ key, on: true }));
  it("moves up and down", () => {
    expect(moveQuestion(prefs, 1, -1).map(p => p.key)).toEqual(["dueDate", "subject", "estMins", "recurrence"]);
    expect(moveQuestion(prefs, 0, 1).map(p => p.key)).toEqual(["dueDate", "subject", "estMins", "recurrence"]);
  });
  it("does nothing past either end", () => {
    expect(moveQuestion(prefs, 0, -1)).toBe(prefs);
    expect(moveQuestion(prefs, 3, 1)).toBe(prefs);
  });
});
