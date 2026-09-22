// Size limits shared by the app and firestore.rules. The rules reject any
// synced write over these, so the app has to stay inside them too -- otherwise
// the change saves locally but is silently refused by the cloud and the
// devices drift apart. Keep the numbers here and in firestore.rules in step
// (tests/firestore.rules.test.ts checks the rules side at these values).
export const LIMITS = {
  title: 500,
  subject: 200,
  subjects: 200,      // subjects per account (profile doc)
  subtasks: 100,      // per task
  tags: 30,           // per task
  sessions: 1000,     // logged work sessions per task; oldest drop off
  estMins: 100000,
} as const;

const RECURRENCES = ["none", "daily", "weekly", "monthly"];
const PRIORITIES = ["high", "medium", "low"];

// Appends a work session, keeping only the newest LIMITS.sessions.
export function addSession<S>(sessions: S[] | undefined, s: S): S[] {
  return [...(sessions || []), s].slice(-LIMITS.sessions);
}

// Brings a task from outside the app (a JSON backup, possibly hand-edited)
// inside the limits and formats the rules enforce: strings trimmed to length,
// dates/times that aren't YYYY-MM-DD / HH:MM dropped, numbers clamped, lists
// cut to size, unknown enum values removed.
export function sanitizeTask<T extends Record<string, unknown>>(t: T): T {
  const out: Record<string, unknown> = { ...t };
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
  out.title = str(t.title, LIMITS.title);
  out.subject = str(t.subject, LIMITS.subject);
  out.dueDate = typeof t.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate) ? t.dueDate : "";
  out.dueTime = out.dueDate && typeof t.dueTime === "string" && /^\d{2}:\d{2}$/.test(t.dueTime) ? t.dueTime : "";
  out.estMins = typeof t.estMins === "number" && Number.isFinite(t.estMins) ? Math.min(LIMITS.estMins, Math.max(0, Math.round(t.estMins))) : 0;
  out.done = !!t.done;
  for (const [key, max] of [["subtasks", LIMITS.subtasks], ["tags", LIMITS.tags], ["sessions", LIMITS.sessions]] as const) {
    if (key in t) {
      const v = t[key];
      if (Array.isArray(v)) out[key] = key === "sessions" ? v.slice(-max) : v.slice(0, max);
      else delete out[key];
    }
  }
  if ("recurrence" in t && !RECURRENCES.includes(t.recurrence as string)) delete out.recurrence;
  if ("priorityOverride" in t && !PRIORITIES.includes(t.priorityOverride as string)) delete out.priorityOverride;
  return out as T;
}
