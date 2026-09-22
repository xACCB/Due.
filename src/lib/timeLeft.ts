// Helpers behind the header's "Time left" dropdown.

export type DueBucket = "overdue" | "today" | "tomorrow" | "week" | "later" | "none";

export const DUE_BUCKETS: { key: DueBucket; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "today", label: "Due today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "week", label: "This week" },
  { key: "later", label: "Later" },
  { key: "none", label: "No date" },
];

// Which bucket a due date falls in, relative to `today` (a local YYYY-MM-DD).
// "This week" is the rest of the next seven days, not the calendar week.
export function dueBucket(dueDate: string, today: string): DueBucket {
  if (!dueDate) return "none";
  // Math.round: across a DST change two local midnights are 23h or 25h apart.
  const d = Math.round((new Date(dueDate + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400000);
  if (d < 0) return "overdue";
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d < 7) return "week";
  return "later";
}

// The task to work on first: earliest due date, then earliest due time, then
// manual order. No date / no time sort last.
export function mostUrgent<T extends { dueDate: string; dueTime?: string; order: number }>(tasks: T[]): T | undefined {
  return [...tasks].sort((a, b) =>
    (a.dueDate || "9999").localeCompare(b.dueDate || "9999")
    || (a.dueTime || "99").localeCompare(b.dueTime || "99")
    || a.order - b.order)[0];
}
