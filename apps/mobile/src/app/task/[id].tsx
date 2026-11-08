import { useEffect, useRef, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { Priority, Recurrence, Task } from "@dueplanner/core/types";
import { contrastColor, formatDuration, formatTime, ink } from "@dueplanner/core/lib/format";
import { localDateStr, todayISO } from "@dueplanner/core/lib/dates";
import { secondsSince, sessionMinutes } from "@dueplanner/core/lib/timers";
import { templateFromTask } from "@dueplanner/core/lib/taskActions";
import { allTagsOf } from "@dueplanner/core/lib/taskViews";
import { priColor } from "@dueplanner/core/constants";
import { LIMITS, oneLine } from "@dueplanner/core/lib/limits";
import { nextId } from "@dueplanner/core/lib/id";
import { useApp } from "../../state/appContext";
import { useNow } from "../../lib/useNow";
import { clock } from "../../lib/clock";
import { F } from "../../theme/fonts";
import type { Theme } from "../../theme/types";
import { Chip, Segmented } from "../../components/ui";
import { DateTimeField } from "../../components/DateTimeField";

// The task page (the web's TaskModal in its `page` form): every field is open
// to edit and saves on its own when you leave it, so each change is one undo
// step rather than one per keystroke. Subtask ticks, tags and the priority
// override aren't undo steps, as on the web.

const REPEATS: { label: string; value: Recurrence }[] = [
  { label: "None", value: "none" }, { label: "Daily", value: "daily" }, { label: "Weekly", value: "weekly" }, { label: "Monthly", value: "monthly" },
];
// The web's order: Auto, then Low to High, each in its priority colour.
const PRIORITIES: (Priority | null)[] = [null, "low", "medium", "high"];

export default function TaskPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useApp();
  const task = app.tasks.find(t => String(t.id) === id);
  if (!task) {
    return (
      <View style={[styles.gone, { backgroundColor: app.T.bg }]}>
        <Text style={[styles.label, { color: app.T.textMuted }]}>This task isn&apos;t here any more.</Text>
        <Pressable onPress={() => router.back()} accessibilityRole="button" style={[styles.wideBtn, { borderColor: app.T.border, alignSelf: "stretch" }]}>
          <Text style={[styles.btnText, { color: app.T.text }]}>Back</Text>
        </Pressable>
      </View>
    );
  }
  return <TaskForm task={task} />;
}

function TaskForm({ task }: { task: Task }) {
  const app = useApp();
  const { T, h24, fz } = app;
  const { subjects, subjectColors, colorCodeUrgency } = app.settings;
  const edit = (patch: Partial<Task>) => app.edit(task.id, patch);
  const quiet = (patch: Partial<Task>) => app.quiet(task.id, patch);

  // Text fields hold what's typed until it's saved; when the saved value
  // changes underneath (undo, another screen), they take it again.
  const [title, setTitle] = useState(task.title);
  const [hours, setHours] = useState(String(Math.floor(task.estMins / 60)));
  const [mins, setMins] = useState(String(task.estMins % 60));
  const [seen, setSeen] = useState({ title: task.title, est: task.estMins });
  if (seen.title !== task.title || seen.est !== task.estMins) {
    setSeen({ title: task.title, est: task.estMins });
    setTitle(task.title);
    setHours(String(Math.floor(task.estMins / 60)));
    setMins(String(task.estMins % 60));
  }
  const [subtask, setSubtask] = useState("");
  const [tag, setTag] = useState("");
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [templateSaved, setTemplateSaved] = useState(false);

  // The work-session timer (the web's): counts up from a fixed start, so time
  // with the phone locked still counts. Ending it logs a session on the task;
  // so does leaving the page while it runs (the web's leaveTaskPage).
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const now = useNow(1000);
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

  const saveTitle = () => {
    const t = oneLine(title).trim().slice(0, LIMITS.title);
    if (t) edit({ title: t });
    else setTitle(task.title); // a title can't be emptied
  };
  // Minutes past 59 roll into hours, as on the web.
  const saveEstimate = () => {
    const total = Math.min(LIMITS.estMins, (parseInt(hours, 10) || 0) * 60 + (parseInt(mins, 10) || 0));
    if (total === task.estMins) { setHours(String(Math.floor(total / 60))); setMins(String(total % 60)); return; }
    edit({ estMins: total });
  };

  const subtasks = task.subtasks ?? [];
  const tags = task.tags ?? [];
  const logged = (task.sessions ?? []).reduce((n, s) => n + s.mins, 0);
  const subjectChoices = task.subject && !subjects.includes(task.subject) ? [...subjects, task.subject] : subjects;

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

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: T.bg }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={100}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <TextInput
          value={title}
          onChangeText={setTitle}
          onBlur={saveTitle}
          onSubmitEditing={saveTitle}
          submitBehavior="blurAndSubmit"
          maxLength={LIMITS.title}
          multiline
          accessibilityLabel="Title"
          style={[styles.title, { color: T.text, textDecorationLine: task.done ? "line-through" : "none" }]}
        />

        <Field label="Subject" T={T}>
          <View style={styles.wrap}>
            {subjectChoices.map(s => (
              <Chip key={s} label={s} color={subjectColors[s]} selected={task.subject === s} T={T} onPress={() => edit({ subject: task.subject === s ? "" : s })} />
            ))}
          </View>
        </Field>

        <Field label="Due" T={T}>
          {task.dueDate ? (
            <View style={styles.line}>
              <DateTimeField mode="date" value={task.dueDate} onChange={v => edit({ dueDate: v })} T={T} h24={h24} label="Due date" />
              {task.dueTime
                ? <DateTimeField mode="time" value={task.dueTime} onChange={v => edit({ dueTime: v })} T={T} h24={h24} label="Due time" />
                : <Link label="Add a time" T={T} onPress={() => edit({ dueTime: "09:00" })} />}
            </View>
          ) : <Link label="Add a due date" T={T} onPress={() => edit({ dueDate: todayISO() })} />}
          {!!task.dueDate && (
            <View style={styles.line}>
              {!!task.dueTime && <Link label="Any time" T={T} onPress={() => edit({ dueTime: "" })} />}
              <Link label="No due date" T={T} onPress={() => edit({ dueDate: "", dueTime: "" })} />
            </View>
          )}
        </Field>

        <Field label="How long it takes" T={T}>
          <View style={styles.line}>
            <NumberBox value={hours} onChange={setHours} onDone={saveEstimate} T={T} label="Hours" />
            <Text style={[styles.unit, { color: T.textMuted }]}>h</Text>
            <NumberBox value={mins} onChange={setMins} onDone={saveEstimate} T={T} label="Minutes" />
            <Text style={[styles.unit, { color: T.textMuted }]}>m</Text>
          </View>
        </Field>

        <Field label="Repeats" T={T}>
          <Segmented label="Repeats" options={REPEATS} value={task.recurrence ?? "none"} onChange={v => edit({ recurrence: v })} T={T} />
        </Field>

        <Field label="Priority" T={T}>
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

        <Field label={`Subtasks${subtasks.length ? ` (${subtasks.filter(s => s.done).length}/${subtasks.length})` : ""}`} T={T}>
          {subtasks.map(s => (
            <View key={s.id} style={styles.subRow}>
              <Pressable
                onPress={() => quiet({ subtasks: subtasks.map(x => (x.id === s.id ? { ...x, done: !x.done } : x)) })}
                hitSlop={10}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: s.done }}
                accessibilityLabel={s.text}
                style={[styles.subCheck, { borderColor: s.done ? "#2ED573" : T.textMuted, backgroundColor: s.done ? "#2ED573" : "transparent" }]}
              >
                {s.done && <Text style={styles.tick}>✓</Text>}
              </Pressable>
              <Text style={[styles.subText, { color: s.done ? T.textMuted : T.text, textDecorationLine: s.done ? "line-through" : "none" }]}>{s.text}</Text>
              <Pressable onPress={() => edit({ subtasks: subtasks.filter(x => x.id !== s.id) })} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Delete subtask ${s.text}`}>
                <Text style={[styles.x, { color: T.textMuted }]}>×</Text>
              </Pressable>
            </View>
          ))}
          {subtasks.length < LIMITS.subtasks && (
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
              style={[styles.input, { color: T.text, backgroundColor: T.surface, borderColor: T.border }]}
            />
          )}
        </Field>

        <Field label="Tags" T={T}>
          {tags.length > 0 && (
            <View style={[styles.wrap, { marginBottom: 10 }]}>
              {tags.map(t => <Chip key={t} label={`${t}  ×`} accessibilityLabel={`Remove tag ${t}`} T={T} onPress={() => quiet({ tags: tags.filter(x => x !== t) })} />)}
            </View>
          )}
          {tags.length < LIMITS.tags && (
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
              style={[styles.input, { color: T.text, backgroundColor: T.surface, borderColor: T.border }]}
            />
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

        {logged > 0 && (
          <Field label="Time worked" T={T}>
            <Text style={[styles.value, { color: T.text }]}>{formatDuration(logged)} in {task.sessions!.length} session{task.sessions!.length === 1 ? "" : "s"}</Text>
          </Field>
        )}

        <View style={styles.actions}>
          <Pressable onPress={() => app.toggle(task.id)} accessibilityRole="button"
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
          <Pressable onPress={() => { app.remove(task.id); router.back(); }} accessibilityRole="button" style={[styles.actBtn, { backgroundColor: "#FF475711", borderColor: "#FF475733" }]}>
            <Text style={[styles.btnText, { fontSize: fz(12), color: ink("#FF4757", T.light) }]}>Delete task</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => { app.duplicate(task.id); router.back(); }} accessibilityRole="button" style={[styles.wideBtn, { borderColor: T.border }]}>
          <Text style={[styles.btnText, { fontSize: fz(11), color: T.textMuted }]}>Duplicate task</Text>
        </Pressable>
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
            <Pressable disabled={!templateName.trim()} accessibilityRole="button"
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
    </KeyboardAvoidingView>
  );
}

function Field({ label, T, children }: { label: string; T: Theme; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: T.textMuted }]}>{label.toUpperCase()}</Text>
      {children}
    </View>
  );
}

function Link({ label, onPress, T }: { label: string; onPress: () => void; T: Theme }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} style={styles.link}>
      <Text style={[styles.linkText, { color: T.text }]}>{label}</Text>
    </Pressable>
  );
}

// Digits only, kept as text while typing (the web's estimate fields).
function NumberBox({ value, onChange, onDone, T, label }: { value: string; onChange: (v: string) => void; onDone: () => void; T: Theme; label: string }) {
  return (
    <TextInput
      value={value}
      onChangeText={v => onChange(v.replace(/\D/g, "").slice(0, 4))}
      onBlur={onDone}
      onSubmitEditing={onDone}
      keyboardType="number-pad"
      returnKeyType="done"
      selectTextOnFocus
      accessibilityLabel={label}
      style={[styles.num, { color: T.text, backgroundColor: T.surface, borderColor: T.border }]}
    />
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, paddingBottom: 60 },
  gone: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 },
  title: { fontSize: 26, fontFamily: F.heading, marginBottom: 16, paddingVertical: 4 },
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
  label: { fontSize: 11, fontFamily: F.body, letterSpacing: 1, marginBottom: 10 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  line: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 6 },
  link: { paddingVertical: 6 },
  linkText: { fontSize: 13, fontFamily: F.body, textDecorationLine: "underline" },
  unit: { fontSize: 14, fontFamily: F.body, marginLeft: -6 },
  num: { width: 64, fontSize: 16, fontFamily: F.body, borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9, textAlign: "center" },
  input: { fontSize: 16, fontFamily: F.body, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, marginTop: 4 },
  subRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  subCheck: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  tick: { color: "#000", fontSize: 13, fontWeight: "700", lineHeight: 15 },
  subText: { flex: 1, fontSize: 14, fontFamily: F.body },
  x: { fontSize: 20, lineHeight: 22, paddingHorizontal: 4 },
  value: { fontSize: 14, fontFamily: F.body },
});
