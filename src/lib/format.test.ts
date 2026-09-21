import { describe, it, expect } from "vitest";
import { getPriority, csvField, daysUntil, contrastColor } from "./format";

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
    expect(daysUntil("2000-01-01")).toBe("Overdue");
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
