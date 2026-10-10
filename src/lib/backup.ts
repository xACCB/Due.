// Getting data out of the app and back in: the JSON backup, the CSV of tasks,
// merging a backup into what's already here, and turning a scanned syllabus
// into tasks. Plain functions; saving a file or reading one is the caller's job.
import type { Task, TaskTemplate } from "../types";
import { csvField, getPriority } from "./format";
import { nextId } from "./id";
import { LIMITS, sanitizeTask } from "./limits";
import { nextOrder } from "./tasks";

// The CSV export: one row per task, with the priority the app would show.
export function tasksCsv(tasks: Task[]): string {
  const headers = ["title", "subject", "dueDate", "dueTime", "estMins", "done", "priority", "tags", "recurrence"];
  const rows = tasks.map(t => [
    t.title, t.subject, t.dueDate, t.dueTime, t.estMins, t.done ? "yes" : "no",
    getPriority(t.dueDate, t.estMins, t.priorityOverride),
    (t.tags || []).join("; "), t.recurrence || "none",
  ].map(csvField).join(","));
  return [headers.join(","), ...rows].join("\n");
}

// What a backup file holds that can be merged in, or null if it isn't one.
// - fresh: its tasks that aren't here yet (same id = already here), cleaned up
//   to the limits the cloud enforces and placed after the existing ones.
// - skipped: how many of its tasks were already here.
// - extraSubjects: subjects it has that aren't here (ignoring case), or null if it lists none.
// - colors: its subject colours, or null. templates: its templates as found, or null.
export type BackupContents = { fresh: Task[]; skipped: number; extraSubjects: string[] | null; colors: Record<string, string> | null; templates: unknown[] | null };
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a parsed file of unknown shape, checked field by field
export function readBackup(data: any, tasks: Task[], subjects: string[]): BackupContents | null {
  const raw: unknown[] = Array.isArray(data?.tasks) ? data.tasks : [];
  const incoming: Task[] = raw.filter((t): t is Task => !!t && typeof (t as Task).id === "number" && typeof (t as Task).title === "string")
    .map(t => sanitizeTask(t as unknown as Record<string, unknown>) as unknown as Task);
  if (incoming.length === 0 && !Array.isArray(data?.subjects)) return null;
  const have = new Set(tasks.map(t => t.id));
  const base = nextOrder(tasks);
  const fresh = incoming.filter(t => !have.has(t.id)).map((t, i) => ({ ...t, order: base + i }));
  const extraSubjects = Array.isArray(data?.subjects)
    ? (data.subjects as unknown[]).filter((s): s is string => typeof s === "string" && !subjects.some(x => x.toLowerCase() === s.toLowerCase()))
    : null;
  const colors = data?.subjectColors && typeof data.subjectColors === "object"
    ? Object.fromEntries(Object.entries(data.subjectColors).filter(([, v]) => typeof v === "string")) as Record<string, string>
    : null;
  return { fresh, skipped: incoming.length - fresh.length, extraSubjects, colors, templates: Array.isArray(data?.templates) ? data.templates : null };
}
// Imported subjects go after the existing ones, names and list both kept within the limits.
export function withImportedSubjects(subjects: string[], extra: string[]): string[] {
  return [...subjects, ...extra.map(x => x.slice(0, LIMITS.subject))].slice(0, LIMITS.subjects);
}
// Existing colours win; the map stays within the profile's cap.
export function withImportedColors(colors: Record<string, string>, imported: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries({ ...colors, ...Object.fromEntries(Object.entries(imported).filter(([k]) => !(k in colors))) }).slice(0, LIMITS.subjects));
}
// Templates not already here (by id), ignoring anything that isn't shaped like one.
export function withImportedTemplates(templates: TaskTemplate[], imported: unknown[]): TaskTemplate[] {
  const ids = new Set(templates.map(t => t.id));
  return [...templates, ...(imported as TaskTemplate[]).filter(t => t && typeof t.id === "string" && typeof t.name === "string" && !ids.has(t.id))];
}

// Tasks from a scanned syllabus, added after the existing ones in the order found.
export function withSyllabusTasks(tasks: Task[], items: { title: string; dueDate: string }[], subject: string): Task[] {
  return [
    ...tasks,
    ...items.map((it, i): Task => ({ id: nextId(), title: it.title, subject, dueDate: it.dueDate, dueTime: "", estMins: 0, done: false, order: nextOrder(tasks) + i })),
  ];
}
