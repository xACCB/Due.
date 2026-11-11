import { useState, useRef, type ComponentRef } from "react";
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { GROUP_BY, LAYOUTS, QUESTIONS, QUESTION_KEYS, REMINDER_OFFSETS, SUBJECT_COLOR_PALETTE, type LayoutName } from "@dueplanner/core/constants";
import { TEXT_SIZES, type TextSize } from "@dueplanner/core/lib/textSize";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { moveQuestion, normalizeQuestionPrefs } from "@dueplanner/core/lib/addQuestions";
import { recolouredSubjects, renamedSubjects, subjectRename, subjectToAdd, templatesRenamedSubject, withoutSubjectColor } from "@dueplanner/core/lib/taskActions";
import { focusShowFor, showsPomodoro, showsStopwatch } from "@dueplanner/core/lib/stopwatch";
import { contrastColor, ink } from "@dueplanner/core/lib/format";
import { LIMITS } from "@dueplanner/core/lib/limits";
import { useApp } from "../../state/appContext";
import { requestNotifications } from "../../lib/notifications";
import { F } from "../../theme/fonts";
import type { Theme } from "../../theme/types";
import { Label, Section, Slider, Tiles, Toggle, ToggleLine } from "../../components/ui";
import { useDevScroll } from "../../lib/devScroll";
import { AppHeader } from "../../components/AppHeader";

// Settings, in the web's sections and order (Looks, Date & time, Focus timer,
// New task questions, Subjects, Task list, Reminders), then feedback and
// Clear completed. Recently deleted is in History, as on the web.
const FEEDBACK_URL = "https://forms.gle/oPuAWx6jNHvm75xi8";
const PRIVACY_URL = "https://dueplanner.vercel.app/privacy.html";
// The web's Animation speed range: 0.5x to 2x in quarters.
const ANIM_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
// SF Symbols on iOS, Material Symbols on Android (as the tab bar does).
const LAYOUT_ICONS: Record<LayoutName, SymbolViewProps["name"]> = {
  list: { ios: "list.bullet", android: "list" }, board: { ios: "square.grid.2x2", android: "grid_view" },
  checklist: { ios: "checklist", android: "checklist" }, kanban: { ios: "rectangle.split.3x1", android: "view_kanban" },
  progress: { ios: "chart.bar.xaxis", android: "bar_chart" }, pyramid: { ios: "triangle", android: "change_history" },
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

  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  useDevScroll(scrollRef); // development only: the dev remote's "scroll"
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: T.bg }]} edges={["top", "left", "right"]}>
      <AppHeader title="Settings" />
      <ScrollView ref={scrollRef} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">

        <Section title="Looks" gap={20} T={T}>
          <View>
            <Label T={T}>Appearance</Label>
            <Tiles label="Appearance" T={T} columns={3} tall value={s.themeMode} onChange={s.setThemeMode}
              options={([["light", "Light", "○"], ["dark", "Dark", "●"], ["auto", "System", "◐"]] as const).map(([v, l, g]) => ({
                value: v, label: l, top: (on: boolean) => <Text style={{ fontSize: fz(15), color: on ? T.accent : T.textMuted }}>{g}</Text>,
              }))} />
            {s.themeMode === "auto" && <Text style={[styles.note, { fontSize: fz(10), color: T.textFaint, textAlign: "center" }]}>Following your device, currently {T.light ? "light" : "dark"}</Text>}
          </View>
          <View>
            <Label T={T}>Text size</Label>
            {/* The sample letters are fixed sizes, so each shows what it gives (the web's). */}
            <Tiles label="Text size" T={T} columns={3} tall value={s.textSize} onChange={s.setTextSize}
              options={(Object.keys(TEXT_SIZES) as TextSize[]).map((k, i) => ({
                value: k, label: TEXT_SIZES[k].name, top: (on: boolean) => <Text style={{ fontFamily: F.body, fontSize: [13, 16, 19][i], lineHeight: 22, color: on ? T.accent : T.textMuted }}>Aa</Text>,
              }))} />
          </View>
          <View>
            <Label T={T}>{`Layout (${Object.keys(LAYOUTS).length})`}</Label>
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
          </View>
          <ToggleLine caps label="Urgency Color Coding" hint="Red for urgent, green for not urgent" on={s.colorCodeUrgency} onChange={s.setColorCodeUrgency} T={T} />
          <View>
            <Label T={T} right={<Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.text }}>{s.animSpeed}×{s.animSpeed === 1 ? " (normal)" : ""}</Text>}>Animation speed</Label>
            <Slider label="Animation speed" T={T} value={s.animSpeed} values={ANIM_SPEEDS} onChange={s.setAnimSpeed} valueText={v => `${v} times normal speed`} />
            <View style={styles.sliderFoot}>
              <Text style={{ fontFamily: F.body, fontSize: fz(10), color: T.textFaint }}>Slower</Text>
              {s.animSpeed !== 1 && (
                <Pressable onPress={() => s.setAnimSpeed(1)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Reset animation speed">
                  <Text style={{ fontFamily: F.body, fontSize: fz(10), color: T.textMuted, textDecorationLine: "underline" }}>Reset</Text>
                </Pressable>
              )}
              <Text style={{ fontFamily: F.body, fontSize: fz(10), color: T.textFaint }}>Faster</Text>
            </View>
          </View>
        </Section>

        <Section title="Date & time" T={T}>
          <Text style={[styles.sub, { fontSize: fz(11), color: T.textMuted }]}>Time format</Text>
          <Tiles label="Time format" T={T} columns={2} value={s.timeFormat} onChange={s.setTimeFormat}
            options={[{ value: "12h", label: "12-hour (3:05 PM)" }, { value: "24h", label: "24-hour (15:05)" }]} />
          <Text style={[styles.sub, { fontSize: fz(11), color: T.textMuted, marginTop: 12 }]}>Week starts on</Text>
          <Tiles label="Week starts on" T={T} columns={2} value={s.weekStart} onChange={s.setWeekStart}
            options={[{ value: 0, label: "Sunday" }, { value: 1, label: "Monday" }]} />
          <Text style={[styles.sub, { fontSize: fz(11), color: T.textMuted, marginTop: 12 }]}>Calendar shows</Text>
          <Tiles label="Calendar shows" T={T} columns={2} value={s.calendarMonthOnly} onChange={s.setCalendarMonthOnly}
            options={[{ value: true, label: "This month only" }, { value: false, label: "Six full weeks" }]} />
        </Section>

        <Section title="Focus timer" T={T}>
          <View style={{ gap: 12, marginBottom: 14 }}>
            <ToggleLine label="Pomodoro timer" hint="Show it in Focus, above the task" on={showsPomodoro(s.focusShow)} onChange={on => s.setFocusShow(focusShowFor(on, showsStopwatch(s.focusShow)))} T={T} />
            <ToggleLine label="Stopwatch" hint="Show it in Focus, below the task" on={showsStopwatch(s.focusShow)} onChange={on => s.setFocusShow(focusShowFor(showsPomodoro(s.focusShow), on))} T={T} />
          </View>
          {showsPomodoro(s.focusShow) && (
            <>
              <Text style={[styles.sub, { fontSize: fz(11), color: T.textMuted }]}>Focus length</Text>
              <Tiles label="Focus length" T={T} columns={4} value={s.pomodoroWork} onChange={s.setPomodoroWork} options={[15, 25, 45, 60].map(v => ({ value: v, label: `${v} min` }))} />
              <Text style={[styles.sub, { fontSize: fz(11), color: T.textMuted, marginTop: 12 }]}>Break length</Text>
              <Tiles label="Break length" T={T} columns={4} value={s.pomodoroBreak} onChange={s.setPomodoroBreak} options={[5, 10, 15, 20].map(v => ({ value: v, label: `${v} min` }))} />
              <View style={{ marginTop: 12 }}>
                <ToggleLine label="Start breaks automatically" hint="When a focus session ends. After a break, you get a suggestion for what to work on next." on={s.pomodoroAutoBreak} onChange={s.setPomodoroAutoBreak} T={T} />
              </View>
            </>
          )}
        </Section>

        <Section title="New task questions" T={T}>
          <Text style={[styles.note, { fontSize: fz(10), color: T.textFaint, marginTop: 0, marginBottom: 10 }]}>Asked in this order after the title. Anything you turn off can still be filled in later on the task page.</Text>
          <View style={{ gap: 6 }}>
            <View style={[styles.qRow, { backgroundColor: T.surface, borderColor: T.border, paddingVertical: 8 }]}>
              <Text style={[styles.qNum, { fontSize: fz(10), color: T.textFaint }]}>1</Text>
              <Text style={{ flex: 1, fontFamily: F.body, fontSize: fz(12), color: T.textMuted }}>Title</Text>
              <Text style={{ fontFamily: F.body, fontSize: fz(10), color: T.textFaint }}>Always asked</Text>
            </View>
            {prefs.map((p, i) => {
              const name = QUESTIONS.find(q => q.key === p.key)?.name ?? p.key;
              const pos = p.on ? prefs.slice(0, i).filter(x => x.on).length + 2 : null;
              return (
                <View key={p.key} style={[styles.qRow, { backgroundColor: T.surface, borderColor: T.border, opacity: p.on ? 1 : 0.6 }]}>
                  <Text style={[styles.qNum, { fontSize: fz(10), color: T.textFaint }]}>{pos ?? "–"}</Text>
                  <Text style={{ flex: 1, fontFamily: F.body, fontSize: fz(12), color: p.on ? T.text : T.textMuted }}>{name}</Text>
                  <Arrow glyph="↑" a11y={`Move ${name} earlier`} disabled={i === 0} T={T} onPress={() => s.setAddQuestions(moveQuestion(prefs, i, -1))} />
                  <Arrow glyph="↓" a11y={`Move ${name} later`} disabled={i === prefs.length - 1} T={T} onPress={() => s.setAddQuestions(moveQuestion(prefs, i, 1))} />
                  <Toggle on={p.on} onChange={on => s.setAddQuestions(prefs.map(x => (x.key === p.key ? { ...x, on } : x)))} T={T} label={`Ask ${name}`} />
                </View>
              );
            })}
          </View>
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
              <Pressable onPress={addSubject} disabled={!newSubject.trim()} accessibilityRole="button" accessibilityState={{ disabled: !newSubject.trim() }} style={[styles.smallBtn, { backgroundColor: T.accent, opacity: newSubject.trim() ? 1 : 0.5, justifyContent: "center" }]}>
                <Text style={{ fontFamily: F.bodyMedium, fontSize: fz(12), color: contrastColor(T.accent) }}>Add</Text>
              </Pressable>
            </View>
          </View>
        </Section>

        <Section title="Task list" gap={18} T={T}>
          <View>
            <Label T={T}>Group Tasks By</Label>
            <Tiles label="Group tasks by" T={T} columns={2} tall value={s.groupBy} onChange={s.setGroupBy}
              options={(Object.entries(GROUP_BY) as [typeof s.groupBy, { name: string }][]).map(([k, g]) => ({ value: k, label: g.name }))} />
            {s.layout !== "list" && s.groupBy !== "none" && <Text style={[styles.note, { fontSize: fz(10), color: T.textFaint }]}>Grouping only shows in the List layout. You&apos;re using {LAYOUTS[s.layout].name}.</Text>}
          </View>
          <ToggleLine label="Show smart suggestion" hint="Your most urgent task, at the top of the list" on={s.showSuggestion} onChange={s.setShowSuggestion} T={T} />
          <ToggleLine label="Show completed tasks" hint="Keep done tasks visible" on={s.showDone} onChange={s.setShowDone} T={T} />
          <View>
            <Label T={T}>Auto-Archive Completed Tasks</Label>
            <Tiles label="Auto-archive completed tasks" T={T} columns={4} tall value={s.autoArchiveDays} onChange={s.setAutoArchiveDays}
              options={[{ value: 0, label: "Never" }, { value: 1, label: "1 day" }, { value: 7, label: "7 days" }, { value: 30, label: "30 days" }]} />
            <Text style={[styles.note, { fontSize: fz(10), color: T.textFaint }]}>Done tasks move to Archived after this long. You can still archive any task manually from its page.</Text>
          </View>
        </Section>

        <Section title="Reminders" T={T}>
          <ToggleLine label="Due date reminders" hint="Notifications for due tasks, even with the app closed" on={s.notifications} onChange={on => { setReminders(on).catch(() => {}); }} T={T} />
          {s.notifications && (
            <View style={[styles.remind, { borderTopColor: T.border }]}>
              <Text style={[styles.remindLabel, { fontSize: fz(10), color: T.textMuted }]}>REMIND ME</Text>
              <View style={{ gap: 6 }}>
                {REMINDER_OFFSETS.map(o => {
                  const on = s.reminderOffsets.includes(o.key);
                  return (
                    <Pressable key={o.key} onPress={() => toggleOffset(o.key, !on)} hitSlop={4} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={o.label} style={styles.offset}>
                      <View style={[styles.box, { borderColor: on ? T.accent : T.textFaint, backgroundColor: on ? T.accent : "transparent" }]}>
                        {on && <Text style={{ color: contrastColor(T.accent), fontSize: fz(10), fontWeight: "700" }}>✓</Text>}
                      </View>
                      <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.text }}>{o.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[styles.note, { fontSize: fz(10), color: T.textFaint }]}>Only applies to tasks with a specific due time set (not just a date). A task with only a date gets one reminder at 8 AM on the day.</Text>
            </View>
          )}
        </Section>

        <Pressable onPress={() => { Linking.openURL(FEEDBACK_URL).catch(() => {}); }} accessibilityRole="link" style={[styles.wide, { borderColor: T.border }]}>
          <Text style={[styles.wideText, { fontSize: fz(12), color: T.textMuted }]}>Send feedback / report a bug</Text>
        </Pressable>
        <Pressable onPress={clearCompleted} disabled={doneCount === 0} accessibilityRole="button" accessibilityState={{ disabled: doneCount === 0 }} accessibilityHint="Deletes completed tasks that aren't archived. You can undo this"
          style={[styles.wide, { borderColor: "#FF475744", opacity: doneCount ? 1 : 0.45 }]}>
          <Text style={[styles.wideText, { fontSize: fz(11), color: ink("#FF4757", T.light) }]}>{doneCount ? `Clear ${doneCount} task${doneCount === 1 ? "" : "s"} completed` : "No completed tasks to clear"}</Text>
        </Pressable>

        {/* The web's foot: the version, then the privacy policy as a link. */}
        <Text style={[styles.foot, { fontSize: fz(9), color: T.textFaint }]}>
          DuePlanner v{Constants.expoConfig?.version ?? ""} ·{" "}
          <Text onPress={() => { Linking.openURL(PRIVACY_URL).catch(() => {}); }} accessibilityRole="link" style={{ textDecorationLine: "underline" }}>Privacy policy</Text>
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Arrow({ glyph, a11y, disabled, onPress, T }: { glyph: string; a11y: string; disabled: boolean; onPress: () => void; T: Theme }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={6} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ disabled }} style={[styles.arrow, { borderColor: T.border, opacity: disabled ? 0.3 : 1 }]}>
      <Text style={[styles.arrowGlyph, { color: T.textMuted }]}>{glyph}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { padding: 16, paddingBottom: 140 },
  inline: { flexDirection: "row", alignItems: "center", gap: 10 },
  swatch: { width: 14, height: 14, borderRadius: 7 },
  x: { fontSize: 20, lineHeight: 22, paddingHorizontal: 4 },
  addRow: { padding: 12 },
  input: { fontSize: 16, fontFamily: F.body, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  arrow: { width: 28, height: 28, borderRadius: 7, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  arrowGlyph: { fontSize: 12 },
  layouts: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  layoutBtn: { width: "31%", flexGrow: 1, borderWidth: 1.5, borderRadius: 11, paddingVertical: 10, paddingHorizontal: 7, alignItems: "center", gap: 4 },
  subjects: { gap: 6 },
  subjectRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 9, paddingVertical: 9, paddingHorizontal: 12 },
  subjectEdit: { borderRadius: 9, paddingVertical: 10, paddingHorizontal: 12, gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  palette: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  swatchBtn: { width: 22, height: 22, borderRadius: 11, borderWidth: 2 },
  editBtns: { flexDirection: "row", gap: 6, justifyContent: "flex-end" },
  smallBtn: { borderRadius: 8, paddingVertical: 5, paddingHorizontal: 12 },
  confirm: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  addSubject: { flexDirection: "row", gap: 8, marginTop: 2 },
  sub: { fontFamily: F.body, marginBottom: 6 },
  note: { fontFamily: F.body, marginTop: 8 },
  sliderFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  qRow: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 9, paddingVertical: 6, paddingLeft: 10, paddingRight: 8 },
  qNum: { fontFamily: F.body, minWidth: 14 },
  remind: { marginTop: 12, paddingTop: 12, borderTopWidth: 1 },
  remindLabel: { fontFamily: F.body, letterSpacing: 0.8, marginBottom: 8 },
  offset: { flexDirection: "row", alignItems: "center", gap: 8 },
  box: { width: 16, height: 16, borderRadius: 4, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  wide: { borderWidth: 1, borderRadius: 9, paddingVertical: 10, paddingHorizontal: 14, alignItems: "center", marginBottom: 8 },
  wideText: { fontSize: 12, fontFamily: F.body },
  foot: { fontSize: 11, fontFamily: F.body, textAlign: "center", marginTop: 8 },
});
