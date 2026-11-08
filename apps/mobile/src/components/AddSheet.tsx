import { useRef, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { localDateStr } from "@dueplanner/core/lib/dates";
import { formatDate, formatDuration, formatTime, ink } from "@dueplanner/core/lib/format";
import { LIMITS } from "@dueplanner/core/lib/limits";
import * as A from "@dueplanner/core/lib/addFlow";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";
import { Button, Chip, Stepper } from "./ui";
import { DateTimeField } from "./DateTimeField";

// Adding a task: "What's the assignment?", then the questions the New task
// questions setting asks, in its order (core's addFlow, like the web wizard).
// A native page sheet: swipe it down or tap Cancel to drop the task.

const DATE_PICKS = [{ l: "Today", d: 0 }, { l: "Tomorrow", d: 1 }, { l: "3 days", d: 3 }, { l: "Next week", d: 7 }];
const TIME_PICKS = ["09:00", "15:00", "23:59"];
const ESTIMATE_PICKS = [{ l: "15 min", m: 15 }, { l: "30 min", m: 30 }, { l: "45 min", m: 45 }, { l: "1 hour", m: 60 }, { l: "1.5 hrs", m: 90 }, { l: "2 hrs", m: 120 }];
const REPEAT_PICKS = [{ l: "Doesn't repeat", v: "none" }, { l: "Daily", v: "daily" }, { l: "Weekly", v: "weekly" }, { l: "Monthly", v: "monthly" }];

function inDays(d: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  return localDateStr(dt);
}

export function AddSheet({ visible, presetDate, onClose }: { visible: boolean; presetDate?: string; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {/* Remounted per opening (visible), so every add starts fresh. */}
      {visible && <AddFlowView presetDate={presetDate} onClose={onClose} />}
    </Modal>
  );
}

function AddFlowView({ presetDate, onClose }: { presetDate?: string; onClose: () => void }) {
  const app = useApp();
  const { T, h24, questions } = app;
  const { subjects, subjectColors } = app.settings;
  const [flow, setFlow] = useState(() => A.startAdd(questions, presetDate));
  const [title, setTitle] = useState("");
  const [customDate, setCustomDate] = useState("");
  const [customTime, setCustomTime] = useState("");
  const [hours, setHours] = useState(0);
  const [mins, setMins] = useState(A.ESTIMATE_START);
  // One answer per tap: a quick second tap could otherwise skip a question.
  const busy = useRef(false);

  const q = A.currentQuestion(flow);
  const run = (next: A.AddStep) => {
    if (busy.current) return;
    if (next.done) {
      busy.current = true;
      app.add(next.done);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      onClose();
      return;
    }
    setFlow(next.flow);
  };

  const d = flow.draft;
  const total = questions.length + 1;
  const at = flow.step + 1;

  return (
    <KeyboardAvoidingView style={[styles.root, { backgroundColor: T.bg }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View style={styles.top}>
        <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel">
          <Text style={[styles.topBtn, { color: T.textMuted }]}>Cancel</Text>
        </Pressable>
        <View style={styles.dots} accessible accessibilityLabel={`Step ${at + 1} of ${total}`}>
          {Array.from({ length: total }, (_, i) => (
            <View key={i} style={[styles.dot, { width: i === at ? 20 : 6, backgroundColor: i <= at ? T.accent : T.border }]} />
          ))}
        </View>
        {q ? (
          <Pressable onPress={() => run(A.skip(flow))} hitSlop={10} accessibilityRole="button" accessibilityLabel="Skip">
            <Text style={[styles.topBtn, { color: T.textMuted }]}>Skip</Text>
          </Pressable>
        ) : <View style={styles.topSpacer} />}
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {flow.step === -1 && (
          <>
            <Text style={[styles.q, { color: T.accent }]} accessibilityRole="header">What&apos;s the assignment?</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              onSubmitEditing={() => run(A.submitTitle(flow, title))}
              submitBehavior="submit"
              autoFocus
              placeholder="e.g. Chapter 3 reading..."
              placeholderTextColor={T.textMuted}
              maxLength={LIMITS.title}
              returnKeyType="next"
              accessibilityLabel="What's the assignment?"
              style={[styles.input, { color: T.text, backgroundColor: T.surface, borderColor: T.border }]}
            />
            <Button label={questions.length ? "Next" : "Add"} onPress={() => run(A.submitTitle(flow, title))} disabled={!title.trim()} T={T} style={styles.next} />
          </>
        )}

        {q?.type === "select" && (
          <>
            <Text style={[styles.q, { color: T.accent }]} accessibilityRole="header">{q.label}</Text>
            <View style={styles.wrap}>
              {subjects.map(s => <Chip key={s} label={s} color={subjectColors[s]} T={T} onPress={() => run(A.answer(flow, s))} />)}
            </View>
            {subjects.length === 0 && <Text style={[styles.note, { color: T.textMuted }]}>No subjects yet. Add some in Settings, or skip this.</Text>}
          </>
        )}

        {q?.type === "date" && flow.pendingDate == null && (
          <>
            <Text style={[styles.q, { color: T.accent }]} accessibilityRole="header">{q.label}</Text>
            <View style={styles.wrap}>
              {DATE_PICKS.map(p => <Chip key={p.l} label={p.l} T={T} onPress={() => run(A.pickDate(flow, inDays(p.d)))} />)}
            </View>
            <Text style={[styles.sub, { color: T.textMuted }]}>Or pick a date</Text>
            <DateTimeField mode="date" value={customDate} onChange={setCustomDate} T={T} h24={h24} label="Due date" display="inline" />
            <Button label="Use this date" onPress={() => run(A.pickDate(flow, customDate || localDateStr(new Date())))} T={T} style={styles.next} />
          </>
        )}

        {q?.type === "date" && flow.pendingDate != null && (
          <>
            <Text style={[styles.q, { color: T.accent }]} accessibilityRole="header">Due {formatDate(flow.pendingDate)}. What time?</Text>
            <View style={styles.wrap}>
              <Chip label="Any time" T={T} onPress={() => run(A.confirmTime(flow, ""))} />
              {TIME_PICKS.map(t => <Chip key={t} label={formatTime(t, h24)} T={T} onPress={() => run(A.confirmTime(flow, t))} />)}
            </View>
            <Text style={[styles.sub, { color: T.textMuted }]}>Or pick a time</Text>
            <DateTimeField mode="time" value={customTime} onChange={setCustomTime} T={T} h24={h24} label="Due time" display="spinner" />
            <Button label="Set time" onPress={() => run(A.confirmTime(flow, customTime || "09:00"))} T={T} style={styles.next} />
            <Pressable onPress={() => setFlow(A.back(flow))} hitSlop={8} accessibilityRole="button" style={styles.backLink}>
              <Text style={[styles.note, { color: T.textMuted }]}>‹ Back to date</Text>
            </Pressable>
          </>
        )}

        {q?.type === "time" && (
          <>
            <Text style={[styles.q, { color: T.accent }]} accessibilityRole="header">{q.label}</Text>
            <View style={styles.wrap}>
              {ESTIMATE_PICKS.map(p => <Chip key={p.l} label={p.l} T={T} onPress={() => run(A.answer(flow, p.m))} />)}
            </View>
            <View style={[styles.custom, { backgroundColor: T.surface, borderColor: T.border }]}>
              <Text style={[styles.sub, { color: T.textMuted, marginTop: 0 }]}>Custom time</Text>
              <View style={styles.steppers}>
                <Stepper value={hours} onChange={setHours} min={0} max={23} T={T} label="hours" unit="h" />
                <Stepper value={mins} onChange={setMins} min={0} max={55} step={5} T={T} label="minutes" unit="m" />
              </View>
              <Button
                label={hours * 60 + mins ? `Set ${formatDuration(hours * 60 + mins)}` : "Pick a duration"}
                onPress={() => run(A.answer(flow, hours * 60 + mins))}
                disabled={hours * 60 + mins === 0}
                T={T}
                style={styles.next}
              />
            </View>
          </>
        )}

        {q?.type === "recurrence" && (
          <>
            <Text style={[styles.q, { color: T.accent }]} accessibilityRole="header">{q.label}</Text>
            <View style={styles.wrap}>
              {REPEAT_PICKS.map(p => <Chip key={p.v} label={p.l} T={T} onPress={() => run(A.answer(flow, p.v))} />)}
            </View>
          </>
        )}

        {flow.step > -1 && !(q?.type === "date" && flow.pendingDate != null) && (
          <Pressable onPress={() => setFlow(A.back(flow))} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back" style={styles.backLink}>
            <Text style={[styles.note, { color: T.textMuted }]}>‹ Back</Text>
          </Pressable>
        )}

        {!!d.title && (
          <View style={[styles.preview, { backgroundColor: T.card, borderColor: T.border }]} accessible accessibilityLabel={`Adding ${d.title}`}>
            <Text style={[styles.previewLabel, { color: T.textFaint }]}>Adding</Text>
            <Text style={[styles.previewTitle, { color: T.text }]}>{d.title}</Text>
            <View style={styles.previewMeta}>
              {!!d.subject && <Text style={[styles.meta, { color: ink(subjectColors[d.subject] || T.accent, T.light) }]}>{d.subject}</Text>}
              {!!d.dueDate && <Text style={[styles.meta, { color: T.textMuted }]}>{formatDate(d.dueDate)}{d.dueTime ? ` at ${formatTime(d.dueTime, h24)}` : ""}</Text>}
              {!!d.recurrence && d.recurrence !== "none" && <Text style={[styles.meta, { color: T.textMuted }]}>↻ {d.recurrence}</Text>}
            </View>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },
  topBtn: { fontSize: 14, fontFamily: F.body },
  topSpacer: { width: 36 },
  dots: { flexDirection: "row", gap: 5, alignItems: "center" },
  dot: { height: 6, borderRadius: 3 },
  body: { padding: 20, paddingBottom: 40 },
  q: { fontSize: 24, fontFamily: F.heading, marginBottom: 16 },
  input: { fontSize: 16, fontFamily: F.body, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12 },
  next: { marginTop: 14 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  sub: { fontSize: 11, fontFamily: F.body, letterSpacing: 1, textTransform: "uppercase", marginTop: 22, marginBottom: 8 },
  note: { fontSize: 13, fontFamily: F.body, marginTop: 10 },
  backLink: { marginTop: 14, alignSelf: "flex-start" },
  custom: { borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 18 },
  steppers: { flexDirection: "row", justifyContent: "space-around", flexWrap: "wrap", gap: 12 },
  preview: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 24 },
  previewLabel: { fontSize: 10, fontFamily: F.body, marginBottom: 2 },
  previewTitle: { fontSize: 16, fontFamily: F.heading },
  previewMeta: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  meta: { fontSize: 11, fontFamily: F.body },
});
