// Feature flags (Firebase Remote Config): turn a feature on gradually, or off
// quickly if something breaks, without a deploy. Web-only (it loads the
// Remote Config SDK).
//
// Adding a flag:
// 1. Add it to FLAG_DEFAULTS with the value the app should use when Remote
//    Config hasn't answered (first load, offline, emulator mode, blocked).
// 2. Read it through useFlags() (src/hooks/useFlags.ts), or getFlags() outside React.
// 3. Optionally add a parameter with the same name in the Firebase console
//    (Remote Config); until then the default is used everywhere.
//
// Values are fetched once the app is idle and at most once an hour; each load
// starts from the defaults and switches when the fetch lands.
export const FLAG_DEFAULTS = {
  // Profile -> Devices: a device signs itself out when its entry is removed
  // from the device list. The kill switch for that, should it ever misfire.
  devicesAutoSignOut: true,
};
export type Flags = typeof FLAG_DEFAULTS;

let current: Flags = { ...FLAG_DEFAULTS };
const listeners = new Set<() => void>();

export function getFlags(): Flags { return current; }
export function subscribeFlags(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// Remote Config values arrive as strings; a flag keeps its default's type, and
// its default when the value can't be read as one.
export function readFlags(get: (key: string) => string | undefined): Flags {
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(FLAG_DEFAULTS) as [string, unknown][]) {
    const raw = get(key);
    if (typeof def === "boolean") out[key] = raw === "true" ? true : raw === "false" ? false : def;
    else if (typeof def === "number") out[key] = raw !== undefined && raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : def;
    else out[key] = raw ?? def;
  }
  return out as Flags;
}

export function startFlags(app: import("firebase/app").FirebaseApp): void {
  const load = () => {
    import("firebase/remote-config").then(async ({ getRemoteConfig, fetchAndActivate, getAll }) => {
      const rc = getRemoteConfig(app);
      rc.settings.minimumFetchIntervalMillis = 3600000;
      rc.defaultConfig = FLAG_DEFAULTS;
      await fetchAndActivate(rc);
      const all = getAll(rc);
      // Only values set in the console count; anything else keeps its default.
      const next = readFlags(key => (all[key] && all[key].getSource() === "remote" ? all[key].asString() : undefined));
      if (JSON.stringify(next) !== JSON.stringify(current)) { current = next; listeners.forEach(fn => fn()); }
    }).catch(() => { /* offline, blocked or unavailable: the defaults stand */ });
  };
  if ("requestIdleCallback" in window) requestIdleCallback(load, { timeout: 8000 });
  else setTimeout(load, 4000);
}
