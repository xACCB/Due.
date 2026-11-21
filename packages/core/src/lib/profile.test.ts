import { describe, expect, it } from "vitest";
import { DEFAULT_SUBJECT_COLORS } from "../constants";
import { SCHEMA_VERSION } from "./migrations";
import { PROFILE_KEYS, profileDoc, readProfile, sameProfile, type Profile } from "./profile";

const full: Profile = {
  layout: "list",
  colorCodeUrgency: true,
  subjects: ["Math", "English"],
  subjectColors: { ...DEFAULT_SUBJECT_COLORS, Math: "#123456" },
  timeFormat: "24h",
  weekStart: 1,
};

describe("readProfile", () => {
  it("reads back what profileDoc writes", () => {
    expect(readProfile(profileDoc(full))).toEqual(full);
  });

  it("leaves out fields of the wrong shape, so the device keeps its own", () => {
    const read = readProfile({
      layout: "sticky", // a layout that was removed
      colorCodeUrgency: "yes",
      subjects: ["Math", 3],
      subjectColors: ["#fff"],
      timeFormat: "12",
      weekStart: 2,
      schemaVersion: SCHEMA_VERSION,
    });
    expect(read).toEqual({});
  });

  it("refuses colours that aren't all text", () => {
    expect(readProfile({ subjectColors: { Math: 5 } }).subjectColors).toBeUndefined();
  });

  it("merges colours over the defaults, as the website does", () => {
    const read = readProfile({ subjectColors: { Math: "#000000", Robotics: "#ff0000" } });
    expect(read.subjectColors).toEqual({ ...DEFAULT_SUBJECT_COLORS, Math: "#000000", Robotics: "#ff0000" });
  });

  it("reads a doc with no version (an old app) and ignores fields it doesn't know", () => {
    expect(readProfile({ layout: "board", scratchpad: "old notes" })).toEqual({ layout: "board" });
  });

  it("keeps an empty subject list (the user deleted them all)", () => {
    expect(readProfile({ subjects: [] })).toEqual({ subjects: [] });
  });
});

describe("profileDoc", () => {
  it("writes every profile field and the version, nothing else", () => {
    const doc = profileDoc(full);
    expect(Object.keys(doc).sort()).toEqual([...PROFILE_KEYS, "schemaVersion"].sort());
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

describe("sameProfile", () => {
  it("is true for equal values in new objects", () => {
    expect(sameProfile(full, { ...full, subjects: [...full.subjects], subjectColors: { ...full.subjectColors } })).toBe(true);
  });

  it("compares subjects in order: their order is the user's", () => {
    expect(sameProfile({ subjects: ["Math", "English"] }, { subjects: ["English", "Math"] })).toBe(false);
  });

  it("compares colours by key, whatever the key order", () => {
    expect(sameProfile({ subjectColors: { a: "#1", b: "#2" } }, { subjectColors: { b: "#2", a: "#1" } })).toBe(true);
    expect(sameProfile({ subjectColors: { a: "#1" } }, { subjectColors: { a: "#1", b: "#2" } })).toBe(false);
  });

  it("tells a missing field from a present one", () => {
    expect(sameProfile({}, { subjectColors: {} })).toBe(false);
    expect(sameProfile({}, { subjects: [] })).toBe(false);
    expect(sameProfile({}, {})).toBe(true);
  });

  it("notices each plain field", () => {
    for (const [k, v] of [["layout", "board"], ["colorCodeUrgency", false], ["timeFormat", "12h"], ["weekStart", 0]] as const) {
      expect(sameProfile(full, { ...full, [k]: v })).toBe(false);
    }
  });
});
