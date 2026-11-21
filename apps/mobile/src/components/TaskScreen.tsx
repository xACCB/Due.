import { useEffect, useRef, useState, type ReactNode, type ComponentRef } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams, type ErrorBoundaryProps } from "expo-router";
import type { Priority, Recurrence, Task } from "@dueplanner/core/types";
import { DIFFICULTIES } from "@dueplanner/core/types";
import { contrastColor, countdown, formatDate, formatDuration, formatTime, getPriority, ink } from "@dueplanner/core/lib/format";
import { localDateStr, todayISO } from "@dueplanner/core/lib/dates";
import { secondsSince, sessionMinutes } from "@dueplanner/core/lib/timers";
import { skipPatch, snoozePatch, templateFromTask } from "@dueplanner/core/lib/taskActions";
import { snoozeTarget, type SnoozeKind } from "@dueplanner/core/lib/tasks";
import { allTagsOf } from "@dueplanner/core/lib/taskViews";
import { priColor } from "@dueplanner/core/constants";
import { LIMITS, oneLine } from "@dueplanner/core/lib/limits";
import { nextId } from "@dueplanner/core/lib/id";
import { useApp } from "../state/appContext";
import { useNow } from "../lib/useNow";
import { clock } from "../lib/clock";
import { F } from "../theme/fonts";
import type { Theme } from "../theme/types";
import { ClearLink, DateField, SelectField, TextField } from "./WebFields";
import { UndoToast } from "./UndoToast";
import { useDevAction, useDevScroll } from "../lib/devScroll";
import { AppHeader, BackButton } from "./AppHeader";
import { ScreenBody } from "./ScreenBody";
import { SafeAreaView } from "react-native-safe-area-context";

// A task, as the web's TaskModal shows it, in its two forms:
// - the page (`page`, opened from the sidebar, route task/[id]): the website's
//   header and "‹ Home", and the edit card always open; a field saves when you
//   leave it, a choice at once, so each change is one undo step;
// - the sheet (route task-sheet/[id], opened from Home, Calendar, Search and
//   Time left): read first, with Edit (the same card, plus the title, saved in
//   one step with Save), Snooze, and ×.
// Subtask ticks, tags and the priority override aren't undo steps, as on the web.

const REPEATS: { label: string; value: Recurrence }[] = [
  { label: "Doesn't repeat", value: "none" }, { label: "Daily", value: "daily" }, { label: "Weekly", value: "weekly" }, { label: "Monthly", value: "monthly" },
];

// What the edit card holds while you type (the web's TaskDraft).
type Draft = { title: string; subject: string; dueDate: string; dueTime: string; estH: string; estM: string; recurrence: Recurrence };
const draftOf = (t: Task): Draft => ({
  title: t.title, subject: t.subject, dueDate: t.dueDate, dueTime: t.dueTime,
  estH: t.estMins ? String(Math.floor(t.estMins / 60)) : "", estM: t.estMins ? String(t.estMins % 60) : "", recurrence: t.recurrence ?? "none",
});
const draftMins = (d: Draft) => Math.min(LIMITS.estMins, (parseInt(d.estH, 10) || 0) * 60 + (parseInt(d.estM, 10) || 0));
// The web sheet's Snooze choices (core's snoozeTarget).
const SNOOZES: [SnoozeKind, string][] = [["later", "In 3 hours"], ["tomorrow", "Tomorrow"], ["week", "Next week"]];
// The web's order: Auto, then Low to High, each in its priority colour.
const PRIORITIES: (Priority | null)[] = [null, "low", "medium", "high"];

// A task that fails to render shows this instead of taking the app down (the
// web's fallback around TaskModal).
export function TaskCrash({ error }: ErrorBoundaryProps) {
  const { T, fz } = useApp();
  useEffect(() => { console.error(error); }, [error]);
  return (
    <View style={[styles.gone, { backgroundColor: T.bg }]}>
      <View style={[styles.crashCard, { backgroundColor: T.card, borderColor: T.border }]}>
        <Text style={{ fontFamily: F.body, fontSize: fz(14), color: T.text, textAlign: "center" }}>This task couldn&apos;t be displayed.</Text>
        <Pressable onPress={() => router.back()} accessibilityRole="button" style={[styles.crashBtn, { backgroundColor: T.accent }]}>
          <Text style={{ fontFamily: F.body, fontSize: fz(13), color: contrastColor(T.accent) }}>Close</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function TaskScreen({ page }: { page: boolean }) {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useApp();
  const task = app.tasks.find(t => String(t.id) === id);
  if (!task) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: app.T.bg }} edges={["top", "left", "right"]}>
      {page && <AppHeader title="Task" />}
      <View style={[styles.gone, { backgroundColor: app.T.bg }]}>
        {page && <BackButton />}
        <Text style={[styles.label, { color: app.T.textMuted }]}>This task isn&apos;t here any more.</Text>
        <Pressable onPress={() => router.back()} accessibilityRole="button" style={[styles.wideBtn, { borderColor: app.T.border, alignSelf: "stretch" }]}>
          <Text style={[styles.btnText, { color: app.T.text }]}>Back</Text>
        </Pressable>
      </View>
      </SafeAreaView>
    );
  }
  return <TaskForm task={task} page={page} />;
}

function TaskForm({ task, page }: { task: Task; page: boolean }) {
  const app = useApp();
  const { T, h24, fz } = app;
  const { subjects, subjectColors, colorCodeUrgency } = app.settings;
  const edit = (patch: Partial<Task>) => app.edit(task.id, patch);
  const quiet = (patch: Partial<Task>) => app.quiet(task.id, patch);
  // The web's toast for Snooze and Skip: what happened, with Undo.
  const say = app.sayUndo; // the app-wide undo toast
  const snooze = (kind: SnoozeKind) => {
    const after = snoozePatch(task, snoozeTarget(kind));
    app.edit(task.id, after, `snooze "${task.title}"`);
    say(`"${task.title}" snoozed to ${formatDate(after.dueDate)}${after.dueTime ? ` ${formatTime(after.dueTime, h24)}` : ""}`);
  };
  const skipOne = () => {
    const after = skipPatch(task, todayISO());
    app.edit(task.id, after, `skip "${task.title}"`);
    say(`"${task.title}" skipped to ${formatDate(after.dueDate)}`);
  };

  // The edit card's draft. On the page it's always open and follows the task
  // whenever its saved values change (undo, another screen); in the sheet it
  // exists only between Edit and Save/Cancel.
  const sig = JSON.stringify(draftOf(task));
  const [draft, setDraft] = useState<Draft | null>(() => (page ? draftOf(task) : null));
  const [seenSig, setSeenSig] = useState(sig);
  if (sig !== seenSig) { setSeenSig(sig); if (page) setDraft(draftOf(task)); }
  // Saves what changed, as one undo step; a title can't be emptied.
  const commit = (d: Draft | null = draft) => {
    if (!d) return;
    const title = oneLine(d.title).trim().slice(0, LIMITS.title) || task.title;
    const next: Partial<Task> = { title, subject: d.subject, dueDate: d.dueDate, dueTime: d.dueDate ? d.dueTime : "", estMins: draftMins(d), recurrence: d.recurrence };
    const was: Partial<Task> = { title: task.title, subject: task.subject, dueDate: task.dueDate, dueTime: task.dueTime, estMins: task.estMins, recurrence: task.recurrence ?? "none" };
    const patch = Object.fromEntries(Object.entries(next).filter(([k, v]) => was[k as keyof Task] !== v)) as Partial<Task>;
    if (Object.keys(patch).length) edit(patch);
    if (page) setDraft(draftOf({ ...task, ...patch })); // tidies the fields (e.g. 90 minutes shows as 1 and 30)
  };
  const change = (patch: Partial<Draft>, now?: boolean) => {
    if (!draft) return;
    const d = { ...draft, ...patch };
    setDraft(d);
    if (page && now) commit(d);
  };
  const close = () => (router.canGoBack() ? router.back() : router.navigate("/"));
  useDevAction("task-edit", () => setDraft(draftOf(task))); // development only: the sheet's Edit
  const [subtask, setSubtask] = useState("");
  const [tag, setTag] = useState("");
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [templateSaved, setTemplateSaved] = useState(false);

  // The work-session timer (the web's): counts up from a fixed start, so time
  // with the phone locked still counts. Ending it logs a session on the task;
  // so does leaving the page while it runs (the web's leaveTaskPage).
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const now = useNow(startedAt != null ? 1000 : 60000); // every second only while a session runs
  const secs = startedAt == null ? 0 : secondsSince(startedAt, now);
  const running = useRef<{ at: number | null; log: (mins: number, at: number) => void }>({ at: null, log: () => {} });
  useEffect(() => { running.current = { at: startedAt, log: (m, at) => app.logSession(task.id, m, at) }; });
  useEffect(() => () => {
    const r = running.current;
    if (r.at == null) return;
    const m = sessionMinutes(secondsSince(r.at, clock()));
    if (m != null) r.log(m, clock());
  }, []);
  const endSession = () => {
    if (startedAt == null) return;
    const m = sessionMinutes(secondsSince(startedAt, clock()));
    setStartedAt(null);
    if (m != null) app.logSession(task.id, m, clock());
  };
  const sh = Math.floor(secs / 3600), sm = Math.floor((secs % 3600) / 60), ss = secs % 60;
  const today = localDateStr(new Date(now));
  const sessionsToday = (task.sessions ?? []).filter(x => localDateStr(new Date(x.at)) === today).map(x => {
    const d = new Date(x.at);
    return { mins: x.mins, time: formatTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`, h24) };
  });
  const totalToday = sessionsToday.reduce((n, x) => n + x.mins, 0);
  const suggestions = allTagsOf(app.tasks).filter(t => !(task.tags ?? []).includes(t)).slice(0, 8);

  const subtasks = task.subtasks ?? [];
  const tags = task.tags ?? [];
  const pr = getPriority(task.dueDate, task.estMins, task.priorityOverride);
  const prColor = priColor(pr, colorCodeUrgency);
  const sc = subjectColors[task.subject] || T.accent;
  const due = task.done ? null : countdown(task.dueDate, task.dueTime, now);

  const addSubtask = () => {
    const text = oneLine(subtask).trim().slice(0, LIMITS.title);
    if (!text || subtasks.length >= LIMITS.subtasks) return;
    edit({ subtasks: [...subtasks, { id: String(nextId()), text, done: false }] });
    setSubtask("");
  };
  const addTag = () => {
    const t = oneLine(tag).trim().slice(0, LIMITS.tag);
    if (!t || tags.length >= LIMITS.tags || tags.includes(t)) { setTag(""); return; }
    quiet({ tags: [...tags, t] });
    setTag("");
  };

  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  useDevScroll(scrollRef); // development only: the dev remote's "scroll"
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: T.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <SafeAreaView style={{ flex: 1 }} edges={page ? ["top", "left", "right"] : ["left", "right"]}>
      {page && <AppHeader title="Task" />}
      {/* The page's content settles in under a still header, as the web's
          does when it switches to a task (app/_layout.tsx gives it no fade). */}
      <ScreenBody enter={page ? "mount" : false}>
      <ScrollView ref={scrollRef} contentContainerStyle={page ? styles.body : styles.sheetBody} keyboardShouldPersistTaps="handled">
        {page
          ? <BackButton onPress={close} />
          : <View style={[styles.handle, { backgroundColor: T.border }]} />}
        {/* The web's task header: subject and priority chips, then the title
            (a field on the page, text in the sheet), and in the sheet Edit and ×. */}
        <View style={styles.head}>
          <View style={{ flex: 1 }}>
            <View style={styles.chips}>
              {!!task.subject && <Text style={[styles.chip, { fontSize: fz(11), backgroundColor: sc + "22", color: ink(sc, T.light) }]}>{task.subject}</Text>}
              {!task.done && <Text style={[styles.chip, { fontSize: fz(11), backgroundColor: prColor + "22", color: ink(prColor, T.light) }]}>{pr[0].toUpperCase() + pr.slice(1)} priority{task.priorityOverride ? " (set manually)" : ""}</Text>}
              {task.done && <Text style={[styles.chip, { fontSize: fz(11), backgroundColor: "#2ED57322", color: ink("#2ED573", T.light) }]}>✓ Done</Text>}
              {!!task.pinned && !task.done && <Text style={[styles.chip, { fontSize: fz(11), backgroundColor: T.accent + "18", color: T.text }]}>★ Pinned</Text>}
            </View>
            {page && draft
              ? <TextInput value={draft.title} onChangeText={v => setDraft({ ...draft, title: v })} onBlur={() => commit()} onSubmitEditing={() => commit()}
                  submitBehavior="blurAndSubmit" maxLength={LIMITS.title} multiline accessibilityLabel="Title"
                  style={[styles.titleField, { color: T.text, borderBottomColor: T.border + "33" }]} />
              : <Text style={[styles.sheetTitle, { color: T.text }]} accessibilityRole="header">{task.title}</Text>}
          </View>
          {!page && (
            <View style={styles.headBtns}>
              {!draft && (
                <Pressable onPress={() => setDraft(draftOf(task))} accessibilityRole="button" accessibilityLabel="Edit task" style={[styles.editBtn, { borderColor: T.border }]}>
                  <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textMuted }}>Edit</Text>
                </Pressable>
              )}
              {startedAt == null && (
                <Pressable onPress={close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={{ paddingLeft: 8 }}>
                  <Text style={{ fontSize: 22, lineHeight: 24, color: T.textFaint }}>×</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>

        {/* The edit card. On the page a field saves when you leave it, a choice at once. */}
        {draft && (
          <View style={[styles.editCard, { backgroundColor: T.card, borderColor: page ? T.border : T.accent + "44" }]}>
            {!page && <TextField label="Title" value={draft.title} onChangeText={v => setDraft({ ...draft, title: v })} maxLength={LIMITS.title} autoFocus />}
            <SelectField label="Subject" value={draft.subject} onChange={v => change({ subject: v }, true)}
              options={[{ value: "", label: "No subject" }, ...(draft.subject && !subjects.includes(draft.subject) ? [...subjects, draft.subject] : subjects).map(x => ({ value: x, label: x }))]} />
            <View style={styles.pair}>
              <View style={styles.half}>
                <DateField mode="date" label="Due date" value={draft.dueDate} onChange={v => change({ dueDate: v }, true)} />
                {!!draft.dueDate && <ClearLink label="No due date" onPress={() => change({ dueDate: "", dueTime: "" }, true)} />}
              </View>
              <View style={styles.half}>
                <DateField mode="time" label="Time" value={draft.dueTime} disabled={!draft.dueDate} onChange={v => change({ dueTime: v }, true)} />
                {!!draft.dueTime && <ClearLink label="No due time" onPress={() => change({ dueTime: "" }, true)} />}
              </View>
            </View>
            <View style={styles.pair}>
              <TextField label="Estimate (hours)" value={draft.estH} placeholder="0" keyboardType="number-pad" selectTextOnFocus
                onChangeText={v => setDraft({ ...draft, estH: v.replace(/\D/g, "").slice(0, 4) })} onBlur={() => { if (page) commit(); }} />
              <TextField label="Minutes" value={draft.estM} placeholder="0" keyboardType="number-pad" selectTextOnFocus
                onChangeText={v => setDraft({ ...draft, estM: v.replace(/\D/g, "").slice(0, 4) })} onBlur={() => { if (page) commit(); }} />
            </View>
            {(parseInt(draft.estM, 10) || 0) >= 60 && <Text style={{ fontFamily: F.body, fontSize: fz(10), color: T.textMuted, marginTop: -4 }}>Saves as {formatDuration(draftMins(draft))}</Text>}
            <SelectField label="Repeats" value={draft.recurrence} options={REPEATS} onChange={v => change({ recurrence: v }, true)} />
            {!page && (
              <View style={styles.pair}>
                <Pressable onPress={() => setDraft(null)} accessibilityRole="button" style={[styles.formBtn, { borderWidth: 1, borderColor: T.border }]}>
                  <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.textMuted }}>Cancel</Text>
                </Pressable>
                <Pressable onPress={() => { commit(); setDraft(null); }} accessibilityRole="button" style={[styles.formBtn, { backgroundColor: T.accent }]}>
                  <Text style={{ fontFamily: F.bodyMedium, fontSize: fz(12), color: contrastColor(T.accent) }}>Save</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {/* The web's info row: when it's due (with the countdown), the estimate, and today's time. */}
        <View style={styles.info}>
          {!!task.dueDate && (
            <View style={[styles.infoPill, { backgroundColor: T.card, borderColor: T.border }]}>
              <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.textMuted }}>
                {formatDate(task.dueDate)}{task.dueTime ? ` at ${formatTime(task.dueTime, h24)}` : ""}
                {!!due && <Text style={{ fontFamily: F.bodyMedium, color: ink(prColor, T.light) }}> · {due}</Text>}
              </Text>
            </View>
          )}
          {task.estMins > 0 && (
            <View style={[styles.infoPill, { backgroundColor: T.card, borderColor: T.accent + "44" }]}>
              <Text style={{ fontFamily: F.bodyMedium, fontSize: fz(12), color: T.accent }}>{formatDuration(task.estMins)} estimated</Text>
            </View>
          )}
          {totalToday > 0 && (
            <View style={[styles.infoPill, { backgroundColor: "#2ED57322", borderColor: "#2ED57344" }]}>
              <Text style={{ fontFamily: F.body, fontSize: fz(12), color: ink("#2ED573", T.light) }}><Text style={{ fontSize: fz(14) }}>✓</Text> {formatDuration(totalToday)} spent today</Text>
            </View>
          )}
        </View>

        {/* The sheet's Snooze row (not on the page, at the user's request: the date
            field is right there). For a repeating task "Skip this one" moves it to
            its next occurrence without completing it. Each is an undo step. */}
        {!page && !task.done && !draft && (
          <View style={styles.snooze}>
            <Text style={[styles.snoozeLabel, { fontSize: fz(10), color: T.textMuted }]}>SNOOZE</Text>
            {SNOOZES.map(([k, l]) => (
              <Pressable key={k} onPress={() => snooze(k)} accessibilityRole="button" accessibilityLabel={`Snooze ${l.toLowerCase()}`}
                style={({ pressed }) => [styles.snoozeBtn, { backgroundColor: T.surface, borderColor: T.border, opacity: pressed ? 0.7 : 1 }]}>
                <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.text }}>{l}</Text>
              </Pressable>
            ))}
            {!!task.recurrence && task.recurrence !== "none" && (
              <Pressable onPress={skipOne} accessibilityRole="button" accessibilityHint="Moves this repeating task to its next occurrence without completing it"
                style={({ pressed }) => [styles.snoozeBtn, { backgroundColor: T.surface, borderColor: T.border, opacity: pressed ? 0.7 : 1 }]}>
                <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.text }}>Skip this one ↻</Text>
              </Pressable>
            )}
          </View>
        )}

        <Field label="Priority" card T={T} fz={fz}>
          <View style={styles.prioRow} accessibilityRole="radiogroup" accessibilityLabel="Priority">
            {PRIORITIES.map(p => {
              const active = p === null ? !task.priorityOverride : task.priorityOverride === p;
              const color = p === null ? T.accent : priColor(p, colorCodeUrgency);
              return (
                <Pressable key={p ?? "auto"} onPress={() => quiet({ priorityOverride: p ?? undefined })} accessibilityRole="radio" accessibilityState={{ checked: active }}
                  style={[styles.prio, { backgroundColor: active ? color + "22" : T.surface, borderColor: active ? color : T.border }]}>
                  <Text style={{ fontFamily: F.body, fontSize: fz(11), color: active ? (p ? ink(color, T.light) : T.text) : T.textMuted }}>{p === null ? "Auto" : p[0].toUpperCase() + p.slice(1)}</Text>
                </Pressable>
              );
            })}
          </View>
        </Field>

        {/* Difficulty: how hard, separate from how long. The chosen one again clears it. */}
        <Field label="Difficulty" card T={T} fz={fz}>
          <View style={styles.prioRow} accessibilityRole="radiogroup" accessibilityLabel="Difficulty">
            {DIFFICULTIES.map(d => {
              const active = task.difficulty === d;
              return (
                <Pressable key={d} onPress={() => quiet({ difficulty: active ? undefined : d })} accessibilityRole="radio" accessibilityState={{ checked: active }}
                  style={[styles.prio, { backgroundColor: active ? T.accent + "22" : T.surface, borderColor: active ? T.accent : T.border }]}>
                  <Text style={{ fontFamily: F.body, fontSize: fz(11), color: active ? T.text : T.textMuted }}>{d[0].toUpperCase() + d.slice(1)}</Text>
                </Pressable>
              );
            })}
          </View>
        </Field>

        {/* Grade: for a finished task, whatever the teacher gave ("A-", "92%", "18/20"). */}
        {task.done && (
          <Field label="Grade" card T={T} fz={fz}>
            <TextInput
              key={task.grade ?? ""}
              defaultValue={task.grade ?? ""}
              onEndEditing={e => { const g = oneLine(e.nativeEvent.text).trim().slice(0, LIMITS.grade); if (g !== (task.grade ?? "")) quiet({ grade: g || undefined }); }}
              placeholder="e.g. A-, 92%, 18/20"
              placeholderTextColor={T.textMuted}
              maxLength={LIMITS.grade}
              returnKeyType="done"
              accessibilityLabel="Grade"
              style={[styles.addInput, { fontSize: 16, color: T.text, backgroundColor: T.surface, borderColor: T.border }]}
            />
          </Field>
        )}

        <Field label="Subtasks" card T={T} fz={fz} right={subtasks.length ? `${subtasks.filter(s => s.done).length}/${subtasks.length}` : undefined}>
          {subtasks.map(s => (
            <View key={s.id} style={styles.subRow}>
              <Pressable
                onPress={() => quiet({ subtasks: subtasks.map(x => (x.id === s.id ? { ...x, done: !x.done } : x)) })}
                hitSlop={10}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: s.done }}
                accessibilityLabel={s.text}
                style={[styles.subCheck, { borderColor: s.done ? "#2ED573" : T.textFaint, backgroundColor: s.done ? "#2ED573" : "transparent" }]}
              >
                {s.done && <Text style={[styles.subTick, { fontSize: fz(9) }]}>✓</Text>}
              </Pressable>
              <Text style={[styles.subText, { fontSize: fz(12), color: s.done ? T.textFaint : T.text, textDecorationLine: s.done ? "line-through" : "none" }]}>{s.text}</Text>
              <Pressable onPress={() => edit({ subtasks: subtasks.filter(x => x.id !== s.id) })} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Delete subtask ${s.text}`}>
                <Text style={{ fontSize: fz(13), color: T.textFaint, paddingHorizontal: 2 }}>×</Text>
              </Pressable>
            </View>
          ))}
          {subtasks.length < LIMITS.subtasks && (
            <View style={styles.addRow}>
            <TextInput
              value={subtask}
              onChangeText={setSubtask}
              onSubmitEditing={addSubtask}
              submitBehavior="submit"
              placeholder="Add a subtask..."
              placeholderTextColor={T.textMuted}
              maxLength={LIMITS.title}
              returnKeyType="done"
              accessibilityLabel="Add a subtask"
              style={[styles.addInput, { fontSize: fz(12), color: T.text, backgroundColor: T.surface, borderColor: T.border }]}
            />
            <PlusButton label="Add subtask" onPress={addSubtask} T={T} fz={fz} />
            </View>
          )}
        </Field>

        <Field label="Tags" card T={T} fz={fz}>
          {tags.length > 0 && (
            <View style={[styles.wrap, { gap: 6, marginBottom: 10 }]}>
              {tags.map(t => (
                <View key={t} style={[styles.tagPill, { backgroundColor: T.accent + "22" }]}>
                  <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.accent }}>{t}</Text>
                  <Pressable onPress={() => quiet({ tags: tags.filter(x => x !== t) })} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove tag ${t}`}>
                    <Text style={{ fontSize: fz(13), color: T.accent, paddingHorizontal: 4 }}>×</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          {tags.length < LIMITS.tags && (
            <View style={styles.addRow}>
            <TextInput
              value={tag}
              onChangeText={setTag}
              onSubmitEditing={addTag}
              submitBehavior="submit"
              placeholder="Add a tag..."
              placeholderTextColor={T.textMuted}
              maxLength={LIMITS.tag}
              autoCapitalize="none"
              returnKeyType="done"
              accessibilityLabel="Add a tag"
              style={[styles.addInput, { fontSize: fz(12), color: T.text, backgroundColor: T.surface, borderColor: T.border }]}
            />
            <PlusButton label="Add tag" onPress={addTag} T={T} fz={fz} />
            </View>
          )}
          {tags.length < LIMITS.tags && suggestions.length > 0 && (
            <View style={[styles.wrap, { marginTop: 8, gap: 6 }]}>
              {suggestions.map(t => (
                <Pressable key={t} onPress={() => quiet({ tags: [...tags, t] })} accessibilityRole="button" accessibilityLabel={`Add tag ${t}`}
                  style={[styles.suggest, { borderColor: T.border }]}>
                  <Text style={{ fontFamily: F.body, fontSize: fz(10), color: T.textFaint }}>+{t}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </Field>

        <View style={[styles.session, { backgroundColor: T.card, borderColor: startedAt != null ? T.accent + "66" : T.border }]}>
          <Text style={[styles.sessionKicker, { fontSize: fz(11), color: startedAt != null ? T.accent : T.textMuted }]}>{startedAt != null ? "SESSION IN PROGRESS" : "READY TO WORK?"}</Text>
          <Text style={[styles.sessionClock, { color: startedAt != null ? T.text : T.textFaint }]} accessibilityLabel={`${sh ? `${sh} hours ` : ""}${sm} minutes ${ss} seconds`}>
            {sh > 0 ? `${sh}:` : ""}{String(sm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
          </Text>
          {startedAt != null && <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textFaint, marginBottom: 18 }}>Keep going!</Text>}
          {startedAt != null ? (
            <Pressable onPress={endSession} accessibilityRole="button" style={[styles.sessionBtn, { backgroundColor: "#FF4757" }]}>
              <Text style={[styles.sessionBtnText, { fontSize: fz(17), color: "#fff" }]}>End Session</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => setStartedAt(clock())} accessibilityRole="button" style={[styles.sessionBtn, { backgroundColor: T.accent, marginTop: 18 }]}>
              <Text style={[styles.sessionBtnText, { fontSize: fz(17), color: contrastColor(T.accent) }]}>Start Session</Text>
            </Pressable>
          )}
        </View>

        {sessionsToday.length > 0 && (
          <View style={[styles.today, { backgroundColor: T.card, borderColor: T.border }]}>
            <Text style={[styles.label, { color: T.textMuted, marginBottom: 8 }]}>SESSIONS TODAY</Text>
            {sessionsToday.map((x, i) => (
              <View key={i} style={[styles.todayRow, i < sessionsToday.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: T.border }]}>
                <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.text }}>Session {i + 1}</Text>
                <View style={styles.todayRight}>
                  <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textFaint }}>{x.time}</Text>
                  <Text style={{ fontFamily: F.bodyMedium, fontSize: fz(12), color: T.accent }}>{formatDuration(x.mins)}</Text>
                </View>
              </View>
            ))}
            <View style={[styles.todayTotal, { borderTopColor: T.border }]}>
              <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.textMuted }}>Total</Text>
              <Text style={{ fontFamily: F.heading, fontSize: fz(16), color: T.accent }}>{formatDuration(totalToday)}</Text>
            </View>
          </View>
        )}

        <View style={styles.actions}>
          <Pressable onPress={() => { app.toggle(task.id); if (!page) close(); }} accessibilityRole="button"
            style={[styles.actBtn, { backgroundColor: task.done ? "#FF475722" : "#2ED57322", borderColor: task.done ? "#FF475744" : "#2ED57344" }]}>
            <Text style={[styles.btnText, { fontSize: fz(12), color: ink(task.done ? "#FF4757" : "#2ED573", T.light) }]}>{task.done ? "↩ Mark undone" : "✓ Mark done"}</Text>
          </Pressable>
          {task.done && !task.archived && (
            <Pressable onPress={() => app.edit(task.id, { archived: true }, "Archived")} accessibilityRole="button" style={[styles.actBtn, { backgroundColor: T.surface, borderColor: T.border }]}>
              <Text style={[styles.btnText, { fontSize: fz(12), color: T.textMuted }]}>Archive</Text>
            </Pressable>
          )}
          {!!task.archived && (
            <Pressable onPress={() => app.edit(task.id, { archived: false }, "Restored")} accessibilityRole="button" style={[styles.actBtn, { backgroundColor: T.surface, borderColor: T.border }]}>
              <Text style={[styles.btnText, { fontSize: fz(12), color: T.text }]}>Restore</Text>
            </Pressable>
          )}
          <Pressable onPress={() => { app.remove(task.id); if (page) router.navigate("/"); else close(); }} accessibilityRole="button" style={[styles.actBtn, { backgroundColor: "#FF475711", borderColor: "#FF475733" }]}>
            <Text style={[styles.btnText, { fontSize: fz(12), color: ink("#FF4757", T.light) }]}>Delete task</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => { app.duplicate(task.id); close(); }} accessibilityRole="button" style={[styles.wideBtn, { borderColor: T.border }]}>
          <Text style={[styles.btnText, { fontSize: fz(11), color: T.textMuted }]}>Duplicate task</Text>
        </Pressable>
        {!task.done && (
          <Pressable onPress={() => quiet({ pinned: task.pinned ? undefined : true })} accessibilityRole="button" accessibilityState={{ selected: !!task.pinned }}
            style={[styles.wideBtn, { borderColor: T.border }]}>
            <Text style={[styles.btnText, { fontSize: fz(11), color: T.textMuted }]}>{task.pinned ? "Unpin" : "★ Pin to top"}</Text>
          </Pressable>
        )}
        {templateName === null ? (
          <Pressable onPress={() => { setTemplateSaved(false); setTemplateName(task.title); }} accessibilityRole="button" style={[styles.wideBtn, { borderColor: T.border }]}>
            <Text style={[styles.btnText, { fontSize: fz(11), color: T.textMuted }]}>{templateSaved ? "✓ Saved. Find it under \"+ Add homework\"" : "Save as template"}</Text>
          </Pressable>
        ) : (
          <View style={styles.tplForm}>
            <TextInput value={templateName} onChangeText={setTemplateName} autoFocus placeholder="Template name" placeholderTextColor={T.textFaint} accessibilityLabel="Template name"
              maxLength={LIMITS.title} returnKeyType="done"
              onSubmitEditing={() => { const n = templateName.trim(); if (n) { app.settings.setTemplates(prev => [...prev, templateFromTask(task, n)]); setTemplateName(null); setTemplateSaved(true); } }}
              style={[styles.tplInput, { fontSize: fz(12), color: T.text, backgroundColor: T.surface, borderColor: T.border }]} />
            <Pressable disabled={!templateName.trim()} accessibilityRole="button" accessibilityState={{ disabled: !templateName.trim() }}
              onPress={() => { const n = templateName.trim(); if (n) { app.settings.setTemplates(prev => [...prev, templateFromTask(task, n)]); setTemplateName(null); setTemplateSaved(true); } }}
              style={[styles.tplBtn, { backgroundColor: T.accent, opacity: templateName.trim() ? 1 : 0.5 }]}>
              <Text style={[styles.btnText, { fontSize: fz(12), color: contrastColor(T.accent) }]}>Save</Text>
            </Pressable>
            <Pressable onPress={() => setTemplateName(null)} accessibilityRole="button" style={[styles.tplBtn, { borderWidth: 1, borderColor: T.border }]}>
              <Text style={[styles.btnText, { fontSize: fz(12), color: T.textMuted }]}>Cancel</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
      </ScreenBody>
      </SafeAreaView>
      {!page && <UndoToast />}
    </KeyboardAvoidingView>
  );
}

// A labelled field. `card`: in the web's rounded card (Priority, Subtasks,
// Tags), with `right` (e.g. the subtask count) across from the label.
function Field({ label, T, card, right, fz, children }: { label: string; T: Theme; card?: boolean; right?: string; fz?: (n: number) => number; children: ReactNode }) {
  const size = fz ? fz(10) : 11;
  return (
    <View style={card ? [styles.cardField, { backgroundColor: T.card, borderColor: T.border }] : styles.field}>
      <View style={styles.labelRow}>
        <Text style={[styles.label, { fontSize: size, color: T.textMuted }]}>{label.toUpperCase()}</Text>
        {!!right && <Text style={{ fontFamily: F.body, fontSize: size + 1, color: T.textFaint }}>{right}</Text>}
      </View>
      {children}
    </View>
  );
}

// The web's accent "+" beside the subtask and tag fields.
function PlusButton({ label, onPress, T, fz }: { label: string; onPress: () => void; T: Theme; fz: (n: number) => number }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} style={({ pressed }) => [styles.plus, { backgroundColor: T.accent, opacity: pressed ? 0.8 : 1 }]}>
      <Text style={{ fontFamily: F.bodyMedium, fontSize: fz(12), color: contrastColor(T.accent) }}>+</Text>
    </Pressable>
  );
}



const styles = StyleSheet.create({
  crashCard: { borderWidth: 1, borderRadius: 12, padding: 24, maxWidth: 320, gap: 12 },
  crashBtn: { borderRadius: 9, paddingVertical: 9, paddingHorizontal: 16, alignItems: "center" },
  snooze: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: -8, marginBottom: 18 },
  snoozeLabel: { fontFamily: F.body, letterSpacing: 0.8, marginRight: 2 },
  snoozeBtn: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  body: { paddingHorizontal: 14, paddingTop: 0, paddingBottom: 32 },
  sheetBody: { paddingHorizontal: 20, paddingTop: 10, paddingBottom: 32 },
  handle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, marginBottom: 14 },
  head: { flexDirection: "row", alignItems: "flex-start", marginBottom: 16 },
  chips: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 6 },
  chip: { fontFamily: F.body, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, overflow: "hidden" },
  titleField: { fontFamily: F.heading, fontSize: 26, lineHeight: 31, paddingTop: 2, paddingBottom: 6, paddingHorizontal: 0, borderBottomWidth: 1 },
  sheetTitle: { fontFamily: F.heading, fontSize: 22, lineHeight: 26 },
  headBtns: { flexDirection: "row", alignItems: "center", gap: 4, marginLeft: 8 },
  editBtn: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  editCard: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 16, gap: 10 },
  pair: { flexDirection: "row", gap: 8 },
  half: { flex: 1, minWidth: 0 },
  formBtn: { flex: 1, borderRadius: 9, paddingVertical: 9, alignItems: "center" },
  info: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 20 },
  infoPill: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  gone: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  actions: { flexDirection: "row", gap: 8, marginTop: 4 },
  actBtn: { flex: 1, borderWidth: 1, borderRadius: 11, paddingVertical: 11, alignItems: "center" },
  btnText: { fontFamily: F.body, textAlign: "center" },
  wideBtn: { borderWidth: 1, borderRadius: 11, paddingVertical: 10, alignItems: "center", marginTop: 8 },
  tplForm: { flexDirection: "row", gap: 6, marginTop: 8 },
  tplInput: { flex: 1, minWidth: 0, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 9, fontFamily: F.body },
  tplBtn: { borderRadius: 9, paddingHorizontal: 14, justifyContent: "center" },
  prioRow: { flexDirection: "row", gap: 6 },
  prio: { flex: 1, borderWidth: 1.5, borderRadius: 9, paddingVertical: 8, alignItems: "center" },
  suggest: { borderWidth: 1, borderStyle: "dashed", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  session: { borderWidth: 1, borderRadius: 16, padding: 20, alignItems: "center", marginBottom: 16 },
  sessionKicker: { fontFamily: F.body, letterSpacing: 1.1, marginBottom: 8 },
  sessionClock: { fontFamily: F.heading, fontSize: 52, lineHeight: 56, marginBottom: 4 },
  sessionBtn: { alignSelf: "stretch", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  sessionBtnText: { fontFamily: F.heading },
  today: { borderWidth: 1, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 16 },
  todayRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 5 },
  todayRight: { flexDirection: "row", gap: 10, alignItems: "center" },
  todayTotal: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8, paddingTop: 8, borderTopWidth: 1 },
  field: { marginBottom: 22 },
  cardField: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 16 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  addRow: { flexDirection: "row", gap: 6 },
  addInput: { flex: 1, fontFamily: F.body, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  plus: { borderRadius: 8, paddingHorizontal: 12, justifyContent: "center" },
  tagPill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 999, paddingLeft: 10, paddingRight: 4, paddingVertical: 3 },
  subTick: { color: "#111", fontWeight: "700" },
  label: { fontSize: 11, fontFamily: F.body, letterSpacing: 1, marginBottom: 10 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  subRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  subCheck: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  subText: { flex: 1, fontFamily: F.body },
});
