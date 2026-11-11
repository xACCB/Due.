import * as Notifications from "expo-notifications";
import type { Task } from "@dueplanner/core/types";
import { upcomingReminders } from "@dueplanner/core/lib/reminders";
import { clock } from "./clock";

// Local notifications, scheduled on the phone: they fire with the app closed,
// no server involved (docs/mobile-plan.md, "Reminders"). What to schedule
// comes from core's upcomingReminders(); this file only talks to iOS/Android.

// Shown as a banner even while the app is open.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

// Our identifiers: reminders start "rem-" (from core), the Focus timer's end is FOCUS_END_ID.
export const FOCUS_END_ID = "focus-end";
const isReminder = (id: string) => id.startsWith("rem-");

export async function notificationsAllowed(): Promise<boolean> {
  const s = await Notifications.getPermissionsAsync();
  return s.granted;
}

// Asks iOS for permission (the system prompt shows once; after that it only reports).
export async function requestNotifications(): Promise<boolean> {
  const s = await Notifications.getPermissionsAsync();
  if (s.granted) return true;
  if (!s.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

// Replaces every scheduled reminder with what the tasks call for now. Cheap
// enough to run after any change (it's debounced by the caller), and simpler
// to get right than working out which ones changed. Runs one at a time: two
// overlapping passes could leave a reminder the newer one meant to remove.
let queue: Promise<void> = Promise.resolve();
export function syncReminders(tasks: Task[], on: boolean, offsets: string[], h24: boolean): Promise<void> {
  queue = queue.then(() => resync(tasks, on, offsets, h24)).catch(() => {});
  return queue;
}

async function resync(tasks: Task[], on: boolean, offsets: string[], h24: boolean): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(scheduled.filter(n => isReminder(n.identifier)).map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  if (!on || !(await notificationsAllowed())) return;
  // 62, not 64: iOS keeps at most 64 pending per app, and the Focus timer needs one.
  for (const r of upcomingReminders(tasks, offsets, clock(), h24, { max: 62 })) {
    await Notifications.scheduleNotificationAsync({
      identifier: r.id,
      content: { title: r.title, body: r.body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at },
    });
  }
}

// The Focus timer's "time's up", for when the app is in the background or closed.
export async function scheduleFocusEnd(at: number, title: string, body: string): Promise<void> {
  await cancelFocusEnd();
  if (!(await notificationsAllowed())) return;
  await Notifications.scheduleNotificationAsync({
    identifier: FOCUS_END_ID,
    // The web chimes when a session or break ends (playChime); here iOS plays
    // its notification sound, in the app (the handler allows sounds) and out.
    content: { title, body, sound: "default" },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
  });
}

export async function cancelFocusEnd(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(FOCUS_END_ID).catch(() => {});
}
