import { describe, expect, it } from "vitest";
import { dragDelta } from "./reorder";

describe("dragDelta", () => {
  const h = [80, 100, 60, 80];
  it("stays put until past half of the neighbour", () => {
    expect(dragDelta(h, 0, 49)).toBe(0);
    expect(dragDelta(h, 0, 51)).toBe(1);
    expect(dragDelta(h, 2, -49)).toBe(0);
    expect(dragDelta(h, 2, -51)).toBe(-1);
  });
  it("passes several cards, and stops at the ends", () => {
    expect(dragDelta(h, 0, 100 + 31)).toBe(2);
    expect(dragDelta(h, 0, 5000)).toBe(3);
    expect(dragDelta(h, 3, -5000)).toBe(-3);
    expect(dragDelta(h, 1, 0)).toBe(0);
  });
});
