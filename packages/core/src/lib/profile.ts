// The synced "profile" fields (users/{uid}): the settings that follow the
// account rather than the device. The same list as PROFILE_FIELDS in
// limits.ts and profileFields() in firestore.rules, less schemaVersion.
// The website's profile listener does these checks inline in App.tsx; the
// phone (apps/mobile/src/lib/profileSync.ts) uses these.
import { DEFAULT_SUBJECT_COLORS, LAYOUTS } from "../constants";
import { migrateProfile, SCHEMA_VERSION } from "./migrations";

export type Profile = {
  layout: string;
  colorCodeUrgency: boolean;
  subjects: string[];
  subjectColors: Record<string, string>;
  timeFormat: "12h" | "24h";
  weekStart: 0 | 1;
};

export const PROFILE_KEYS = ["layout", "colorCodeUrgency", "subjects", "subjectColors", "timeFormat", "weekStart"] as const satisfies readonly (keyof Profile)[];

// What a cloud profile doc says, brought up to this app's version, keeping
// only fields of the right shape (the doc is untyped: an old app, a bug or a
// hand edit in the console could hold anything). Missing or malformed fields
// are left out, so the device keeps its own value for them. Colours merge over
// the defaults, as the website does.
export function readProfile(raw: Record<string, unknown>): Partial<Profile> {
  const d = migrateProfile(raw, raw.schemaVersion);
  const out: Partial<Profile> = {};
  if (typeof d.layout === "string" && d.layout in LAYOUTS) out.layout = d.layout;
  if (typeof d.colorCodeUrgency === "boolean") out.colorCodeUrgency = d.colorCodeUrgency;
  if (d.timeFormat === "12h" || d.timeFormat === "24h") out.timeFormat = d.timeFormat;
  if (d.weekStart === 0 || d.weekStart === 1) out.weekStart = d.weekStart;
  if (Array.isArray(d.subjects) && d.subjects.every(s => typeof s === "string")) out.subjects = d.subjects as string[];
  if (d.subjectColors && typeof d.subjectColors === "object" && !Array.isArray(d.subjectColors)
    && Object.values(d.subjectColors).every(v => typeof v === "string")) {
    out.subjectColors = { ...DEFAULT_SUBJECT_COLORS, ...(d.subjectColors as Record<string, string>) };
  }
  return out;
}

// The doc the website writes (a merge write of every field plus the version).
export function profileDoc(p: Profile): Record<string, unknown> {
  return {
    layout: p.layout, colorCodeUrgency: p.colorCodeUrgency, subjects: p.subjects,
    subjectColors: p.subjectColors, timeFormat: p.timeFormat, weekStart: p.weekStart,
    schemaVersion: SCHEMA_VERSION,
  };
}

// Whether two profiles hold the same values. Subjects compare in order
// (their order is the user's); colours by key, whatever the key order.
export function sameProfile(a: Partial<Profile>, b: Partial<Profile>): boolean {
  return PROFILE_KEYS.every(k => {
    const x = a[k], y = b[k];
    if (k === "subjectColors") {
      const cx = (x ?? {}) as Record<string, string>, cy = (y ?? {}) as Record<string, string>;
      const keys = new Set([...Object.keys(cx), ...Object.keys(cy)]);
      return x === undefined ? y === undefined : y !== undefined && [...keys].every(c => cx[c] === cy[c]);
    }
    if (k === "subjects") {
      const sx = x as string[] | undefined, sy = y as string[] | undefined;
      return sx === sy || (!!sx && !!sy && sx.length === sy.length && sx.every((s, i) => s === sy[i]));
    }
    return x === y;
  });
}
