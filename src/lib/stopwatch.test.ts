import { describe, it, expect } from "vitest";
import { formatStopwatch, stopwatchMinutes, normalizeFocusShow, focusShowFor, showsPomodoro, showsStopwatch } from "./stopwatch";

describe("formatStopwatch", () => {
  it("shows minutes and seconds", () => {
    expect(formatStopwatch(0)).toBe("00:00");
    expect(formatStopwatch(999)).toBe("00:00");
    expect(formatStopwatch(65_000)).toBe("01:05");
    expect(formatStopwatch(59*60_000+59_000)).toBe("59:59");
  });
  it("adds hours past an hour", () => {
    expect(formatStopwatch(3_600_000)).toBe("1:00:00");
    expect(formatStopwatch(3_600_000+125_000)).toBe("1:02:05");
  });
  it("never goes negative", () => {
    expect(formatStopwatch(-500)).toBe("00:00");
  });
});

describe("stopwatchMinutes", () => {
  it("rounds to whole minutes, at least one", () => {
    expect(stopwatchMinutes(10_000)).toBe(1);
    expect(stopwatchMinutes(89_000)).toBe(1);
    expect(stopwatchMinutes(90_000)).toBe(2);
    expect(stopwatchMinutes(25*60_000)).toBe(25);
  });
});

describe("focus show setting", () => {
  it("falls back to everything for an unknown value", () => {
    expect(normalizeFocusShow("task")).toBe("task");
    expect(normalizeFocusShow("nope")).toBe("all");
    expect(normalizeFocusShow(null)).toBe("all");
  });
  it("maps two switches to the stored value and back", () => {
    for (const p of [true, false]) for (const s of [true, false]) {
      const v = focusShowFor(p, s);
      expect([showsPomodoro(v), showsStopwatch(v)]).toEqual([p, s]);
    }
    expect(focusShowFor(false, false)).toBe("task");
    expect(focusShowFor(true, true)).toBe("all");
  });
  it("says which timers each option shows", () => {
    expect([showsPomodoro("task"),showsStopwatch("task")]).toEqual([false,false]);
    expect([showsPomodoro("task-stopwatch"),showsStopwatch("task-stopwatch")]).toEqual([false,true]);
    expect([showsPomodoro("task-pomodoro"),showsStopwatch("task-pomodoro")]).toEqual([true,false]);
    expect([showsPomodoro("all"),showsStopwatch("all")]).toEqual([true,true]);
  });
});
