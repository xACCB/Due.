import { describe, it, expect } from "vitest";
import { monthGrid, shiftMonth, weekdayLabels, heatLevel, byDueDate } from "./calendar";

describe("monthGrid", () => {
  it("is 42 consecutive days starting on the week holding the 1st", () => {
    // October 2026 starts on a Thursday.
    const sun = monthGrid(2026, 9, 0);
    expect(sun).toHaveLength(42);
    expect(sun[0]).toBe("2026-09-27"); // the Sunday before
    expect(sun[4]).toBe("2026-10-01");
    expect(sun[41]).toBe("2026-11-07");
    const mon = monthGrid(2026, 9, 1);
    expect(mon[0]).toBe("2026-09-28"); // the Monday before
    expect(mon[3]).toBe("2026-10-01");
  });
  it("starts on the 1st itself when the month begins on the week start", () => {
    expect(monthGrid(2026, 10, 0)[0]).toBe("2026-11-01"); // Nov 1 2026 is a Sunday
  });
  it("handles leap-year February", () => {
    const g = monthGrid(2028, 1, 0);
    expect(g).toContain("2028-02-29");
    expect(g).not.toContain("2028-02-30");
  });
});

describe("shiftMonth", () => {
  it("wraps across years", () => {
    expect(shiftMonth(2026, 11, 1)).toEqual([2027, 0]);
    expect(shiftMonth(2026, 0, -1)).toEqual([2025, 11]);
    expect(shiftMonth(2026, 9, 0)).toEqual([2026, 9]);
  });
});

describe("weekdayLabels", () => {
  it("follows the week start", () => {
    expect(weekdayLabels(0)[0]).toBe("Sun");
    expect(weekdayLabels(1)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
});

describe("heatLevel", () => {
  it("is 0 with nothing open, and at least 1 with open tasks", () => {
    expect(heatLevel(0, 0)).toBe(0);
    expect(heatLevel(0, 2)).toBe(1);
  });
  it("steps up by the hour", () => {
    expect(heatLevel(45, 1)).toBe(1);
    expect(heatLevel(60, 1)).toBe(2);
    expect(heatLevel(150, 2)).toBe(3);
    expect(heatLevel(240, 3)).toBe(4);
  });
});

describe("byDueDate", () => {
  it("groups by date and skips undated tasks", () => {
    const m = byDueDate([
      { id: 1, dueDate: "2026-10-01" },
      { id: 2, dueDate: "" },
      { id: 3, dueDate: "2026-10-01" },
      { id: 4, dueDate: "2026-10-02" },
    ]);
    expect(m.get("2026-10-01")?.map(t => t.id)).toEqual([1, 3]);
    expect(m.get("2026-10-02")?.map(t => t.id)).toEqual([4]);
    expect(m.has("")).toBe(false);
  });
});
