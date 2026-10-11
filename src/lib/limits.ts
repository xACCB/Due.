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
  tag: 100,           // characters in one tag (the rules cap the total: tags x tag)
  sessions: 1000,     // logged work sessions per task; oldest drop off
  estMins: 100000,
  tasks: 5000,        // per account, via the counter doc in firestore.rules
  trash: 500,         // Recently deleted entries per account (the app keeps 200)
  devices: 20,        // signed-in devices listed per account; the longest idle drop off
} as const;

const RECURRENCES = ["none", "daily", "weekly", "monthly"];
const PRIORITIES = ["high", "medium", "low"];

// Text as a one-line field would hold it: line breaks become spaces. The rules
// refuse a tag or subject name with a line break in it (see allText() there).
export function oneLine(s: string): string { return s.replace(/[\r\n]+/g, " "); }

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
      // Tags are text on one line, each within the length the tag field allows
      // (the rules refuse a new task whose tags run too long in total, hold
      // something that isn't text, or contain a line break).
      if (Array.isArray(v) && key === "tags") out[key] = v.filter(g => typeof g === "string").slice(0, max).map(g => oneLine(g as string).slice(0, LIMITS.tag));
      else if (Array.isArray(v)) out[key] = key === "sessions" ? v.slice(-max) : v.slice(0, max);
      else delete out[key];
    }
  }
  if ("recurrence" in t && !RECURRENCES.includes(t.recurrence as string)) delete out.recurrence;
  if ("priorityOverride" in t && !PRIORITIES.includes(t.priorityOverride as string)) delete out.priorityOverride;
  return out as T;
}
