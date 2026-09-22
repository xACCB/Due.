import { describe, it, expect } from "vitest";
import { diffTasks, applyTaskStates } from "./history";

type T = { id: number; done: boolean };

describe("diffTasks / applyTaskStates", () => {
  const a = { id: 1, done: false }, b = { id: 2, done: false };
  it("round-trips a change, an addition and a removal", () => {
    const prev: T[] = [a, b];
    const next: T[] = [{ id: 1, done: true }, { id: 3, done: false }]; // 1 edited, 2 removed, 3 added
    const { before, after } = diffTasks(prev, next);
    expect(before.map(([id]) => id).sort()).toEqual([1, 2, 3]);
    expect(applyTaskStates(next, before)).toEqual(prev);
    expect(applyTaskStates(prev, after)).toEqual(next);
  });
  it("leaves unrelated tasks alone", () => {
    const { before } = diffTasks<T>([a, b], [{ id: 1, done: true }, b]);
    const later: T[] = [{ id: 1, done: true }, { id: 2, done: true }]; // 2 changed afterwards
    expect(applyTaskStates(later, before)).toEqual([a, { id: 2, done: true }]);
  });
});
