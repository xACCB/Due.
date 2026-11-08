import { useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { LAYOUTS, QUESTIONS, QUESTION_KEYS, REMINDER_OFFSETS, SUBJECT_COLOR_PALETTE, type LayoutName } from "@dueplanner/core/constants";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { moveQuestion, normalizeQuestionPrefs } from "@dueplanner/core/lib/addQuestions";
import { recolouredSubjects, renamedSubjects, subjectRename, subjectToAdd, templatesRenamedSubject, withoutSubjectColor } from "@dueplanner/core/lib/taskActions";
import { focusShowFor, showsPomodoro, showsStopwatch } from "@dueplanner/core/lib/stopwatch";
import { contrastColor, ink } from "@dueplanner/core/lib/format";
import { LIMITS } from "@dueplanner/core/lib/limits";
import { useApp } from "../../state/appContext";
import { requestNotifications } from "../../lib/notifications";
import { F } from "../../theme/fonts";
import type { Theme } from "../../theme/types";
import { Row, Section, Segmented, Stepper, ToggleRow } from "../../components/ui";

// Settings, in the web's sections and order (Looks, Date & time, Focus timer,
// New task questions, Subjects, Task list, Reminders), then feedback and
// Clear completed. Recently deleted is in History, as on the web.
const FEEDBACK_URL = "https://forms.gle/oPuAWx6jNHvm75xi8";
const PRIVACY_URL = "https://dueplanner.vercel.app/privacy.html";
const LAYOUT_ICONS: Record<LayoutName, SFSymbol> = {
  list: "list.bullet", board: "square.grid.2x2", checklist: "checklist",
  kanban: "rectangle.split.3x1", progress: "chart.bar.xaxis", pyramid: "triangle",
};
export default function SettingsScreen() {
  const app = useApp();
  const { T, fz } = app;
  const s = app.settings;
  const [newSubject, setNewSubject] = useState("");
  const prefs = normalizeQuestionPrefs(s.addQuestions, QUESTION_KEYS);

  const addSubject = () => {
    const add = subjectToAdd(newSubject, s.subjects, s.subjectColors);
    if (add) {
      s.setSubjects([...s.subjects, add.name]);
      s.setSubjectColors({ ...s.subjectColors, [add.name]: add.color });
    }
    setNewSubject("");
  };
  // Two taps to delete (tasks keep their subject), and editing in place, as on the web.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ old: string; name: string; color: string } | null>(null);
  const removeSubject = (name: string) => { s.setSubjects(s.subjects.filter(x => x !== name)); s.setSubjectColors(withoutSubjectColor(s.subjectColors, name)); };
  // The web's updateSubject: the new name goes to the tasks, Recently deleted and templates.
  const saveSubject = () => {
    if (!editing) return;
    const next = subjectRename(editing.old, editing.name, s.subjects);
    if (next == null) return;
    s.setSubjects(renamedSubjects(s.subjects, editing.old, next));
    s.setSubjectColors(recolouredSubjects(s.subjectColors, editing.old, next, editing.color));
    if (next !== editing.old) {
      app.renameSubject(editing.old, next);
      s.setTemplates(prev => templatesRenamedSubject(prev, editing.old, next));
    }
    setEditing(null);
  };
  const setReminders = async (on: boolean) => {
    if (!on) { s.setNotifications(false); return; }
    if (await requestNotifications()) { s.setNotifications(true); return; }
    Alert.alert("Notifications are off", "Allow notifications for DuePlanner in the iPhone's Settings to get reminders.", [
      { text: "Not now", style: "cancel" },
      { text: "Open Settings", onPress: () => { Linking.openSettings().catch(() => {}); } },
    ]);
  };
  const toggleOffset = (key: string, on: boolean) =>
    s.setReminderOffsets(REMINDER_OFFSETS.map(o => o.key as string).filter(k => (k === key ? on : s.reminderOffsets.includes(k))));

  const done = app.tasks.filter(t => t.done && !t.archived);
  const doneCount = done.length;
  const clearCompleted = () => app.removeMany(done.map(t => t.id));

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: T.bg }]} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={[styles.h1, { color: T.text }]} accessibilityRole="header">Settings</Text>
      </View>
      <View style={[styles.rule, { backgroundColor: T.accent }]} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">

        <Section title="Looks" T={T}>
          <Row label="Appearance" T={T}>
            <Segmented label="Appearance" T={T} value={s.themeMode} onChange={s.setThemeMode}
              options={[{ label: "System", value: "auto" }, { label: "Light", value: "light" }, { label: "Dark", value: "dark" }]} />
          </Row>
          <Row label="Text size" T={T}>
            <Segmented label="Text size" T={T} value={s.textSize} onChange={s.setTextSize}
              options={[{ label: "Small", value: "small" }, { label: "Default", value: "default" }, { label: "Large", value: "large" }]} />
          </Row>
          <Row label="Layout" hint="How Home shows your tasks" T={T} />
          <View style={styles.layouts}>
            {(Object.entries(LAYOUTS) as [LayoutName, { name: string; desc: string }][]).map(([key, l]) => {
              const on = s.layout === key;
              return (
                <Pressable key={key} onPress={() => s.setLayout(key)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${l.name}, ${l.desc}`}
                  style={[styles.layoutBtn, { backgroundColor: on ? T.accent + "22" : "transparent", borderColor: on ? T.accent : T.border }]}>
                  <SymbolView name={LAYOUT_ICONS[key]} size={20} tintColor={on ? T.accent : T.textFaint} />
                  <Text style={{ fontFamily: F.bodyMedium, fontSize: fz(10), color: on ? T.accent : T.textMuted }}>{l.name}</Text>
                  <Text style={{ fontFamily: F.body, fontSize: fz(9), color: on ? T.accent : T.textMuted, opacity: 0.6, textAlign: "center" }}>{l.desc}</Text>
                </Pressable>
              );
            })}
          </View>
          <Row label="Animation speed" hint={s.animSpeed === 1 ? "Normal" : s.animSpeed < 1 ? "Slower" : "Faster"} T={T}>
            <Stepper value={s.animSpeed} onChange={s.setAnimSpeed} min={0.5} max={2} step={0.25} T={T} label="animation speed" unit="×" />
          </Row>
          <ToggleRow label="Urgency color coding" hint="Red, orange and green by how soon a task is due" value={s.colorCodeUrgency} onChange={s.setColorCodeUrgency} T={T} />
        </Section>

        <Section title="Date & time" T={T}>
          <Row label="Time format" T={T}>
            <Segmented label="Time format" T={T} value={s.timeFormat} onChange={s.setTimeFormat} options={[{ label: "12h", value: "12h" }, { label: "24h", value: "24h" }]} />
          </Row>
          <Row label="Week starts on" T={T}>
            <Segmented label="Week starts on" T={T} value={s.weekStart} onChange={s.setWeekStart} options={[{ label: "Sun", value: 0 }, { label: "Mon", value: 1 }]} />
          </Row>
          <ToggleRow label="Calendar shows only this month" hint="Off: six full weeks, with the days around it" value={s.calendarMonthOnly} onChange={s.setCalendarMonthOnly} T={T} />
        </Section>

        <Section title="Focus timer" T={T}>
          <ToggleRow label="Pomodoro" value={showsPomodoro(s.focusShow)} onChange={on => s.setFocusShow(focusShowFor(on, showsStopwatch(s.focusShow)))} T={T} />
          <ToggleRow label="Stopwatch" value={showsStopwatch(s.focusShow)} onChange={on => s.setFocusShow(focusShowFor(showsPomodoro(s.focusShow), on))} T={T} />
          {showsPomodoro(s.focusShow) && (
            <>
              <Row label="Focus length" T={T}><Stepper value={s.pomodoroWork} onChange={s.setPomodoroWork} min={5} max={180} step={5} T={T} label="focus length" unit="min" /></Row>
              <Row label="Break length" T={T}><Stepper value={s.pomodoroBreak} onChange={s.setPomodoroBreak} min={1} max={60} T={T} label="break length" unit="min" /></Row>
              <ToggleRow label="Start breaks automatically" value={s.pomodoroAutoBreak} onChange={s.setPomodoroAutoBreak} T={T} />
            </>
          )}
        </Section>

        <Section title="New task questions" T={T}>
          {prefs.map((p, i) => {
            const name = QUESTIONS.find(q => q.key === p.key)?.name ?? p.key;
            return (
              <Row key={p.key} label={name} T={T}>
                <View style={styles.inline}>
                  <Arrow glyph="▲" a11y={`Move ${name} up`} disabled={i === 0} T={T} onPress={() => s.setAddQuestions(moveQuestion(prefs, i, -1))} />
                  <Arrow glyph="▼" a11y={`Move ${name} down`} disabled={i === prefs.length - 1} T={T} onPress={() => s.setAddQuestions(moveQuestion(prefs, i, 1))} />
                  <Switch value={p.on} accessibilityLabel={`Ask ${name}`} trackColor={{ true: T.light ? "#333333" : "#cccccc", false: T.border }}
                    onValueChange={on => s.setAddQuestions(prefs.map(x => (x.key === p.key ? { ...x, on } : x)))} />
                </View>
              </Row>
            );
          })}
        </Section>

        <Section title="Subjects" T={T}>
          <View style={styles.subjects}>
            {s.subjects.map(name => {
              const confirming = pendingDelete === name;
              if (editing?.old === name) {
                const clash = s.subjects.some(x => x !== name && x.toLowerCase() === editing.name.trim().toLowerCase());
                return (
                  <View key={name} style={[styles.subjectEdit, { backgroundColor: T.surface }]}>
                    <TextInput value={editing.name} onChangeText={v => setEditing({ ...editing, name: v })} autoFocus maxLength={LIMITS.subject} accessibilityLabel="Subject name"
                      onSubmitEditing={saveSubject} returnKeyType="done"
                      style={[styles.input, { fontSize: fz(12), color: T.text, backgroundColor: T.card, borderColor: T.border, paddingVertical: 7 }]} />
                    <View style={styles.palette} accessibilityRole="radiogroup" accessibilityLabel="Subject color">
                      {SUBJECT_COLOR_PALETTE.map(c => (
                        <Pressable key={c} onPress={() => setEditing({ ...editing, color: c })} accessibilityRole="radio" accessibilityState={{ checked: editing.color === c }} accessibilityLabel={c}
                          style={[styles.swatchBtn, { backgroundColor: c, borderColor: editing.color === c ? T.text : "transparent" }]} />
                      ))}
                    </View>
                    {clash && <Text style={{ fontFamily: F.body, fontSize: fz(10), color: ink("#FF4757", T.light) }}>There&apos;s already a subject with that name</Text>}
                    <View style={styles.editBtns}>
                      <Pressable onPress={() => setEditing(null)} accessibilityRole="button" style={[styles.smallBtn, { borderWidth: 1, borderColor: T.border }]}>
                        <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textMuted }}>Cancel</Text>
                      </Pressable>
                      <Pressable onPress={saveSubject} accessibilityRole="button" style={[styles.smallBtn, { backgroundColor: T.accent }]}>
                        <Text style={{ fontFamily: F.body, fontSize: fz(11), color: contrastColor(T.accent) }}>Save</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              }
              return (
                <View key={name} style={[styles.subjectRow, { backgroundColor: T.surface }]}>
                  <View style={[styles.dot, { backgroundColor: s.subjectColors[name] || T.accent }]} />
                  <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.body, fontSize: fz(12), color: T.text }}>{name}</Text>
                  <Pressable onPress={() => { setPendingDelete(null); setEditing({ old: name, name, color: s.subjectColors[name] || SUBJECT_COLOR_PALETTE[0] }); }}
                    hitSlop={8} accessibilityRole="button" accessibilityLabel={`Edit ${name}`} accessibilityHint="Rename or change color">
                    <Text style={{ fontSize: fz(13), color: T.textFaint }}>✎</Text>
                  </Pressable>
                  <Pressable onPress={() => { if (confirming) { removeSubject(name); setPendingDelete(null); } else setPendingDelete(name); }}
                    hitSlop={8} accessibilityRole="button" accessibilityLabel={confirming ? `Confirm deleting ${name}` : `Delete ${name}`} accessibilityHint={confirming ? "Tasks keep their subject" : undefined}
                    style={confirming ? [styles.confirm, { backgroundColor: "#FF475722" }] : null}>
                    <Text style={{ fontFamily: F.body, fontSize: fz(confirming ? 11 : 15), color: confirming ? "#FF4757" : T.textFaint }}>{confirming ? "Delete?" : "×"}</Text>
                  </Pressable>
                </View>
              );
            })}
            <View style={styles.addSubject}>
              <TextInput
                value={newSubject}
                onChangeText={setNewSubject}
                onSubmitEditing={addSubject}
                submitBehavior="submit"
                editable={s.subjects.length < LIMITS.subjects}
                placeholder={s.subjects.length >= LIMITS.subjects ? `Limit of ${LIMITS.subjects} subjects reached` : "Add a subject..."}
                placeholderTextColor={T.textFaint}
                maxLength={LIMITS.subject}
                returnKeyType="done"
                accessibilityLabel="Add a subject"
                style={[styles.input, { flex: 1, fontSize: fz(12), color: T.text, backgroundColor: T.surface, borderColor: T.border }]}
              />
              <Pressable onPress={addSubject} disabled={!newSubject.trim()} accessibilityRole="button" style={[styles.smallBtn, { backgroundColor: T.accent, opacity: newSubject.trim() ? 1 : 0.5, justifyContent: "center" }]}>
                <Text style={{ fontFamily: F.bodyMedium, fontSize: fz(12), color: contrastColor(T.accent) }}>Add</Text>
              </Pressable>
            </View>
          </View>
        </Section>

        <Section title="Task list" T={T}>
          <Row label="Group by" hint="Groups the List layout into headed sections" T={T} />
          <View style={styles.segRow}>
            <Segmented label="Group by" T={T} value={s.groupBy} onChange={s.setGroupBy}
              options={[{ label: "None", value: "none" }, { label: "Subject", value: "subject" }, { label: "Priority", value: "priority" }, { label: "Due date", value: "dueDate" }]} />
          </View>
          {s.layout !== "list" && s.groupBy !== "none" && <Row label="Grouping only shows in the List layout" T={T} />}
          <ToggleRow label="Show smart suggestion" hint="The most urgent task, above the list" value={s.showSuggestion} onChange={s.setShowSuggestion} T={T} />
          <ToggleRow label="Show completed" value={s.showDone} onChange={s.setShowDone} T={T} />
          <Row label="Auto-archive completed" hint="Done tasks move to Archived after this long. You can still archive any task from its page." T={T} />
          <View style={styles.segRow}>
            <Segmented label="Auto-archive completed" T={T} value={s.autoArchiveDays} onChange={s.setAutoArchiveDays}
              options={[{ label: "Never", value: 0 }, { label: "1 day", value: 1 }, { label: "7 days", value: 7 }, { label: "30 days", value: 30 }]} />
          </View>
        </Section>

        <Section title="Reminders" T={T}>
          <ToggleRow label="Reminders" hint="Notifications for due tasks, even with the app closed" value={s.notifications} onChange={on => { setReminders(on).catch(() => {}); }} T={T} />
          {s.notifications && REMINDER_OFFSETS.map(o => (
            <ToggleRow key={o.key} label={o.label} value={s.reminderOffsets.includes(o.key)} onChange={on => toggleOffset(o.key, on)} T={T} />
          ))}
          {s.notifications && <Row label="Tasks with only a date" hint="Get one reminder at 8 AM on the day" T={T} />}
        </Section>

        <Pressable onPress={() => { Linking.openURL(FEEDBACK_URL).catch(() => {}); }} accessibilityRole="link" style={[styles.wide, { borderColor: T.border }]}>
          <Text style={[styles.wideText, { fontSize: fz(12), color: T.textMuted }]}>Send feedback / report a bug</Text>
        </Pressable>
        <Pressable onPress={() => { Linking.openURL(PRIVACY_URL).catch(() => {}); }} accessibilityRole="link" style={[styles.wide, { borderColor: T.border }]}>
          <Text style={[styles.wideText, { fontSize: fz(12), color: T.textMuted }]}>Privacy policy</Text>
        </Pressable>
        <Pressable onPress={clearCompleted} disabled={doneCount === 0} accessibilityRole="button" accessibilityHint="Deletes completed tasks that aren't archived. You can undo this"
          style={[styles.wide, { borderColor: "#FF475744", opacity: doneCount ? 1 : 0.45 }]}>
          <Text style={[styles.wideText, { fontSize: fz(12), color: ink("#FF4757", T.light) }]}>Clear completed{doneCount ? ` (${doneCount})` : ""}</Text>
        </Pressable>

        <Text style={[styles.foot, { fontSize: fz(11), color: T.textFaint }]}>DuePlanner {Constants.expoConfig?.version ?? ""}, by due. studios</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Arrow({ glyph, a11y, disabled, onPress, T }: { glyph: string; a11y: string; disabled: boolean; onPress: () => void; T: Theme }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={6} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ disabled }} style={[styles.arrow, { borderColor: T.border, opacity: disabled ? 0.3 : 1 }]}>
      <Text style={[styles.arrowGlyph, { color: T.text }]}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { padding: 16, paddingBottom: 140 },
  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14 },
  h1: { fontSize: 26, lineHeight: 30, fontFamily: F.heading },
  rule: { height: 1, marginBottom: 16 },
  inline: { flexDirection: "row", alignItems: "center", gap: 10 },
  swatch: { width: 14, height: 14, borderRadius: 7 },
  x: { fontSize: 20, lineHeight: 22, paddingHorizontal: 4 },
  addRow: { padding: 12 },
  input: { fontSize: 16, fontFamily: F.body, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  arrow: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  arrowGlyph: { fontSize: 11 },
  layouts: { flexDirection: "row", flexWrap: "wrap", gap: 7, paddingHorizontal: 14, paddingBottom: 12 },
  layoutBtn: { width: "31%", flexGrow: 1, borderWidth: 1.5, borderRadius: 11, paddingVertical: 10, paddingHorizontal: 7, alignItems: "center", gap: 4 },
  subjects: { padding: 12, gap: 6 },
  subjectRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 9, paddingVertical: 9, paddingHorizontal: 12 },
  subjectEdit: { borderRadius: 9, paddingVertical: 10, paddingHorizontal: 12, gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  palette: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  swatchBtn: { width: 22, height: 22, borderRadius: 11, borderWidth: 2 },
  editBtns: { flexDirection: "row", gap: 6, justifyContent: "flex-end" },
  smallBtn: { borderRadius: 8, paddingVertical: 5, paddingHorizontal: 12 },
  confirm: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  addSubject: { flexDirection: "row", gap: 8, marginTop: 2 },
  segRow: { paddingHorizontal: 14, paddingBottom: 12, alignItems: "flex-start" },
  wide: { borderWidth: 1, borderRadius: 9, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center", marginBottom: 8 },
  wideText: { fontSize: 12, fontFamily: F.body },
  foot: { fontSize: 11, fontFamily: F.body, textAlign: "center", marginTop: 8 },
});
