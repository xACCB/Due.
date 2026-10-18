import { describe, it, expect } from "vitest";
import { monthGrid, monthOnlyGrid, shiftMonth, weekdayLabels, byDueDate } from "./calendar";

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

describe("monthOnlyGrid", () => {
  it("blanks the other months' days and drops empty weeks", () => {
    // October 2026: Thursday the 1st to Saturday the 31st, five weeks from Sunday.
    const oct = monthOnlyGrid(2026, 9, 0);
    expect(oct).toHaveLength(35);
    expect(oct.slice(0, 5)).toEqual([null, null, null, null, "2026-10-01"]);
    expect(oct[34]).toBe("2026-10-31");
    expect(oct.filter(c => c != null)).toHaveLength(31);
  });
  it("can be four rows or six", () => {
    // February 2026 starts on a Sunday and has 28 days.
    const feb = monthOnlyGrid(2026, 1, 0);
    expect(feb).toHaveLength(28);
    expect(feb.every(c => c != null)).toBe(true);
    // August 2026 starts on a Saturday: 31 days need six weeks from Sunday.
    const aug = monthOnlyGrid(2026, 7, 0);
    expect(aug).toHaveLength(42);
    expect(aug[6]).toBe("2026-08-01");
    expect(aug[36]).toBe("2026-08-31");
    expect(aug.slice(37)).toEqual([null, null, null, null, null]);
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
