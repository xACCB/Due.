// The arithmetic behind the three timers (the Pomodoro, the stopwatch and a
// task's work session): how much time is left or has passed, and how many
// minutes get logged to a task. All three are clock-based -- they compare
// against a fixed start or end time instead of counting ticks -- because
// browsers slow or pause timers in background tabs and on locked screens.
// Starting, stopping and redrawing the timers stays with the app.
import type { Task } from "../types";
import { addSession } from "./limits";

// Whole seconds until `endAt` (rounded up, so "25:00" shows for the first second), never below zero.
export const secondsLeft = (endAt: number, now: number): number => Math.max(0, Math.ceil((endAt - now) / 1000));
// Whole seconds since `startedAt`.
export const secondsSince = (startedAt: number, now: number): number => Math.floor((now - startedAt) / 1000);

// The stopwatch's total: what earlier runs banked, plus the current run if it's going.
export const stopwatchTotal = (banked: number, startedAt: number | null, now: number): number =>
  startedAt == null ? banked : banked + now - startedAt;

// A finished focus session is logged at its full length, less whatever part of
// it was already logged along the way (`creditedSecs`).
export const pomodoroFinishMinutes = (workMins: number, creditedSecs: number): number =>
  Math.max(0, Math.round((workMins * 60 - creditedSecs) / 60));
// An unfinished one: the part of the session so far that hasn't been logged
// yet, in whole minutes. Under 1 means there's nothing worth logging.
export const pomodoroCreditMinutes = (workMins: number, secsLeft: number, creditedSecs: number): number =>
  Math.round((workMins * 60 - secsLeft - creditedSecs) / 60);
// Changing a phase's length only moves the timer if it's sitting untouched at
// the start of that phase; a paused session keeps its remaining time.
export const lengthChangeResetsTimer = (active: boolean, phase: string, changedPhase: string, secs: number, currentMins: number): boolean =>
  !active && phase === changedPhase && secs === currentMins * 60;

// A task's work session: under 5 seconds is a mis-tap and logs nothing (null);
// otherwise whole minutes, at least one.
export const sessionMinutes = (secs: number): number | null => secs < 5 ? null : Math.max(1, Math.round(secs / 60));

// The list with a work session of `mins` (ended at `at`) logged on one task.
export function withSession(tasks: Task[], id: number, mins: number, at: number): Task[] {
  return tasks.map(t => t.id === id ? { ...t, sessions: addSession(t.sessions, { mins, at }) } : t);
}
