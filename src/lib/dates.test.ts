import { describe, it, expect } from "vitest";
import { localDateStr, advanceDate, startOfWeek } from "./dates";

describe("localDateStr", () => {
  it("pads month and day to two digits", () => {
    expect(localDateStr(new Date(2024, 0, 5))).toBe("2024-01-05");
  });
  it("uses local fields, not UTC", () => {
    // Construct a date purely from local-time components -- if this ever
    // regressed to toISOString() (UTC), this would fail for anyone not at UTC.
    const d = new Date(2024, 11, 31, 23, 0);
    expect(localDateStr(d)).toBe("2024-12-31");
  });
});

describe("advanceDate", () => {
  it("advances daily by one day", () => {
    expect(advanceDate("2024-03-10", "daily")).toBe("2024-03-11");
  });
  it("advances weekly by seven days", () => {
    expect(advanceDate("2024-03-10", "weekly")).toBe("2024-03-17");
  });
  it("clamps monthly rollover to the shorter month instead of overflowing", () => {
    // Jan 31 + 1 month must land on Feb 29 (2024 is a leap year), not Mar 2/3.
    expect(advanceDate("2024-01-31", "monthly")).toBe("2024-02-29");
  });
  it("clamps monthly rollover in a non-leap year", () => {
    expect(advanceDate("2023-01-31", "monthly")).toBe("2023-02-28");
  });
  it("advances monthly normally when the day exists in the target month", () => {
    expect(advanceDate("2024-03-15", "monthly")).toBe("2024-04-15");
  });
  it("leaves the date unchanged for recurrence 'none'", () => {
    expect(advanceDate("2024-03-10", "none")).toBe("2024-03-10");
  });
});

describe("startOfWeek", () => {
  it("goes back to Sunday or Monday", () => {
    const wed = new Date(2026, 8, 23, 15, 30); // Wed Sep 23 2026
    expect(localDateStr(startOfWeek(wed, 0))).toBe("2026-09-20");
    expect(localDateStr(startOfWeek(wed, 1))).toBe("2026-09-21");
  });
  it("a Sunday is the last day of a Monday week", () => {
    const sun = new Date(2026, 8, 27);
    expect(localDateStr(startOfWeek(sun, 0))).toBe("2026-09-27");
    expect(localDateStr(startOfWeek(sun, 1))).toBe("2026-09-21");
  });
});
