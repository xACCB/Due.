import { describe, expect, it } from "vitest";
import type { Task } from "../types";
import { LIMITS } from "./limits";
import {
  lengthChangeResetsTimer, pomodoroCreditMinutes, pomodoroFinishMinutes, secondsLeft, secondsSince,
  sessionMinutes, stopwatchTotal, withSession,
} from "./timers";

const task = (id: number, extra: Partial<Task> = {}): Task =>
  ({ id, title: `Task ${id}`, subject: "", dueDate: "", dueTime: "", estMins: 0, done: false, order: id, ...extra });

describe("clock arithmetic", () => {
  it("counts down to a fixed end, rounding up and stopping at zero", () => {
    expect(secondsLeft(10_000, 0)).toBe(10);
    expect(secondsLeft(10_000, 1)).toBe(10);
    expect(secondsLeft(10_000, 9_001)).toBe(1);
    expect(secondsLeft(10_000, 10_000)).toBe(0);
    expect(secondsLeft(10_000, 60_000)).toBe(0);
  });
  it("counts up from a fixed start in whole seconds", () => {
    expect(secondsSince(1_000, 1_999)).toBe(0);
    expect(secondsSince(1_000, 66_500)).toBe(65);
  });
  it("adds the current run to what the stopwatch has banked", () => {
    expect(stopwatchTotal(5_000, null, 99_999)).toBe(5_000);
    expect(stopwatchTotal(5_000, 10_000, 12_500)).toBe(7_500);
  });
});

describe("Pomodoro minutes", () => {
  it("a finished session logs its full length, less what was already logged", () => {
    expect(pomodoroFinishMinutes(25, 0)).toBe(25);
    expect(pomodoroFinishMinutes(25, 10 * 60)).toBe(15);
    expect(pomodoroFinishMinutes(25, 25 * 60)).toBe(0);
    expect(pomodoroFinishMinutes(25, 99 * 60)).toBe(0);
  });
  it("an unfinished one logs the unlogged part so far; under half a minute rounds to nothing", () => {
    expect(pomodoroCreditMinutes(25, 25 * 60, 0)).toBe(0);
    expect(pomodoroCreditMinutes(25, 25 * 60 - 29, 0)).toBe(0);
    expect(pomodoroCreditMinutes(25, 25 * 60 - 30, 0)).toBe(1);
    expect(pomodoroCreditMinutes(25, 15 * 60, 0)).toBe(10);
    expect(pomodoroCreditMinutes(25, 15 * 60, 6 * 60)).toBe(4);
  });
  it("a new length only resets a timer sitting untouched at the start of that phase", () => {
    expect(lengthChangeResetsTimer(false, "work", "work", 25 * 60, 25)).toBe(true);
    expect(lengthChangeResetsTimer(true, "work", "work", 25 * 60, 25)).toBe(false);  // running
    expect(lengthChangeResetsTimer(false, "break", "work", 25 * 60, 25)).toBe(false); // other phase
    expect(lengthChangeResetsTimer(false, "work", "work", 20 * 60, 25)).toBe(false); // paused part-way
  });
});

describe("work sessions", () => {
  it("ignores a session under 5 seconds and logs at least one minute otherwise", () => {
    expect(sessionMinutes(4)).toBeNull();
    expect(sessionMinutes(5)).toBe(1);
    expect(sessionMinutes(89)).toBe(1);
    expect(sessionMinutes(90)).toBe(2);
    expect(sessionMinutes(25 * 60)).toBe(25);
  });
  it("logs a session on one task only, after any it already has", () => {
    const before = [task(1, { sessions: [{ mins: 5, at: 1 }] }), task(2)];
    const after = withSession(before, 1, 20, 99);
    expect(after[0].sessions).toEqual([{ mins: 5, at: 1 }, { mins: 20, at: 99 }]);
    expect(after[1]).toBe(before[1]);
    expect(before[0].sessions).toHaveLength(1);
    expect(withSession(before, 2, 3, 7)[1].sessions).toEqual([{ mins: 3, at: 7 }]);
  });
  it("keeps only the newest sessions past the limit", () => {
    const full = task(1, { sessions: Array.from({ length: LIMITS.sessions }, (_, i) => ({ mins: 1, at: i })) });
    const after = withSession([full], 1, 9, 123456);
    expect(after[0].sessions).toHaveLength(LIMITS.sessions);
    expect(after[0].sessions![LIMITS.sessions - 1]).toEqual({ mins: 9, at: 123456 });
  });
});
