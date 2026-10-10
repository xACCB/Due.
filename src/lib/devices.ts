// The "Devices" list in Profile: which devices are signed in to an account, and
// signing the others out. Stored as one map in users/{uid}/meta/devices
// ({ d: { [deviceId]: DeviceEntry } }), capped by firestore.rules.
//
// Signing a device out means removing its entry: every device watches the map
// and signs itself out when the server says its entry is gone. That is a
// request the app honours, not a lock the cloud enforces -- a web app has no
// way to cancel another device's Google sign-in without a server -- so the
// device signs out the next time it has the app open and online.

export type DeviceEntry = { name: string; createdAt: number; lastSeen: number };
export type DeviceMap = Record<string, DeviceEntry>;

// How long before a device refreshes its "last active" time. Long, so an open
// app costs about one small write a day rather than one per visit.
export const DEVICE_TOUCH_MS = 12 * 60 * 60 * 1000;

// What this device should do, given the map the SERVER just confirmed (never a
// cached or still-saving copy -- the caller checks that):
// - "register": it has never been confirmed in the list for this account, so add it.
// - "signOut": it was in the list and no longer is (or its entry is a leftover
//   stub with no name, from a "last active" write racing a removal): someone
//   signed it out from another device.
// - "touch": it's listed, and its "last active" time is stale.
// `registered` is this device's own note that the server has confirmed its
// entry for this account. It must only be set after that confirmation; set
// any earlier, a device whose first write never arrived would read its own
// absence as being signed out.
export function deviceAction(registered: boolean, entry: Partial<DeviceEntry> | undefined, now: number): "register" | "signOut" | "touch" | "none" {
  if (!registered) return "register";
  if (!entry || typeof entry.name !== "string" || !entry.name) return "signOut";
  if (typeof entry.lastSeen !== "number" || now - entry.lastSeen > DEVICE_TOUCH_MS) return "touch";
  return "none";
}

// Ids to drop so that adding `keepId` leaves at most `max` devices: the ones
// that have gone longest without being active. Never drops `keepId`.
export function pruneDevices(map: DeviceMap, keepId: string, max: number): string[] {
  const others = Object.keys(map).filter(id => id !== keepId);
  const over = others.length + 1 - max;
  if (over <= 0) return [];
  return others.sort((a, b) => (map[a]?.lastSeen || 0) - (map[b]?.lastSeen || 0)).slice(0, over);
}

// For the list: this device first, then most recently active. Entries without
// a name (stubs, see deviceAction) are left out.
export function listDevices(map: DeviceMap, thisId: string): { id: string; entry: DeviceEntry; current: boolean }[] {
  return Object.entries(map)
    .filter(([, e]) => e && typeof e.name === "string" && e.name)
    .map(([id, entry]) => ({ id, entry, current: id === thisId }))
    .sort((a, b) => Number(b.current) - Number(a.current) || (b.entry.lastSeen || 0) - (a.entry.lastSeen || 0));
}

// "Chrome on Windows", "Safari on iPhone", "DuePlanner app on Android": enough
// to tell your devices apart, from the browser's own description of itself.
// `touchPoints` tells an iPad (which calls itself a Mac) from a real Mac.
export function describeDevice(userAgent: string, touchPoints: number, standalone: boolean): string {
  const ua = userAgent;
  const os = /iPhone|iPod/.test(ua) ? "iPhone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1) ? "iPad"
    : /Android/.test(ua) ? "Android"
    : /CrOS/.test(ua) ? "Chromebook"
    : /Windows/.test(ua) ? "Windows"
    : /Macintosh|Mac OS X/.test(ua) ? "Mac"
    : /Linux/.test(ua) ? "Linux"
    : "this device";
  // Order matters: Edge and Opera also say "Chrome", and Chrome also says "Safari".
  const browser = /Edg(e|A|iOS)?\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /Firefox\/|FxiOS\//.test(ua) ? "Firefox"
    : /Chrome\/|CriOS\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "Browser";
  return `${standalone ? "DuePlanner app" : browser} on ${os}`.slice(0, 60);
}

// A random id for this device: letters and digits only, since it's used as a
// field name in the map (a dot would be read as a path separator).
export function newDeviceId(): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}
