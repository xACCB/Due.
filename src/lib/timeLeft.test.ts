import { describe, it, expect } from "vitest";
import { dueBucket, mostUrgent } from "./timeLeft";

describe("dueBucket", () => {
  const today = "2026-09-22";
  it("buckets relative to today", () => {
    expect(dueBucket("", today)).toBe("none");
    expect(dueBucket("2026-09-21", today)).toBe("overdue");
    expect(dueBucket("2026-09-22", today)).toBe("today");
    expect(dueBucket("2026-09-23", today)).toBe("tomorrow");
    expect(dueBucket("2026-09-28", today)).toBe("week");
    expect(dueBucket("2026-09-29", today)).toBe("later");
  });
  it("handles month and year boundaries", () => {
    expect(dueBucket("2027-01-01", "2026-12-31")).toBe("tomorrow");
  });
});

describe("mostUrgent", () => {
  it("prefers earliest date, then time, then order; undated last", () => {
    const t = (id: number, dueDate: string, dueTime: string, order: number) => ({ id, dueDate, dueTime, order });
    expect(mostUrgent([t(1, "", "", 0), t(2, "2026-09-25", "", 5), t(3, "2026-09-25", "09:00", 9)])?.id).toBe(3);
    expect(mostUrgent([t(1, "2026-09-25", "", 2), t(2, "2026-09-25", "", 1)])?.id).toBe(2);
    expect(mostUrgent([])).toBeUndefined();
  });
});
