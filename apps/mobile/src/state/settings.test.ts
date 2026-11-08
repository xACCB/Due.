import { describe, expect, it } from "vitest";
import { DEFAULT_SUBJECTS } from "@dueplanner/core/constants";
import { bool, cleanOffsets, cleanSubjectColors, cleanSubjects, int, oneOf, SETTINGS } from "./settings";

describe("settings cleaners", () => {
  it("keep valid values and fall back on anything else", () => {
    expect(bool(true)(false)).toBe(false);
    expect(bool(true)("no")).toBe(true);
    expect(int(25, 1, 180)(40)).toBe(40);
    expect(int(25, 1, 180)(999)).toBe(180);
    expect(int(25, 1, 180)(12.6)).toBe(13);
    expect(int(25, 1, 180)("40")).toBe(25);
    expect(int(25, 1, 180)(NaN)).toBe(25);
    expect(oneOf(["a", "b"] as const, "a")("b")).toBe("b");
    expect(oneOf(["a", "b"] as const, "a")("c")).toBe("a");
  });

  it("subjects: text only, one line, no repeats; defaults when not a list", () => {
    expect(cleanSubjects(["Math", "Math", 3, " Art\n2 ", ""])).toEqual(["Math", "Art 2"]);
    expect(cleanSubjects(null)).toEqual(DEFAULT_SUBJECTS);
    expect(cleanSubjects([])).toEqual([]);
  });

  it("subject colours merge over the defaults and drop bad values", () => {
    const c = cleanSubjectColors({ Math: "#000000", Bio: "#12ab34", Bad: "red" });
    expect(c.Math).toBe("#000000");
    expect(c.Bio).toBe("#12ab34");
    expect(c.Bad).toBeUndefined();
    expect(c.English).toBeDefined();
  });

  it("reminder offsets: known keys only, in the standard order", () => {
    expect(cleanOffsets(["0", "1d", "bogus"])).toEqual(["1d", "0"]);
    expect(cleanOffsets("x")).toEqual(["0"]);
  });

  it("uses the web app's keys and defaults", () => {
    expect(SETTINGS.themeMode).toMatchObject({ key: "hw-thememode", initial: "auto" });
    expect(SETTINGS.timeFormat).toMatchObject({ key: "hw-timeformat", initial: "12h" });
    expect(SETTINGS.pomodoroWork).toMatchObject({ key: "hw-pomodoro-work", initial: 25 });
    expect(SETTINGS.reminderOffsets.initial).toEqual(["0"]);
    for (const s of Object.values(SETTINGS)) expect(s.key).toMatch(/^hw-/);
  });
});
