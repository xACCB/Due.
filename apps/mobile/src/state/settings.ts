// The phone's settings: the same `hw-*` keys, defaults and meanings as the web
// app's (App.tsx), so a value means the same on both and M3 can sync the
// profile fields unchanged. Each comes with a cleaner that turns whatever was
// stored into a valid value. Plain TypeScript, unit tested.
import { DEFAULT_SUBJECTS, DEFAULT_SUBJECT_COLORS, REMINDER_OFFSETS } from "@dueplanner/core/constants";
import { LIMITS, oneLine } from "@dueplanner/core/lib/limits";

export const bool = (fallback: boolean) => (raw: unknown): boolean => (typeof raw === "boolean" ? raw : fallback);

export const int = (fallback: number, min: number, max: number) => (raw: unknown): number =>
  typeof raw === "number" && Number.isFinite(raw) ? Math.max(min, Math.min(max, Math.round(raw))) : fallback;

export const oneOf = <T extends string>(options: readonly T[], fallback: T) => (raw: unknown): T =>
  (options as readonly unknown[]).includes(raw) ? (raw as T) : fallback;

export function cleanSubjects(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [...DEFAULT_SUBJECTS];
  const out: string[] = [];
  for (const s of raw) {
    if (typeof s !== "string") continue;
    const name = oneLine(s).trim().slice(0, LIMITS.subject);
    if (name && !out.includes(name)) out.push(name);
  }
  return out.slice(0, LIMITS.subjects);
}

// The web merges saved colours over the defaults (hw-subjectcolors).
export function cleanSubjectColors(raw: unknown): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULT_SUBJECT_COLORS };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw)) if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) out[k] = v;
  }
  return out;
}

const OFFSET_KEYS = REMINDER_OFFSETS.map(o => o.key) as string[];
export function cleanOffsets(raw: unknown): string[] {
  return Array.isArray(raw) ? OFFSET_KEYS.filter(k => raw.includes(k)) : ["0"];
}

export const THEME_MODES = ["auto", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
export const TIME_FORMATS = ["12h", "24h"] as const;
export const FOCUS_SHOWS = ["task", "task-stopwatch", "task-pomodoro", "all"] as const;

// Key, default and cleaner for each setting (web defaults).
export const SETTINGS = {
  themeMode: { key: "hw-thememode", initial: "auto" as ThemeMode, clean: oneOf(THEME_MODES, "auto") },
  colorCodeUrgency: { key: "hw-colorcode-urgency", initial: true as boolean, clean: bool(true) },
  timeFormat: { key: "hw-timeformat", initial: "12h" as "12h" | "24h", clean: oneOf(TIME_FORMATS, "12h") },
  weekStart: { key: "hw-weekstart", initial: 0 as number, clean: int(0, 0, 1) },
  calendarMonthOnly: { key: "hw-calendar-month-only", initial: true as boolean, clean: bool(true) },
  showDone: { key: "hw-showdone", initial: true as boolean, clean: bool(true) },
  notifications: { key: "hw-notifications", initial: false as boolean, clean: bool(false) },
  reminderOffsets: { key: "hw-reminder-offsets", initial: ["0"] as string[], clean: cleanOffsets },
  pomodoroWork: { key: "hw-pomodoro-work", initial: 25 as number, clean: int(25, 1, 180) },
  pomodoroBreak: { key: "hw-pomodoro-break", initial: 5 as number, clean: int(5, 1, 60) },
  pomodoroAutoBreak: { key: "hw-pomodoro-autobreak", initial: true as boolean, clean: bool(true) },
  focusShow: { key: "hw-focus-show", initial: "all" as (typeof FOCUS_SHOWS)[number], clean: oneOf(FOCUS_SHOWS, "all") },
  addQuestions: { key: "hw-add-questions", initial: null as unknown, clean: (raw: unknown) => raw },
  subjects: { key: "hw-subjects", initial: [...DEFAULT_SUBJECTS] as string[], clean: cleanSubjects },
  subjectColors: { key: "hw-subjectcolors", initial: { ...DEFAULT_SUBJECT_COLORS } as Record<string, string>, clean: cleanSubjectColors },
} as const;
