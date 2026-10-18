// Which tasks a screen shows, in what order and in what groups, worked out
// from the task list alone. No React and no browser, so the website and a
// phone app give the same answers.
import type { Task } from "../types";
import { getPriority, formatDate } from "./format";
import { DUE_BUCKETS, dueBucket } from "./timeLeft";

// `justDone` (throughout): ids of tasks ticked a moment ago whose "completed"
// animation is still playing. Until it finishes they count as open: they keep
// their place, their rank and their column, so nothing moves twice.
export const heldOpen = (t: Task, justDone: number[]): boolean => !t.done || justDone.includes(t.id);
// Finished, and done animating: now it can move to wherever finished tasks go.
export const isSettled = (t: Task, justDone: number[]): boolean => t.done && !justDone.includes(t.id);
// The list with just-ticked tasks still shown as open (for the suggestion text).
export function withHeldOpen(tasks: Task[], justDone: number[]): Task[] {
  return justDone.length ? tasks.map(t => justDone.includes(t.id) ? { ...t, done: false } : t) : tasks;
}

// Every tag in use, once each, in alphabetical order.
export function allTagsOf(tasks: Task[]): string[] {
  return [...new Set(tasks.flatMap(t => t.tags || []))].sort();
}

// Open tasks in their manual order, then finished ones (also in manual order).
export function sortTasks(tasks: Task[], justDone: number[]): Task[] {
  return [...tasks].sort((a, b) => {
    const ad = isSettled(a, justDone), bd = isSettled(b, justDone);
    if (ad !== bd) return ad ? 1 : -1;
    return a.order - b.order;
  });
}

// The list for one view. `filter` is a chip ("all", "pending", "done",
// "archived") or "noest" (open tasks with no estimate, from Time left);
// `subject` narrows any of them to one subject ("" is "no subject", null is off).
// Archived tasks only ever show under "archived".
export function filterTasks(sorted: Task[], opts: { filter: string; subject: string | null; showDone: boolean; justDone: number[] }): Task[] {
  const { filter, subject, showDone, justDone } = opts;
  return sorted.filter(t => {
    if (subject != null && (t.subject || "") !== subject) return false;
    if (filter === "archived") return !!t.archived;
    if (t.archived) return false;
    if (filter === "done") return t.done;
    if (filter === "pending") return heldOpen(t, justDone);
    if (filter === "noest") return !t.done && !t.estMins;
    return showDone || heldOpen(t, justDone);
  });
}

// The List layout's "Group Tasks By": groups in the order they should show,
// each with its heading. Within a group tasks keep the order they came in.
export function groupTasks(tasks: Task[], groupBy: string): { key: string; label: string; tasks: Task[] }[] {
  const groups = new Map<string, Task[]>();
  const order: string[] = [];
  const keyFor = (t: Task) => {
    if (groupBy === "subject") return t.subject || "No subject";
    if (groupBy === "priority") return getPriority(t.dueDate, t.estMins, t.priorityOverride);
    return t.dueDate || "Anytime"; // dueDate; undated tasks group as "Anytime"
  };
  for (const t of tasks) {
    const k = keyFor(t);
    if (!groups.has(k)) { groups.set(k, []); order.push(k); }
    groups.get(k)!.push(t);
  }
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  if (groupBy === "priority") order.sort((a, b) => rank[a] - rank[b]);
  if (groupBy === "dueDate") order.sort((a, b) => a === "Anytime" ? 1 : b === "Anytime" ? -1 : a.localeCompare(b));
  const labelFor = (k: string) => {
    if (groupBy === "priority") return k === "high" ? "High priority" : k === "medium" ? "Medium priority" : "Low priority";
    if (groupBy === "dueDate") return k === "Anytime" ? k : formatDate(k);
    return k; // subject
  };
  return order.map(key => ({ key, label: labelFor(key), tasks: groups.get(key)! }));
}

// Kanban's columns and Pyramid's tiers: unsettled tasks by priority, and the settled ones.
export function prioritySplit(tasks: Task[], justDone: number[]): { high: Task[]; medium: Task[]; low: Task[]; done: Task[] } {
  const of = (p: string) => tasks.filter(t => !isSettled(t, justDone) && getPriority(t.dueDate, t.estMins, t.priorityOverride) === p);
  return { high: of("high"), medium: of("medium"), low: of("low"), done: tasks.filter(t => isSettled(t, justDone)) };
}

// "Time left": the open (not done, not archived) tasks' estimates, in total,
// per subject (largest first; no subject is "", `spent` is time actually
// logged on those tasks, `pct` the share of the total) and per due-date bucket
// (empty ones dropped). Tasks with no estimate count as 0, so they're counted
// separately to explain a total that reads low.
export function timeLeft(tasks: Task[], today: string) {
  const openTasks = tasks.filter(t => !t.done && !t.archived);
  const totalMins = openTasks.reduce((s, t) => s + (t.estMins || 0), 0);
  const m: Record<string, { mins: number; spent: number }> = {};
  openTasks.forEach(t => { const e = m[t.subject || ""] ||= { mins: 0, spent: 0 }; e.mins += t.estMins || 0; e.spent += (t.sessions || []).reduce((a, x) => a + x.mins, 0); });
  const bySubject = Object.entries(m).filter(([, e]) => e.mins > 0).sort((a, b) => b[1].mins - a[1].mins)
    .map(([name, e]) => ({ name, ...e, pct: totalMins ? Math.round(e.mins / totalMins * 100) : 0 }));
  const byDue = DUE_BUCKETS.map(b => { const ts = openTasks.filter(t => dueBucket(t.dueDate, today) === b.key); return { ...b, count: ts.length, mins: ts.reduce((s, t) => s + (t.estMins || 0), 0) }; })
    .filter(b => b.count > 0);
  return { openTasks, totalMins, bySubject, byDue, noEstimateCount: openTasks.filter(t => !t.estMins).length };
}

// Search: `q` is the typed text, already trimmed and lower-cased. Matches the
// title, the subject or a tag; never archived tasks; open ones first; 50 at most.
export const SEARCH_MAX = 50;
export function searchTasks(tasks: Task[], q: string): Task[] {
  return !q ? [] : tasks
    .filter(t => !t.archived && (t.title.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q) || (t.tags || []).some(g => g.toLowerCase().includes(q))))
    .sort((a, b) => a.done !== b.done ? (a.done ? 1 : -1) : a.order - b.order)
    .slice(0, SEARCH_MAX);
}

// Profile's completion ring: how many are done, in total, urgent and still open, and the share done.
export function completionStats(tasks: Task[]): { done: number; total: number; urgent: number; pct: number } {
  const done = tasks.filter(t => t.done).length;
  const total = tasks.length;
  const urgent = tasks.filter(t => !t.done && getPriority(t.dueDate, t.estMins, t.priorityOverride) === "high").length;
  return { done, total, urgent, pct: total > 0 ? Math.round(done / total * 100) : 0 };
}
