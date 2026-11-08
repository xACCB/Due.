// Which reminders are owed right now, worked out from the tasks, the reminder
// settings and what has already been sent. Plain functions: showing a
// notification, and remembering what was sent, is up to the caller (the
// website uses the Notification API and browser storage; a phone app would
// schedule native notifications from the same answers).
import type { Task } from "../types";
import { REMINDER_OFFSETS } from "../constants";
import { formatDate, formatDuration, formatTime } from "./format";

export type ReminderNote = { title: string; body: string };
// Keys of reminders already sent: `${taskId}-${offsetKey}-${dueDate}T${dueTime}`,
// so changing a task's due date or time makes its reminders owed again.
export type SentReminders = Record<string, true>;

// "At due time" can still fire this long after the due time; without the
// grace its window (due time to due time) would be empty and it never could.
const AT_DUE_GRACE_MS = 15 * 60000;

// "now", "in 20 min", "in 3h", "in 2 days": how far off a due time is.
export function dueIn(minsLeft: number): string {
  const daysLeft = Math.round(minsLeft / 1440);
  return minsLeft <= 0 ? "now" : minsLeft < 60 ? `in ${minsLeft} min` : minsLeft < 1440 ? `in ${formatDuration(minsLeft)}` : `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
}
// The reminder for a task with a due time, `minsLeft` before it's due.
function timedNote(t: Task, minsLeft: number, h24: boolean): ReminderNote {
  return { title: `"${t.title}" is due ${dueIn(minsLeft)}`, body: `${formatDate(t.dueDate)} at ${formatTime(t.dueTime, h24)}` };
}

// The once-a-day summary of what's due or overdue, or null if there's nothing
// to say. Tasks with a due time get their own offset reminders, so the summary
// only covers date-only tasks, unless every offset is off or the task is
// already overdue by date.
export function dailySummary(tasks: Task[], today: string, enabledOffsets: string[]): ReminderNote | null {
  const due = tasks.filter(t => !t.done && !t.archived && t.dueDate && t.dueDate <= today && (!t.dueTime || enabledOffsets.length === 0 || t.dueDate < today));
  if (due.length === 0) return null;
  return { title: due.length === 1 ? `"${due[0].title}" is due` : `${due.length} tasks due or overdue`, body: due.slice(0, 3).map(t => t.title).join(", ") };
}

// Offset reminders ("1 day before", "1 hour before", "at due time"), for tasks
// with a due time. Returns the notifications to show now and the updated
// record of what's been sent (`changed` says whether it needs saving).
// For each task only the closest reminder that has come due is shown; earlier,
// now-stale ones are just marked sent, so opening the app 30 minutes before a
// deadline gives one reminder, not three. Records for tasks that are finished,
// deleted or rescheduled are dropped, since they can never match again.
export function offsetReminders(tasks: Task[], enabledOffsets: string[], alreadySent: SentReminders, now: number, h24: boolean): { notes: ReminderNote[]; sent: SentReminders; changed: boolean } {
  const sent: SentReminders = { ...alreadySent };
  const notes: ReminderNote[] = [];
  let changed = false;
  for (const t of tasks) {
    if (t.done || t.archived || !t.dueDate || !t.dueTime) continue;
    const dueAt = new Date(`${t.dueDate}T${t.dueTime}`).getTime();
    const eligible = REMINDER_OFFSETS.filter(o => enabledOffsets.includes(o.key) && now >= dueAt - o.mins * 60000 && now < dueAt + (o.mins === 0 ? AT_DUE_GRACE_MS : 0));
    if (eligible.length === 0) continue;
    const sentKey = (o: typeof REMINDER_OFFSETS[number]) => `${t.id}-${o.key}-${t.dueDate}T${t.dueTime}`;
    const closest = eligible.reduce((a, b) => b.mins < a.mins ? b : a);
    if (!sent[sentKey(closest)]) {
      notes.push(timedNote(t, Math.round((dueAt - now) / 60000), h24));
    }
    for (const o of eligible) { if (!sent[sentKey(o)]) { sent[sentKey(o)] = true; changed = true; } }
  }
  const live = tasks.filter(t => !t.done && !t.archived && t.dueDate && t.dueTime).map(t => [`${t.id}-`, `-${t.dueDate}T${t.dueTime}`]);
  for (const k of Object.keys(sent)) {
    if (!live.some(([pre, post]) => k.startsWith(pre) && k.endsWith(post))) { delete sent[k]; changed = true; }
  }
  return { notes, sent, changed };
}

// ---- Scheduled ahead (the phone app) ----
// A phone can schedule notifications to fire later with the app closed, so
// instead of "what is owed now" it asks "what will be owed, and when". The
// same reminders as above, worked out in advance:
// - a task with a due time: one per enabled offset, at due time minus the
//   offset, worded as offsetReminders would word it at that moment;
// - date-only tasks (and timed ones when every offset is off, as in
//   dailySummary): one summary per due date, at `summaryHour` that morning.
// Only future ones, soonest first, at most `max` (iOS keeps 64 pending per app).
export type ScheduledReminder = ReminderNote & { id: string; at: number };

export function upcomingReminders(tasks: Task[], enabledOffsets: string[], now: number, h24: boolean, opts: { summaryHour?: number; max?: number } = {}): ScheduledReminder[] {
  const { summaryHour = 8, max = 60 } = opts;
  const out: ScheduledReminder[] = [];
  const byDay = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.done || t.archived || !t.dueDate) continue;
    if (t.dueTime && enabledOffsets.length) {
      const dueAt = new Date(`${t.dueDate}T${t.dueTime}`).getTime();
      if (Number.isNaN(dueAt)) continue;
      for (const o of REMINDER_OFFSETS) {
        if (!enabledOffsets.includes(o.key)) continue;
        const at = dueAt - o.mins * 60000;
        if (at > now) out.push({ id: `rem-${t.id}-${o.key}`, at, ...timedNote(t, o.mins, h24) });
      }
    } else {
      const list = byDay.get(t.dueDate);
      if (list) list.push(t); else byDay.set(t.dueDate, [t]);
    }
  }
  for (const [day, list] of byDay) {
    const at = new Date(`${day}T${String(summaryHour).padStart(2, "0")}:00`).getTime();
    if (Number.isNaN(at) || at <= now) continue;
    out.push({
      id: `rem-day-${day}`, at,
      title: list.length === 1 ? `"${list[0].title}" is due today` : `${list.length} tasks due today`,
      body: list.slice(0, 3).map(t => t.title).join(", "),
    });
  }
  return out.sort((a, b) => a.at - b.at).slice(0, max);
}
