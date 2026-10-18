import { describe, it, expect } from "vitest";
import { parseSyllabus } from "./syllabus";

describe("parseSyllabus", () => {
  it("parses an ISO date line", () => {
    const [item] = parseSyllabus("2025-03-14 Essay due");
    expect(item.dueDate).toBe("2025-03-14");
    expect(item.title).toBe("Essay due");
  });
  it("parses an M/D date line", () => {
    const [item] = parseSyllabus("Lab Report - 3/14");
    expect(item.dueDate.endsWith("-03-14")).toBe(true);
    expect(item.title).toBe("Lab Report");
  });
  it("parses a 'Month D, YYYY' date line", () => {
    const [item] = parseSyllabus("Reading Response due March 14, 2025");
    expect(item.dueDate).toBe("2025-03-14");
  });
  it("skips blank lines and lines with no recognizable date", () => {
    const items = parseSyllabus("\nNo date here\n2025-03-14 Quiz\n");
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Quiz");
  });
  it("falls back to a placeholder title when the line is only a date", () => {
    const [item] = parseSyllabus("2025-03-14");
    expect(item.title).toBe("Untitled assignment");
  });
  it("truncates titles over 100 characters", () => {
    const long = "x".repeat(150);
    const [item] = parseSyllabus(`2025-03-14 ${long}`);
    expect(item.title.length).toBeLessThanOrEqual(100);
    expect(item.title.endsWith("...")).toBe(true);
  });
  it("ignores impossible dates instead of rolling them over", () => {
    expect(parseSyllabus("Quiz 13/45")).toEqual([]);
    expect(parseSyllabus("Essay due Feb 30, 2026")).toEqual([]);
    expect(parseSyllabus("2026-02-30 Project")).toEqual([]);
  });
});
