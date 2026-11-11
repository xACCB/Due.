import { describe, it, expect } from "vitest";
import { monthGrid, monthOnlyGrid, shiftMonth, weekdayLabels, byDueDate, deckDates, deckTop, deckDragX, deckSwipe, monthSwipe } from "./calendar";

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

describe("the Deck", () => {
  const t = (done: boolean) => ({ done });
  const due = new Map([
    ["2026-11-01", [t(true)]],            // past, all done: no card
    ["2026-11-03", [t(true), t(false)]],  // past with an open task: a card
    ["2026-11-10", [t(true)]],            // today, even when done
    ["2026-11-20", [t(false)]],
    ["2026-11-12", [t(true)]],            // later, even when done
  ]);
  const today = "2026-11-10";

  it("has a card for each date still open or not yet past, in order", () => {
    expect(deckDates(due, today)).toEqual(["2026-11-03", "2026-11-10", "2026-11-12", "2026-11-20"]);
    expect(deckDates(new Map(), today)).toEqual([]);
  });

  it("opens on the first date from today, and keeps a picked date while it exists", () => {
    const dates = deckDates(due, today);
    expect(deckTop(dates, null, today)).toBe("2026-11-10");
    expect(deckTop(dates, "2026-11-03", today)).toBe("2026-11-03");
    expect(deckTop(dates, "2026-11-01", today)).toBe("2026-11-10"); // gone: back to the default
    expect(deckTop(["2026-10-01", "2026-10-05"], null, today)).toBe("2026-10-05"); // all past: the last
    expect(deckTop([], null, today)).toBeUndefined();
  });

  it("follows the finger toward a next card and resists otherwise", () => {
    expect(deckDragX(-50, true)).toBe(-50);
    expect(deckDragX(-50, false)).toBe(-15);
    expect(deckDragX(50, true)).toBe(15);
  });

  it("moves on past 70px or on a flick, and springs back from anything less", () => {
    expect(deckSwipe(-70, 0)).toBe(1);
    expect(deckSwipe(70, 0)).toBe(-1);
    expect(deckSwipe(-69, 0)).toBe(0);
    expect(deckSwipe(-30, -700)).toBe(1);   // a quick flick
    expect(deckSwipe(30, 700)).toBe(-1);
    expect(deckSwipe(-20, -900)).toBe(0);   // too short to count
    expect(deckSwipe(-30, -500)).toBe(0);   // too slow
    expect(deckSwipe(-30, 700)).toBe(0);    // flicked back the other way
  });

  it("changes month past 50px, left for the next", () => {
    expect(monthSwipe(-51)).toBe(1);
    expect(monthSwipe(51)).toBe(-1);
    expect(monthSwipe(50)).toBe(0);
    expect(monthSwipe(-10)).toBe(0);
  });
});
