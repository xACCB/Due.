// The sidebar's subject list: each subject with its open tasks nested under it.

export type SubjectGroup<T> = { name: string; tasks: T[] };

type GroupableTask = { subject: string; dueDate: string; dueTime?: string; order: number; done: boolean; archived?: boolean };

// How many tasks an unfolded subject shows before its "Show all" row.
export const SIDEBAR_TASK_CAP = 8;

// One group per subject, in the user's own subject order, each holding its open
// (not done, not archived) tasks, most urgent first: earliest due date, then
// earliest due time, then manual order, with undated tasks last (the same
// order as mostUrgent() in timeLeft.ts). A subject with nothing open is still
// listed, so the list doesn't reshuffle as work gets finished. Subjects that
// only exist on tasks (deleted from Settings since) follow, and tasks with no
// subject come last under the name "", and only when there are any.
export function subjectGroups<T extends GroupableTask>(tasks: T[], subjects: string[]): SubjectGroup<T>[] {
  const open = tasks.filter(t => !t.done && !t.archived).sort((a, b) =>
    (a.dueDate || "9999").localeCompare(b.dueDate || "9999")
    || (a.dueTime || "99").localeCompare(b.dueTime || "99")
    || a.order - b.order);
  const names = [...new Set([...subjects, ...open.map(t => t.subject || "")])].filter(n => n !== "");
  const groups = names.map(name => ({ name, tasks: open.filter(t => t.subject === name) }));
  const loose = open.filter(t => !t.subject);
  return loose.length ? [...groups, { name: "", tasks: loose }] : groups;
}

// A due date in a couple of words, for a narrow row: "Overdue", "Today",
// "Tomorrow", else the day and month. "" for no date. Dates are local
// YYYY-MM-DD strings, as everywhere else.
export function dueShort(dueDate: string, today: string): string {
  if (!dueDate) return "";
  if (dueDate < today) return "Overdue";
  if (dueDate === today) return "Today";
  const days = Math.round((new Date(dueDate + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime()) / 86400000);
  if (days === 1) return "Tomorrow";
  return new Date(dueDate + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
