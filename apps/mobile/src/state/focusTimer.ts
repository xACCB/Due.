// The Focus tab's two timers as plain functions: the Pomodoro (work and break
// phases) and the stopwatch. Both are clock-based, like the web's: a running
// Pomodoro is its end time and a running stopwatch its start time, so they
// stay right while the phone is locked or the app is closed. The arithmetic
// is core's (lib/timers.ts). A function that finishes work time returns a
// `log` (minutes for a task) for the caller to record; this file never does.
import { pomodoroCreditMinutes, pomodoroFinishMinutes, secondsLeft, stopwatchTotal } from "@dueplanner/core/lib/timers";
import { stopwatchMinutes } from "@dueplanner/core/lib/stopwatch";

export type Phase = "work" | "break";

export interface FocusState {
  phase: Phase;
  endAt: number | null;    // running: when the phase ends
  secsLeft: number;        // not running: what's left of the phase
  credited: number;        // seconds of this work session already logged to a task
  taskId: number | null;   // the task the time goes to (null: the first open one)
  swStartedAt: number | null;
  swBanked: number;        // stopwatch ms from earlier runs
}

export interface Lengths { work: number; brk: number; autoBreak: boolean }
export interface Log { taskId: number; mins: number }
export interface Result { state: FocusState; log?: Log }

export function initialFocus(work: number): FocusState {
  return { phase: "work", endAt: null, secsLeft: work * 60, credited: 0, taskId: null, swStartedAt: null, swBanked: 0 };
}

// Whatever was saved, made safe to use (a bad value starts the timer afresh).
export function cleanFocus(raw: unknown, work: number): FocusState {
  const base = initialFocus(work);
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<FocusState>;
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
  return {
    phase: r.phase === "break" ? "break" : "work",
    endAt: num(r.endAt) ? r.endAt! : null,
    secsLeft: num(r.secsLeft) && r.secsLeft! >= 0 ? r.secsLeft! : base.secsLeft,
    credited: num(r.credited) && r.credited! >= 0 ? r.credited! : 0,
    taskId: num(r.taskId) ? r.taskId! : null,
    swStartedAt: num(r.swStartedAt) ? r.swStartedAt! : null,
    swBanked: num(r.swBanked) && r.swBanked! >= 0 ? r.swBanked! : 0,
  };
}

export const remaining = (s: FocusState, now: number): number => (s.endAt != null ? secondsLeft(s.endAt, now) : s.secsLeft);
export const phaseLength = (phase: Phase, L: Lengths): number => (phase === "work" ? L.work : L.brk) * 60;
// Untouched: sitting at the very start of its phase.
export const untouched = (s: FocusState, L: Lengths): boolean => s.endAt == null && s.secsLeft === phaseLength(s.phase, L);

export function start(s: FocusState, now: number): FocusState {
  if (s.endAt != null || s.secsLeft <= 0) return s;
  return { ...s, endAt: now + s.secsLeft * 1000 };
}

export function pause(s: FocusState, now: number): FocusState {
  if (s.endAt == null) return s;
  return { ...s, endAt: null, secsLeft: secondsLeft(s.endAt, now) };
}

// The not-yet-logged part of a work session, for when it stops early.
function credit(s: FocusState, now: number, L: Lengths, taskId: number | null): { credited: number; log?: Log } {
  if (s.phase !== "work" || taskId == null) return { credited: s.credited };
  const mins = pomodoroCreditMinutes(L.work, remaining(s, now), s.credited);
  return mins >= 1 ? { credited: s.credited + mins * 60, log: { taskId, mins } } : { credited: s.credited };
}

// When the running phase has ended: work logs what's left of it and moves to
// the break (starting it straight away with auto-start breaks, from the moment
// work ended); a finished break goes back to an untouched work phase.
export function finishIfDue(s: FocusState, now: number, L: Lengths, taskId: number | null): Result | null {
  if (s.endAt == null || now < s.endAt) return null;
  if (s.phase === "work") {
    const mins = pomodoroFinishMinutes(L.work, s.credited);
    const next: FocusState = { ...s, phase: "break", credited: 0, secsLeft: L.brk * 60, endAt: L.autoBreak ? s.endAt + L.brk * 60000 : null };
    return { state: next, log: taskId != null && mins >= 1 ? { taskId, mins } : undefined };
  }
  return { state: { ...s, phase: "work", credited: 0, secsLeft: L.work * 60, endAt: null } };
}

// Back to the start of a work phase, logging work time done so far.
export function reset(s: FocusState, now: number, L: Lengths, taskId: number | null): Result {
  const c = credit(s, now, L, taskId);
  return { state: { ...s, phase: "work", endAt: null, secsLeft: L.work * 60, credited: 0 }, log: c.log };
}

// Ends the phase now: work goes to its break (logging what was done), a break to work.
export function skipPhase(s: FocusState, now: number, L: Lengths, taskId: number | null): Result {
  if (s.phase === "work") {
    const c = credit(s, now, L, taskId);
    return { state: { ...s, phase: "break", endAt: null, secsLeft: L.brk * 60, credited: 0 }, log: c.log };
  }
  return { state: { ...s, phase: "work", endAt: null, secsLeft: L.work * 60, credited: 0 } };
}

// Switching task mid-session: the time so far goes to the task it was spent on.
export function switchTask(s: FocusState, now: number, L: Lengths, from: number | null, to: number): Result {
  if (from === to) return { state: s };
  const c = credit(s, now, L, from);
  return { state: { ...s, taskId: to, credited: c.credited }, log: c.log };
}

// Marking the focus task done from Focus (the web's creditPomodoro): the work
// time so far goes to it; the timer carries on.
export function creditTask(s: FocusState, now: number, L: Lengths, taskId: number | null): Result {
  const c = credit(s, now, L, taskId);
  return { state: { ...s, credited: c.credited }, log: c.log };
}

// A changed length moves the timer only if it's untouched at the start of that
// phase (core's lengthChangeResetsTimer); a paused or running one keeps its time.
export function applyLengths(s: FocusState, before: Lengths, after: Lengths): FocusState {
  return untouched(s, before) ? { ...s, secsLeft: phaseLength(s.phase, after) } : s;
}

// ---- Stopwatch ----

export const stopwatchMs = (s: FocusState, now: number): number => stopwatchTotal(s.swBanked, s.swStartedAt, now);
export const swStart = (s: FocusState, now: number): FocusState => (s.swStartedAt != null ? s : { ...s, swStartedAt: now });
export const swPause = (s: FocusState, now: number): FocusState =>
  s.swStartedAt == null ? s : { ...s, swBanked: stopwatchMs(s, now), swStartedAt: null };
export const swReset = (s: FocusState): FocusState => ({ ...s, swStartedAt: null, swBanked: 0 });

// "Log Xm to task": the stopwatch's time as one session, then it starts over.
export function swLog(s: FocusState, now: number, taskId: number | null): Result {
  const ms = stopwatchMs(s, now);
  if (taskId == null || ms < 1000) return { state: s };
  return { state: swReset(s), log: { taskId, mins: stopwatchMinutes(ms) } };
}
