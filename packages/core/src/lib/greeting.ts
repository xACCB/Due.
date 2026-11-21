// The greeting at the top of Home: "Good evening, 3 things left today", with
// the first name when signed in ("Good evening, Aaron. 3 things left today").
// "Left today" counts open tasks due today or already overdue (archived ones
// aside), whatever the filter shows. Settings -> Task list -> Show greeting
// turns it off.
import type { Task } from "../types";

export type PartOfDay = "morning" | "afternoon" | "evening";

// Morning from 5am, afternoon from noon, evening from 5pm (and through the night).
export function partOfDay(hour: number): PartOfDay {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  return "evening";
}

// Open tasks due today or earlier.
export function leftToday(tasks: readonly Task[], today: string): number {
  return tasks.filter(t => !t.done && !t.archived && !!t.dueDate && t.dueDate <= today).length;
}

// The first word of a display name, if it has one.
export function firstName(name: string | null | undefined): string {
  return (name ?? "").trim().split(/\s+/)[0] ?? "";
}

export function greeting(hour: number, left: number, name?: string | null): string {
  const hello = `Good ${partOfDay(hour)}`;
  const first = firstName(name);
  const rest = left === 0 ? "nothing left for today" : `${left} ${left === 1 ? "thing" : "things"} left today`;
  return first ? `${hello}, ${first}. ${rest[0].toUpperCase()}${rest.slice(1)}` : `${hello}, ${rest}`;
}
