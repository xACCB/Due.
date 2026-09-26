// The "New task questions" setting: which of the add-task questions are asked,
// and in what order (the title is always asked first and isn't part of this).
// Stored in localStorage as a list of {key, on}.

export interface QuestionPref { key: string; on: boolean; }

// Turns whatever was saved into a clean list covering exactly `keys`: saved
// order and on/off state are kept, unknown or repeated keys are dropped, and a
// question the saved list doesn't mention (e.g. one added in a later version)
// goes at the end, turned on.
export function normalizeQuestionPrefs(raw: unknown, keys: readonly string[]): QuestionPref[] {
  const out: QuestionPref[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw)) {
    for (const p of raw) {
      const key = (p as QuestionPref)?.key;
      if (typeof key !== "string" || !keys.includes(key) || seen.has(key)) continue;
      seen.add(key);
      out.push({ key, on: (p as QuestionPref).on !== false });
    }
  }
  for (const key of keys) if (!seen.has(key)) out.push({ key, on: true });
  return out;
}

// Moves the question at `index` by `delta` places (clamped to the list).
export function moveQuestion(prefs: QuestionPref[], index: number, delta: number): QuestionPref[] {
  const to = Math.max(0, Math.min(prefs.length - 1, index + delta));
  if (index < 0 || index >= prefs.length || to === index) return prefs;
  const next = [...prefs];
  const [item] = next.splice(index, 1);
  next.splice(to, 0, item);
  return next;
}
