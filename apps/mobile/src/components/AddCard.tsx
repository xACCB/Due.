import { useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import * as Haptics from "expo-haptics";
import { localDateStr } from "@dueplanner/core/lib/dates";
import { formatDate, formatDuration, formatTime, ink, contrastColor } from "@dueplanner/core/lib/format";
import { LIMITS } from "@dueplanner/core/lib/limits";
import * as A from "@dueplanner/core/lib/addFlow";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";
import { Chip } from "./ui";
import { DateField } from "./WebFields";
import type { TaskTemplate } from "@dueplanner/core/types";
import { useDevAction } from "../lib/devScroll";

// Adding a task (the web's add card, in place of "+ Add homework" at the foot
// of Home's list): "What's the assignment?", then the questions the New task
// questions setting asks, in its order (core's addFlow, like the web wizard).
// × drops the task.

const DATE_PICKS = [{ l: "Today", d: 0 }, { l: "Tomorrow", d: 1 }, { l: "3 days", d: 3 }, { l: "Next week", d: 7 }];
const TIME_PICKS = ["09:00", "15:00", "23:59"];
const ESTIMATE_PICKS = [{ l: "15 min", m: 15 }, { l: "30 min", m: 30 }, { l: "45 min", m: 45 }, { l: "1 hour", m: 60 }, { l: "1.5 hrs", m: 90 }, { l: "2 hrs", m: 120 }];
const REPEAT_PICKS = [{ l: "Doesn't repeat", v: "none" }, { l: "Daily", v: "daily" }, { l: "Weekly", v: "weekly" }, { l: "Monthly", v: "monthly" }];

function inDays(d: number): string {
  const dt = new Date();
  dt.setDate(dt.getDate() + d);
  return localDateStr(dt);
}

// `template`: start from a saved template (only the due date is asked; the
// caller adds the task directly when that question is off, see Home).
// `presetDate` (from Calendar) opens the date question on "What time?".
// `onAdded` gets the new task's title, for Home's toast.
export function AddCard({ presetDate, template, onClose, onAdded }: { presetDate?: string; template: TaskTemplate | null; onClose: () => void; onAdded: (title: string) => void }) {
  const app = useApp();
  const { T, h24, questions, fz } = app;
  const { subjects, subjectColors } = app.settings;
  const [flow, setFlow] = useState(() => (template && A.startFromTemplate(questions, template).flow) || A.startAdd(questions, presetDate));
  const [title, setTitle] = useState(template?.name ?? "");
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
      onAdded(next.done.title);
      onClose();
      return;
    }
    setFlow(next.flow);
  };
  // Development only: walk the questions without typing or tapping.
  useDevAction("add-title", t => run(A.submitTitle(flow, t)));
  useDevAction("add-skip", () => run(A.skip(flow)));

  const d = flow.draft;
  const total = flow.questions.length + 1;
  const at = flow.step + 1;

  return (
    <View style={[styles.card, { backgroundColor: T.card, borderColor: T.borderAccent }]}>
      {/* The web's add card: the step dots centred, × to cancel in the corner. */}
      <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Cancel" style={styles.cancel}>
        <Text style={{ fontSize: 20, lineHeight: 22, color: T.textFaint }}>×</Text>
      </Pressable>
      <View style={styles.dots} accessible accessibilityLabel={`Step ${at + 1} of ${total}`}>
        {Array.from({ length: total }, (_, i) => (
          <View key={i} style={[styles.dot, { width: i === at ? 20 : 6, backgroundColor: i <= at ? T.accent : T.border }]} />
        ))}
      </View>

        {flow.step === -1 && (
          <>
            <Text style={[styles.q, { fontSize: fz(17), color: T.accent }]} accessibilityRole="header">What&apos;s the assignment?</Text>
            <View style={styles.row}>
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
              style={[styles.input, { flex: 1, fontSize: 16, color: T.text, backgroundColor: T.surface, borderColor: T.border }]}
            />
            <Arrow onPress={() => run(A.submitTitle(flow, title))} label={flow.questions.length ? "Next" : "Add"} big />
            </View>
          </>
        )}

        {q?.type === "select" && (
          <>
            <Text style={[styles.q, { fontSize: fz(17), color: T.accent }]} accessibilityRole="header">{q.label}</Text>
            <View style={styles.wrap}>
              {subjects.map(s => <Chip key={s} label={s} color={subjectColors[s]} T={T} onPress={() => run(A.answer(flow, s))} />)}
            </View>
            {subjects.length === 0 && <Text style={[styles.note, { fontSize: fz(13), color: T.textMuted }]}>No subjects yet. Add some in Settings, or skip this.</Text>}
          </>
        )}

        {q?.type === "date" && flow.pendingDate == null && (
          <>
            <Text style={[styles.q, { fontSize: fz(17), color: T.accent }]} accessibilityRole="header">{q.label}</Text>
            <View style={styles.wrap}>
              {DATE_PICKS.map(p => <Chip key={p.l} label={p.l} T={T} onPress={() => run(A.pickDate(flow, inDays(p.d)))} />)}
              <View style={[styles.row, { flexGrow: 1, minWidth: 180 }]}>
                <View style={{ flex: 1 }}><DateField mode="date" label="Due date" bare value={customDate} onChange={setCustomDate} /></View>
                <Arrow onPress={() => { if (customDate) run(A.pickDate(flow, customDate)); }} label="Use this date" />
              </View>
            </View>
          </>
        )}

        {q?.type === "date" && flow.pendingDate != null && (
          <>
            <Text style={[styles.q, { fontSize: fz(17), color: T.accent }]} accessibilityRole="header">{q.label}</Text>
            <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textMuted, marginBottom: 10 }}>Due {formatDate(flow.pendingDate)}. What time?</Text>
            <View style={[styles.wrap, { marginBottom: 12 }]}>
              <Chip label="Any time" T={T} onPress={() => run(A.confirmTime(flow, ""))} />
              {TIME_PICKS.map(t => <Chip key={t} label={formatTime(t, h24)} T={T} onPress={() => run(A.confirmTime(flow, t))} />)}
            </View>
            <View style={styles.row}>
              <View style={{ flex: 1 }}><DateField mode="time" label="Due time" bare value={customTime} onChange={setCustomTime} /></View>
              <Arrow onPress={() => run(A.confirmTime(flow, customTime))} label="Use this time" />
            </View>
            <Pressable onPress={() => setFlow(A.back(flow))} hitSlop={8} accessibilityRole="button" style={styles.backLink}>
              <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textFaint }}>‹ Back to date</Text>
            </Pressable>
          </>
        )}

        {q?.type === "time" && (
          <>
            <Text style={[styles.q, { fontSize: fz(17), color: T.accent }]} accessibilityRole="header">{q.label}</Text>
            <View style={styles.wrap}>
              {ESTIMATE_PICKS.map(p => <Chip key={p.l} label={p.l} T={T} onPress={() => run(A.answer(flow, p.m))} />)}
            </View>
            {/* The web's custom time: ▲ / ▼ hours and minutes (minutes in fives, wrapping), the
                duration so far, and Set time →. */}
            <View style={[styles.custom, { backgroundColor: T.surface, borderColor: T.border }]}>
              <Text style={[styles.sub, { fontSize: fz(10), color: T.textFaint, marginTop: 0, marginBottom: 10 }]}>Custom time</Text>
              <View style={styles.spinners}>
                <Spinner value={hours} unit="hrs" label="hours" up={() => setHours(h => Math.min(23, h + 1))} down={() => setHours(h => Math.max(0, h - 1))} />
                <Text style={[styles.colon, { color: T.textMuted }]}>:</Text>
                <Spinner value={mins} unit="min" label="minutes" up={() => setMins(m => (m >= 55 ? 0 : m + 5))} down={() => setMins(m => (m <= 0 ? 55 : m - 5))} />
              </View>
              <View style={styles.setRow}>
                <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.textMuted }}>{formatDuration(hours * 60 + mins) || "Pick a duration"}</Text>
                <Pressable onPress={() => run(A.answer(flow, hours * 60 + mins))} disabled={hours * 60 + mins === 0} accessibilityRole="button"
                  accessibilityState={{ disabled: hours * 60 + mins === 0 }} accessibilityLabel={`Set ${formatDuration(hours * 60 + mins) || "time"}`}
                  style={[styles.setBtn, { backgroundColor: T.accent, opacity: hours * 60 + mins === 0 ? 0.4 : 1 }]}>
                  <Text style={{ fontFamily: F.bodyMedium, fontSize: fz(12), color: contrastColor(T.accent) }}>Set time →</Text>
                </Pressable>
              </View>
            </View>
          </>
        )}

        {q?.type === "recurrence" && (
          <>
            <Text style={[styles.q, { fontSize: fz(17), color: T.accent }]} accessibilityRole="header">{q.label}</Text>
            <View style={styles.wrap}>
              {REPEAT_PICKS.map(p => <Chip key={p.v} label={p.l} T={T} onPress={() => run(A.answer(flow, p.v))} />)}
            </View>
          </>
        )}


        {!!d.title && (
          <View style={[styles.preview, { backgroundColor: T.card, borderColor: T.border }]} accessible accessibilityLabel={`Adding ${d.title}`}>
            <Text style={[styles.previewLabel, { fontSize: fz(10), color: T.textFaint }]}>Adding</Text>
            <Text style={[styles.previewTitle, { fontSize: fz(16), color: T.text }]}>{d.title}</Text>
            <View style={styles.previewMeta}>
              {!!d.subject && <Text style={[styles.meta, { fontSize: fz(11), color: ink(subjectColors[d.subject] || T.accent, T.light) }]}>{d.subject}</Text>}
              {!!d.dueDate && <Text style={[styles.meta, { fontSize: fz(11), color: T.textMuted }]}>{formatDate(d.dueDate)}{d.dueTime ? ` at ${formatTime(d.dueTime, h24)}` : ""}</Text>}
              {!!d.recurrence && d.recurrence !== "none" && <Text style={[styles.meta, { fontSize: fz(11), color: T.textMuted }]}>↻ {d.recurrence}</Text>}
            </View>
          </View>
        )}
        {/* The web's ‹ Back and Skip › under the card, on every question. */}
        {flow.step > -1 && (
          <View style={styles.navRow}>
            <Pressable onPress={() => setFlow(A.back(flow))} accessibilityRole="button" accessibilityLabel="Go back" style={[styles.navBtn, { backgroundColor: T.cardAlt, borderColor: T.border }]}>
              <Text style={{ fontFamily: F.body, fontSize: fz(15), color: T.textMuted }}>‹ Back</Text>
            </Pressable>
            {!!q && (
              <Pressable onPress={() => run(A.skip(flow))} accessibilityRole="button" accessibilityLabel="Skip" style={[styles.navBtn, { backgroundColor: T.cardAlt, borderColor: T.border }]}>
                <Text style={{ fontFamily: F.body, fontSize: fz(15), color: T.textMuted }}>Skip ›</Text>
              </Pressable>
            )}
          </View>
        )}
    </View>
  );
}

// The web's black "→" beside a field.
function Arrow({ onPress, label, big }: { onPress: () => void; label: string; big?: boolean }) {
  const { T, fz } = useApp();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={({ pressed }) => [styles.arrow, big && styles.arrowBig, { backgroundColor: T.accent, opacity: pressed ? 0.8 : 1 }]}>
      <Text style={{ fontFamily: F.body, fontSize: fz(13), color: contrastColor(T.accent) }}>→</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 18 },
  cancel: { position: "absolute", top: 10, right: 12, padding: 4, zIndex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  arrow: { borderRadius: 10, paddingHorizontal: 13, alignSelf: "stretch", justifyContent: "center", minHeight: 36 },
  arrowBig: { paddingHorizontal: 16 },
  dots: { flexDirection: "row", gap: 5, alignItems: "center", justifyContent: "center", marginBottom: 14 },
  dot: { height: 6, borderRadius: 3 },
  q: { fontFamily: F.heading, marginBottom: 12 },
  input: { fontFamily: F.body, borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, paddingVertical: 10 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  sub: { fontSize: 11, fontFamily: F.body, letterSpacing: 1, textTransform: "uppercase", marginTop: 22, marginBottom: 8 },
  note: { fontSize: 13, fontFamily: F.body, marginTop: 10 },
  backLink: { marginTop: 14, alignSelf: "flex-start" },
  custom: { borderWidth: 1, borderRadius: 12, padding: 14, marginTop: 18 },
  spinners: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  colon: { fontFamily: F.heading, fontSize: 28, marginBottom: 16 },
  setRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 14 },
  setBtn: { borderRadius: 9, paddingVertical: 8, paddingHorizontal: 18 },
  navRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16 },
  navBtn: { borderWidth: 1, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 16 },
  preview: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 24 },
  previewLabel: { fontSize: 10, fontFamily: F.body, marginBottom: 2 },
  previewTitle: { fontSize: 16, fontFamily: F.heading },
  previewMeta: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 4 },
  meta: { fontSize: 11, fontFamily: F.body },
});

// One column of the web's custom time picker: ▲, the value, ▼, and its unit.
function Spinner({ value, unit, label, up, down }: { value: number; unit: string; label: string; up: () => void; down: () => void }) {
  const { T, fz } = useApp();
  const arrow = (glyph: string, a11y: string, onPress: () => void) => (
    <Pressable onPress={onPress} hitSlop={4} accessibilityRole="button" accessibilityLabel={a11y}
      style={[spin.btn, { backgroundColor: T.card, borderColor: T.border }]}>
      <Text style={{ fontSize: fz(14), color: T.text }}>{glyph}</Text>
    </Pressable>
  );
  return (
    <View style={spin.col}>
      {arrow("▲", `More ${label}`, up)}
      <Text style={[spin.value, { color: T.text }]} accessibilityLabel={`${value} ${label}`}>{String(value).padStart(2, "0")}</Text>
      {arrow("▼", `Fewer ${label}`, down)}
      <Text style={{ fontFamily: F.body, fontSize: fz(9), color: T.textFaint }}>{unit}</Text>
    </View>
  );
}

const spin = StyleSheet.create({
  col: { alignItems: "center", gap: 4 },
  btn: { width: 36, height: 28, borderRadius: 7, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  value: { fontFamily: F.heading, fontSize: 28, lineHeight: 30, minWidth: 44, textAlign: "center" },
});
