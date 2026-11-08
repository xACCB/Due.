import { describe, expect, it } from "vitest";
import { DEFAULT_SUBJECTS } from "@dueplanner/core/constants";
import { bool, cleanDate, cleanHiddenFor, cleanNames, cleanOffsets, cleanRecaps, cleanSubjectColors, cleanSubjects, cleanTemplates, int, oneOf, SETTINGS } from "./settings";

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

  it("clean the settings added for the web's Home, Inbox and Looks", () => {
    expect(cleanTemplates([{ id: "t", name: "Lab", subject: "Science", estMins: 30 }, { id: "x", name: " ", subject: "", estMins: 0 }, "junk", null]))
      .toEqual([{ id: "t", name: "Lab", subject: "Science", estMins: 30 }]);
    expect(cleanTemplates("nope")).toEqual([]);
    expect(cleanHiddenFor(12)).toBe(12);
    expect(cleanHiddenFor("12")).toBeNull();
    expect(cleanDate("2026-11-08")).toBe("2026-11-08");
    expect(cleanDate("Nov 8")).toBeNull();
    expect(cleanNames(["Math", 3, "Art"])).toEqual(["Math", "Art"]);
    const recap = { id: "r", period: "day", start: "2026-11-07", end: "2026-11-07", finished: 1, mins: 0, dated: 0, onTime: 0, busiest: null, titles: ["A"], read: false };
    expect(cleanRecaps([recap, { id: "bad" }])).toEqual([recap]);
    const anim = SETTINGS.animSpeed.clean;
    expect(anim(1.5)).toBe(1.5);
    expect(anim(1.6)).toBe(1.5); // to the nearest 0.25
    expect(anim(9)).toBe(2);
    expect(anim("fast")).toBe(1);
    expect(SETTINGS.layout.clean("kanban")).toBe("kanban");
    expect(SETTINGS.layout.clean("timeline")).toBe("list"); // a removed web layout
    expect(SETTINGS.autoArchiveDays.clean(30)).toBe(30);
    expect(SETTINGS.autoArchiveDays.clean(14)).toBe(7);
    expect(SETTINGS.textSize.clean("large")).toBe("large");
    expect(SETTINGS.textSize.clean("huge")).toBe("default");
    expect(SETTINGS.calendarView.clean("deck")).toBe("deck");
    expect(SETTINGS.groupBy.clean("tags")).toBe("none");
  });
});
