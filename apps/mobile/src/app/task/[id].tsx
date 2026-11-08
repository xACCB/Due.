import { useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import type { Priority, Recurrence, Task } from "@dueplanner/core/types";
import { formatDuration } from "@dueplanner/core/lib/format";
import { todayISO } from "@dueplanner/core/lib/dates";
import { LIMITS, oneLine } from "@dueplanner/core/lib/limits";
import { nextId } from "@dueplanner/core/lib/id";
import { useApp } from "../../state/appContext";
import { F } from "../../theme/fonts";
import type { Theme } from "../../theme/types";
import { Button, Chip, Segmented } from "../../components/ui";
import { DateTimeField } from "../../components/DateTimeField";

// The task page (the web's TaskModal in its `page` form): every field is open
// to edit and saves on its own when you leave it, so each change is one undo
// step rather than one per keystroke. Subtask ticks, tags and the priority
// override aren't undo steps, as on the web.

const REPEATS: { label: string; value: Recurrence }[] = [
  { label: "None", value: "none" }, { label: "Daily", value: "daily" }, { label: "Weekly", value: "weekly" }, { label: "Monthly", value: "monthly" },
];
const PRIORITIES: { label: string; value: Priority | "auto" }[] = [
  { label: "Auto", value: "auto" }, { label: "High", value: "high" }, { label: "Medium", value: "medium" }, { label: "Low", value: "low" },
];

export default function TaskPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const app = useApp();
  const task = app.tasks.find(t => String(t.id) === id);
  if (!task) {
    return (
      <View style={[styles.gone, { backgroundColor: app.T.bg }]}>
        <Text style={[styles.label, { color: app.T.textMuted }]}>This task isn&apos;t here any more.</Text>
        <Button label="Back" onPress={() => router.back()} T={app.T} />
      </View>
    );
  }
  return <TaskForm task={task} />;
}

function TaskForm({ task }: { task: Task }) {
  const app = useApp();
  const { T, h24 } = app;
  const { subjects, subjectColors } = app.settings;
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

        <View style={styles.actions}>
          <Button label={task.done ? "Mark not done" : "Mark done"} onPress={() => app.toggle(task.id)} T={T} style={styles.flex} />
          <Button label={task.archived ? "Unarchive" : "Archive"} onPress={() => app.edit(task.id, { archived: !task.archived }, task.archived ? "Unarchived" : "Archived")} T={T} kind="plain" style={styles.flex} />
        </View>

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
          <Segmented
            label="Priority"
            options={PRIORITIES}
            value={task.priorityOverride ?? "auto"}
            onChange={v => quiet(v === "auto" ? { priorityOverride: undefined } : { priorityOverride: v })}
            T={T}
          />
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
        </Field>

        {logged > 0 && (
          <Field label="Time worked" T={T}>
            <Text style={[styles.value, { color: T.text }]}>{formatDuration(logged)} in {task.sessions!.length} session{task.sessions!.length === 1 ? "" : "s"}</Text>
          </Field>
        )}

        <View style={styles.actions}>
          <Button label="Duplicate" kind="plain" T={T} style={styles.flex} onPress={() => { app.duplicate(task.id); router.back(); }} />
          <Button label="Delete" kind="danger" T={T} style={styles.flex} onPress={() => { app.remove(task.id); router.back(); }} />
        </View>
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
  actions: { flexDirection: "row", gap: 10, marginBottom: 22 },
  flex: { flex: 1 },
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
