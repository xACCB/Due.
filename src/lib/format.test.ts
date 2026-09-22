import { describe, it, expect } from "vitest";
import { getPriority, csvField, daysUntil, contrastColor, formatDuration, countdown, formatAgo, formatTime } from "./format";

describe("getPriority", () => {
  it("returns the manual override unconditionally", () => {
    expect(getPriority("2099-01-01", 5, "high")).toBe("high");
  });
  it("returns low for a task with no due date", () => {
    expect(getPriority("", 30)).toBe("low");
  });
  it("returns high for something due today", () => {
    const today = new Date(); today.setHours(0,0,0,0);
    const s = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;
    expect(getPriority(s, 30)).toBe("high");
  });
  it("returns low for something far in the future", () => {
    const future = new Date(); future.setDate(future.getDate()+30);
    const s = `${future.getFullYear()}-${String(future.getMonth()+1).padStart(2,"0")}-${String(future.getDate()).padStart(2,"0")}`;
    expect(getPriority(s, 30)).toBe("low");
  });
});

describe("csvField", () => {
  it("leaves plain fields unquoted", () => {
    expect(csvField("Math")).toBe("Math");
    expect(csvField(42)).toBe("42");
  });
  it("quotes and escapes fields containing a comma", () => {
    expect(csvField("Essay, Draft")).toBe('"Essay, Draft"');
  });
  it("doubles embedded quotes", () => {
    expect(csvField('Say "hi"')).toBe('"Say ""hi"""');
  });
  it("quotes fields containing a newline", () => {
    expect(csvField("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("daysUntil", () => {
  it("returns null for no date", () => {
    expect(daysUntil("")).toBeNull();
  });
  it("flags an overdue date", () => {
    expect(daysUntil("2000-01-01")).toBe("Overdue!");
  });
  it("flags a far-future date with a day count", () => {
    const future = new Date(); future.setDate(future.getDate()+10);
    const s = `${future.getFullYear()}-${String(future.getMonth()+1).padStart(2,"0")}-${String(future.getDate()).padStart(2,"0")}`;
    expect(daysUntil(s)).toBe("10 days left");
  });
});

describe("contrastColor", () => {
  it("picks dark text on a light background", () => {
    expect(contrastColor("#ffffff")).toBe("#1a1a1a");
  });
  it("picks light text on a dark background", () => {
    expect(contrastColor("#000000")).toBe("#ffffff");
  });
});

describe("formatDuration", () => {
  it("returns an empty string for a missing or zero estimate", () => {
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(undefined)).toBe("");
  });
  it("formats minutes, whole hours, and mixed durations", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(90)).toBe("1h 30m");
  });
});

describe("countdown", () => {
  const at = (h:number, m:number) => new Date(2026, 8, 22, h, m).getTime(); // Sep 22 2026, local time
  it("counts down to a timed task due today", () => {
    expect(countdown("2026-09-22", "17:15", at(15, 0))).toBe("Due in 2h 15m");
    expect(countdown("2026-09-22", "15:00", at(15, 0))).toBe("Due in <1m");
  });
  it("shows how overdue a timed task due today is", () => {
    expect(countdown("2026-09-22", "14:40", at(15, 0))).toBe("Overdue by 20m");
  });
  it("returns null without a time or for another day", () => {
    expect(countdown("2026-09-22", "", at(15, 0))).toBeNull();
    expect(countdown("2026-09-23", "09:00", at(15, 0))).toBeNull();
  });
});

describe("formatAgo", () => {
  it("rounds down to the largest unit", () => {
    const now = 1_000_000_000_000;
    expect(formatAgo(now - 30_000, now)).toBe("just now");
    expect(formatAgo(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatAgo(now - 125 * 60_000, now)).toBe("2h ago");
    expect(formatAgo(now - 3 * 86_400_000, now)).toBe("3d ago");
  });
});

describe("formatTime", () => {
  it("formats 12- and 24-hour", () => {
    expect(formatTime("15:05")).toBe("3:05 PM");
    expect(formatTime("15:05", true)).toBe("15:05");
    expect(formatTime("09:00", true)).toBe("09:00");
    expect(formatTime("", true)).toBe("");
  });
});
