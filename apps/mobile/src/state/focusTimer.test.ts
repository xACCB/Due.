import { describe, expect, it } from "vitest";
import * as F from "./focusTimer";

const L: F.Lengths = { work: 25, brk: 5, autoBreak: true };
const T0 = 1_000_000;
const min = 60_000;

describe("focus timer", () => {
  it("starts, pauses and resumes against the clock", () => {
    let s = F.initialFocus(25);
    expect(F.remaining(s, T0)).toBe(1500);
    s = F.start(s, T0);
    expect(F.remaining(s, T0 + 10 * min)).toBe(900);
    s = F.pause(s, T0 + 10 * min);
    expect(s.endAt).toBeNull();
    expect(F.remaining(s, T0 + 60 * min)).toBe(900); // paused: the clock doesn't matter
    s = F.start(s, T0 + 60 * min);
    expect(F.remaining(s, T0 + 65 * min)).toBe(600);
    expect(F.start(s, T0)).toBe(s); // already running
  });

  it("finishing work logs the session and starts the break from when work ended", () => {
    const s = F.start(F.initialFocus(25), T0);
    expect(F.finishIfDue(s, T0 + 24 * min, L, 7)).toBeNull();
    const r = F.finishIfDue(s, T0 + 30 * min, L, 7)!; // app reopened 5 minutes late
    expect(r.log).toEqual({ taskId: 7, mins: 25 });
    expect(r.state.phase).toBe("break");
    expect(r.state.endAt).toBe(T0 + 30 * min); // 25 + 5
    const r2 = F.finishIfDue(r.state, T0 + 31 * min, L, 7)!;
    expect(r2.state).toMatchObject({ phase: "work", endAt: null, secsLeft: 1500 });
    expect(r2.log).toBeUndefined();
  });

  it("without auto-start breaks, the break waits", () => {
    const r = F.finishIfDue(F.start(F.initialFocus(25), T0), T0 + 25 * min, { ...L, autoBreak: false }, 7)!;
    expect(r.state).toMatchObject({ phase: "break", endAt: null, secsLeft: 300 });
  });

  it("time already credited isn't logged twice", () => {
    let s = F.start(F.initialFocus(25), T0);
    const sw = F.switchTask(s, T0 + 10 * min, L, 1, 2);
    expect(sw.log).toEqual({ taskId: 1, mins: 10 });
    s = sw.state;
    expect(s.taskId).toBe(2);
    const fin = F.finishIfDue(s, T0 + 25 * min, L, 2)!;
    expect(fin.log).toEqual({ taskId: 2, mins: 15 });
  });

  it("reset and skip log the work done so far, under a minute logs nothing", () => {
    const s = F.start(F.initialFocus(25), T0);
    expect(F.reset(s, T0 + 12 * min, L, 3).log).toEqual({ taskId: 3, mins: 12 });
    expect(F.reset(s, T0 + 20_000, L, 3).log).toBeUndefined();
    expect(F.reset(s, T0 + 12 * min, L, 3).state).toMatchObject({ phase: "work", endAt: null, secsLeft: 1500, credited: 0 });
    const sk = F.skipPhase(s, T0 + 5 * min, L, 3);
    expect(sk.log).toEqual({ taskId: 3, mins: 5 });
    expect(sk.state).toMatchObject({ phase: "break", secsLeft: 300 });
    expect(F.skipPhase(sk.state, T0, L, 3).state.phase).toBe("work");
    expect(F.reset(s, T0 + 12 * min, L, null).log).toBeUndefined(); // no task to log to
  });

  it("a length change moves only an untouched timer", () => {
    const s = F.initialFocus(25);
    const after = { ...L, work: 50 };
    expect(F.applyLengths(s, L, after).secsLeft).toBe(3000);
    const paused = F.pause(F.start(s, T0), T0 + min);
    expect(F.applyLengths(paused, L, after)).toBe(paused);
  });

  it("stopwatch: runs, banks, logs whole minutes and starts over", () => {
    let s = F.swStart(F.initialFocus(25), T0);
    s = F.swPause(s, T0 + 2 * min);
    s = F.swStart(s, T0 + 10 * min);
    expect(F.stopwatchMs(s, T0 + 13 * min)).toBe(5 * min);
    const r = F.swLog(s, T0 + 13 * min, 9);
    expect(r.log).toEqual({ taskId: 9, mins: 5 });
    expect(r.state).toMatchObject({ swStartedAt: null, swBanked: 0 });
    expect(F.swLog(F.initialFocus(25), T0, 9).log).toBeUndefined();
  });

  it("cleans saved state", () => {
    expect(F.cleanFocus(null, 25)).toEqual(F.initialFocus(25));
    expect(F.cleanFocus({ phase: "nap", secsLeft: -3, endAt: "x", taskId: 4 }, 25)).toMatchObject({ phase: "work", secsLeft: 1500, endAt: null, taskId: 4 });
  });
});
