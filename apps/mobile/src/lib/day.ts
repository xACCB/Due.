import type { Task } from "@dueplanner/core/types";

// A day's tasks: open first, then by due time, then manual order (the web's
// sortDay, in CalendarView and DueDeck).
export const sortDay = (list: Task[]): Task[] =>
  list.slice().sort((a, b) => (a.done !== b.done ? (a.done ? 1 : -1) : (a.dueTime || "99").localeCompare(b.dueTime || "99") || a.order - b.order));

// "In 3 days", "Yesterday"... from `iso` relative to `today` (local dates).
export function relativeDay(iso: string, today: string): string {
  const ms = (s: string) => new Date(s + "T00:00:00").getTime();
  const diff = Math.round((ms(iso) - ms(today)) / 86400000);
  return diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday" : diff > 0 ? `In ${diff} days` : `${-diff} days ago`;
}
