// Profiles: separate lists inside one account (Homework, Sports, anything the
// user names). The app starts with none, and then works as it always has.
// Once there are some, the sidebar switches between "All" and each one: a
// profile shows only its own tasks, and a task added while one is showing
// belongs to it. Tasks from before profiles, or added under "All", belong to
// none and show only under "All". Deleting a profile keeps its tasks: they go
// back to belonging to none.
//
// The list of names syncs with the account (the profile doc's `profiles`),
// like subjects; which one is showing is this device's own (`hw-profile`).
// A task holds the name (`Task.profile`), so a rename would carry to tasks
// the way a subject rename does.
import type { Task } from "../types";
import { LIMITS, oneLine } from "./limits";

// The ready-made names offered as chips when adding one.
export const PROFILE_PRESETS = ["Homework", "Sports"] as const;

// The trimmed name to add, or null if it's empty, already there (ignoring
// case) or the list is full.
export function profileToAdd(name: string, profiles: readonly string[]): string | null {
  const trimmed = oneLine(name).trim().slice(0, LIMITS.profileName);
  if (!trimmed || profiles.length >= LIMITS.profiles) return null;
  if (profiles.some(p => p.toLowerCase() === trimmed.toLowerCase())) return null;
  return trimmed;
}

// The presets not added yet, for the chips.
export function presetsLeft(profiles: readonly string[]): string[] {
  return PROFILE_PRESETS.filter(p => !profiles.some(x => x.toLowerCase() === p.toLowerCase()));
}

// Which profile is showing, as saved on this device: null is "All". A saved
// name that's no longer in the list (deleted on another device) is "All".
export function currentProfile(saved: unknown, profiles: readonly string[]): string | null {
  return typeof saved === "string" && profiles.includes(saved) ? saved : null;
}

// Whether a task shows under the current profile.
export function inProfile(task: Pick<Task, "profile">, current: string | null): boolean {
  return current == null || task.profile === current;
}

// A new task's profile field: the one showing, or none under "All".
export function profileFor(current: string | null): { profile?: string } {
  return current == null ? {} : { profile: current };
}

// Tasks added in bulk (a syllabus import) join the profile showing too: those
// in `next` that weren't in `prev` get it.
export function newTasksJoin(prev: readonly Task[], next: Task[], current: string | null): Task[] {
  if (current == null) return next;
  const had = new Set(prev.map(t => t.id));
  return next.map(t => (had.has(t.id) ? t : { ...t, profile: current }));
}

// Deleting a profile: its tasks keep everything but the profile.
export function withoutProfile<T extends Pick<Task, "profile">>(tasks: T[], name: string): T[] {
  return tasks.map(t => {
    if (t.profile !== name) return t;
    const { profile: _gone, ...rest } = t;
    void _gone;
    return rest as T;
  });
}

// How many tasks a profile holds (for the delete confirmation).
export function profileCount(tasks: readonly Pick<Task, "profile">[], name: string): number {
  return tasks.filter(t => t.profile === name).length;
}
