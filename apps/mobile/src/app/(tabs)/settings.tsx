import { useState } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { QUESTIONS, QUESTION_KEYS, REMINDER_OFFSETS } from "@dueplanner/core/constants";
import { moveQuestion, normalizeQuestionPrefs } from "@dueplanner/core/lib/addQuestions";
import { subjectToAdd, withoutSubjectColor } from "@dueplanner/core/lib/taskActions";
import { focusShowFor, showsPomodoro, showsStopwatch } from "@dueplanner/core/lib/stopwatch";
import { formatAgo } from "@dueplanner/core/lib/format";
import { LIMITS } from "@dueplanner/core/lib/limits";
import { useApp } from "../../state/appContext";
import { clock } from "../../lib/clock";
import { requestNotifications } from "../../lib/notifications";
import { F } from "../../theme/fonts";
import type { Theme } from "../../theme/types";
import { Row, Section, Segmented, Stepper, ToggleRow } from "../../components/ui";

// Settings, in the web's sections (Looks, Date & time, Task list, New task
// questions, Subjects, Focus timer, Reminders), plus Recently deleted.
export default function SettingsScreen() {
  const app = useApp();
  const { T } = app;
  const s = app.settings;
  const [newSubject, setNewSubject] = useState("");
  const prefs = normalizeQuestionPrefs(s.addQuestions, QUESTION_KEYS);
  const now = clock();

  const addSubject = () => {
    const add = subjectToAdd(newSubject, s.subjects, s.subjectColors);
    if (add) {
      s.setSubjects([...s.subjects, add.name]);
      s.setSubjectColors({ ...s.subjectColors, [add.name]: add.color });
    }
    setNewSubject("");
  };
  const removeSubject = (name: string) => {
    Alert.alert(`Remove ${name}?`, "Tasks keep their subject; it just leaves this list.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => { s.setSubjects(s.subjects.filter(x => x !== name)); s.setSubjectColors(withoutSubjectColor(s.subjectColors, name)); } },
    ]);
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

  const trash = [...app.trash].sort((a, b) => b.deletedAt - a.deletedAt);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: T.bg }]} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.body} contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled">
        <Text style={[styles.h1, { color: T.accent }]} accessibilityRole="header">Settings</Text>

        <Section title="Looks" T={T}>
          <Row label="Appearance" T={T}>
            <Segmented label="Appearance" T={T} value={s.themeMode} onChange={s.setThemeMode}
              options={[{ label: "System", value: "auto" }, { label: "Light", value: "light" }, { label: "Dark", value: "dark" }]} />
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

        <Section title="Task list" T={T}>
          <ToggleRow label="Show completed" value={s.showDone} onChange={s.setShowDone} T={T} />
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
          {s.subjects.map(name => (
            <Row key={name} label={name} T={T}>
              <View style={styles.inline}>
                <View style={[styles.swatch, { backgroundColor: s.subjectColors[name] || T.textMuted }]} />
                <Pressable onPress={() => removeSubject(name)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Remove ${name}`}>
                  <Text style={[styles.x, { color: T.textMuted }]}>×</Text>
                </Pressable>
              </View>
            </Row>
          ))}
          {s.subjects.length < LIMITS.subjects && (
            <View style={styles.addRow}>
              <TextInput
                value={newSubject}
                onChangeText={setNewSubject}
                onSubmitEditing={addSubject}
                submitBehavior="submit"
                placeholder="Add a subject..."
                placeholderTextColor={T.textMuted}
                maxLength={LIMITS.subject}
                returnKeyType="done"
                accessibilityLabel="Add a subject"
                style={[styles.input, { color: T.text, backgroundColor: T.surface, borderColor: T.border }]}
              />
            </View>
          )}
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

        <Section title="Reminders" T={T}>
          <ToggleRow label="Reminders" hint="Notifications for due tasks, even with the app closed" value={s.notifications} onChange={on => { setReminders(on).catch(() => {}); }} T={T} />
          {s.notifications && REMINDER_OFFSETS.map(o => (
            <ToggleRow key={o.key} label={o.label} value={s.reminderOffsets.includes(o.key)} onChange={on => toggleOffset(o.key, on)} T={T} />
          ))}
          {s.notifications && <Row label="Tasks with only a date" hint="Get one reminder at 8 AM on the day" T={T} />}
        </Section>

        <Section title="Recently deleted" T={T}>
          {trash.length === 0 && <Row label="Nothing deleted in the last 30 days" T={T} />}
          {trash.slice(0, 50).map(e => (
            <Row key={e.task.id} label={e.task.title} hint={`Deleted ${formatAgo(e.deletedAt, now)}`} T={T}>
              <Pressable onPress={() => app.restore(e.task.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Restore ${e.task.title}`}>
                <Text style={[styles.link, { color: T.text }]}>Restore</Text>
              </Pressable>
            </Row>
          ))}
        </Section>

        <Text style={[styles.foot, { color: T.textFaint }]}>DuePlanner {Constants.expoConfig?.version ?? ""}, by due. studios</Text>
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
  h1: { fontSize: 34, fontFamily: F.heading, marginTop: 12, marginBottom: 18, marginLeft: 4 },
  inline: { flexDirection: "row", alignItems: "center", gap: 10 },
  swatch: { width: 14, height: 14, borderRadius: 7 },
  x: { fontSize: 20, lineHeight: 22, paddingHorizontal: 4 },
  addRow: { padding: 12 },
  input: { fontSize: 16, fontFamily: F.body, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  arrow: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  arrowGlyph: { fontSize: 11 },
  link: { fontSize: 13, fontFamily: F.body, textDecorationLine: "underline" },
  foot: { fontSize: 11, fontFamily: F.body, textAlign: "center", marginTop: 8 },
});
