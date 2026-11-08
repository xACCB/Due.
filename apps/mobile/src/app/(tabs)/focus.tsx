import { useEffect, useRef, useState } from "react";
import { AppState as RNAppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIsFocused } from "expo-router";
import { useKeepAwake } from "expo-keep-awake";
import * as Haptics from "expo-haptics";
import { showsPomodoro, showsStopwatch, formatStopwatch, stopwatchMinutes } from "@dueplanner/core/lib/stopwatch";
import { sortTasks } from "@dueplanner/core/lib/taskViews";
import { contrastColor, formatDate, formatDuration, formatTime, ink } from "@dueplanner/core/lib/format";
import { useApp } from "../../state/appContext";
import { usePersisted } from "../../lib/usePersisted";
import { clock } from "../../lib/clock";
import { cancelFocusEnd, requestNotifications, scheduleFocusEnd } from "../../lib/notifications";
import * as Fx from "../../state/focusTimer";
import { F } from "../../theme/fonts";
import { Ring } from "../../components/Ring";

// Focus (the web's Focus Mode): the task to work on, the Pomodoro and the
// stopwatch, as Settings -> Focus timer chooses. Time is logged to the task as
// work sessions. A running Pomodoro also schedules a notification for its end,
// so it tells you even with the app closed; the screen stays awake while a
// timer runs here.

const two = (n: number) => String(n).padStart(2, "0");
const endText = (phase: Fx.Phase): [string, string] =>
  phase === "work" ? ["Focus session done", "Time for a break."] : ["Break's over", "Ready for the next session?"];
const mmss = (secs: number) => `${two(Math.floor(secs / 60))}:${two(secs % 60)}`;

export default function FocusScreen() {
  const app = useApp();
  const { T, fz, h24 } = app;
  const { pomodoroWork, pomodoroBreak, pomodoroAutoBreak, focusShow, subjectColors } = app.settings;
  const L: Fx.Lengths = { work: pomodoroWork, brk: pomodoroBreak, autoBreak: pomodoroAutoBreak };
  const [state, setState] = usePersisted<Fx.FocusState>("hw-focus-state", Fx.initialFocus(pomodoroWork), raw => Fx.cleanFocus(raw, pomodoroWork));
  const [now, setNow] = useState(clock);
  const focused = useIsFocused();

  // The first open task in your own order, as on the web (topTask), unless
  // you've picked another.
  const openSorted = sortTasks(app.tasks, []).filter(t => !t.done && !t.archived);
  const topTask = openSorted[0];
  const task = openSorted.find(t => t.id === state.taskId) ?? topTask;
  const [picking, setPicking] = useState(false);
  const taskId = task?.id ?? null;

  // Applies a timer change, logging any finished work time to its task.
  const apply = (r: Fx.Result) => {
    setState(r.state);
    if (r.log) app.logSession(r.log.taskId, r.log.mins, clock());
  };

  // The latest values, for the ticking interval (set after each render).
  const live = useRef({ state, L, taskId, apply });
  useEffect(() => { live.current = { state, L, taskId, apply }; });

  const running = state.endAt != null || state.swStartedAt != null;
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const n = clock();
      setNow(n);
      const v = live.current;
      const done = Fx.finishIfDue(v.state, n, v.L, v.taskId);
      if (done) {
        // Seen at once by a second tick before the next render (returning to
        // the app can fire one alongside the interval), so it can't log twice.
        live.current = { ...v, state: done.state };
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        v.apply(done);
      }
    };
    tick();
    const t = setInterval(tick, 500);
    // Coming back to the app catches up at once (a phase may have ended meanwhile).
    const sub = RNAppState.addEventListener("change", s => { if (s === "active") tick(); });
    return () => { clearInterval(t); sub.remove(); };
  }, [running]);

  // A notification for the end of the running phase; none while paused.
  useEffect(() => {
    if (state.endAt == null) { cancelFocusEnd().catch(() => {}); return; }
    scheduleFocusEnd(state.endAt, ...endText(state.phase)).catch(() => {});
  }, [state.endAt, state.phase]);

  // Settings changed a length: an untouched timer follows it (adjusted while
  // rendering, React's pattern for state that follows a changed value).
  const [lastL, setLastL] = useState(L);
  if (lastL.work !== L.work || lastL.brk !== L.brk) {
    setLastL(L);
    setState(Fx.applyLengths(state, lastL, L));
  }

  // Starting: the clock is read now (not at the next tick), and iOS is asked
  // once for notifications so the end of the session can be announced.
  const startPomodoro = () => {
    const n = clock();
    const next = Fx.start(state, n);
    setNow(n);
    setState(next);
    // The effect above already tried to schedule the end, before permission
    // was given; once it is, schedule it again unless the timer moved on.
    requestNotifications().then(ok => {
      const cur = live.current.state;
      if (ok && next.endAt != null && cur.endAt === next.endAt) scheduleFocusEnd(next.endAt, ...endText(cur.phase)).catch(() => {});
    }).catch(() => {});
  };

  const total = Fx.phaseLength(state.phase, L);
  const secs = Math.min(Fx.remaining(state, now), Math.max(total, state.secsLeft));
  const pct = total ? Math.max(0, Math.min(1, 1 - secs / total)) : 0;
  const swMs = Fx.stopwatchMs(state, now);

  // The task's card (the web's): "up next" while it's the first open task in
  // your order, "focusing on" once you've picked another.
  const isTop = !!task && task.id === topTask?.id;
  const sc = task ? subjectColors[task.subject] || T.accent : T.accent;
  const onBreak = state.phase === "break";
  const markDone = () => {
    if (!task) return;
    apply(Fx.creditTask(state, clock(), L, task.id));
    app.toggle(task.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setPicking(false);
  };
  const ghost = [styles.btn, { borderWidth: 1, borderColor: T.border }];
  const solid = [styles.btn, { backgroundColor: T.accent }];

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: T.bg }]} edges={["top", "left", "right"]}>
      {running && focused && <KeepAwake />}
      <View style={styles.header}>
        <Text style={[styles.h1, { color: T.text }]} accessibilityRole="header">Focus</Text>
      </View>
      <View style={[styles.rule, { backgroundColor: T.accent }]} />
      <ScrollView contentContainerStyle={styles.body}>
        {showsPomodoro(focusShow) && (
          <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
            <Text style={[styles.kicker, { fontSize: fz(10), color: onBreak ? ink("#2ED573", T.light) : T.textMuted }]}>{onBreak ? "BREAK" : "POMODORO TIMER"}</Text>
            <View style={styles.ringBox}>
              <Ring pct={pct} size={100} stroke={6} color={onBreak ? "#2ED573" : T.accent} track={T.border}>
                <Text style={[styles.ringText, { fontSize: fz(18), color: T.text }]} accessibilityRole="timer" accessibilityLabel={`${Math.floor(secs / 60)} minutes ${secs % 60} seconds left`}>{mmss(secs)}</Text>
              </Ring>
            </View>
            <View style={styles.btnRow}>
              <Pressable onPress={() => (state.endAt == null ? startPomodoro() : setState(Fx.pause(state, clock())))} accessibilityRole="button" style={solid}>
                <Text style={[styles.btnText, { fontSize: fz(12), color: contrastColor(T.accent) }]}>{state.endAt != null ? "Pause" : onBreak ? "Start break" : "Start"}</Text>
              </Pressable>
              <Pressable onPress={() => apply(onBreak ? Fx.skipPhase(state, clock(), L, taskId) : Fx.reset(state, clock(), L, taskId))} accessibilityRole="button" style={ghost}>
                <Text style={[styles.btnText, { fontSize: fz(12), color: T.textMuted }]}>{onBreak ? "Skip break" : "Reset"}</Text>
              </Pressable>
            </View>
          </View>
        )}

        {task ? (
          <View style={[styles.taskCard, { backgroundColor: T.cardAlt, borderColor: T.accent + "44" }]}>
            <View style={styles.taskTop}>
              <Text style={[styles.badge, { fontSize: fz(10), backgroundColor: T.accent + "33", color: T.accent }]}>{isTop ? "up next" : "focusing on"}</Text>
              {!!task.subject && <Text style={[styles.pill, { fontSize: fz(10), backgroundColor: sc + "22", color: ink(sc, T.light) }]}>{task.subject}</Text>}
              <Pressable onPress={() => setPicking(o => !o)} accessibilityRole="button" accessibilityState={{ expanded: picking }} style={[styles.change, { borderColor: T.border }]}>
                <Text style={{ fontFamily: F.body, fontSize: fz(10), color: T.textMuted }}>{picking ? "Close" : "Change task"}</Text>
              </Pressable>
            </View>
            {picking && (
              <ScrollView style={styles.picker} contentContainerStyle={{ gap: 4 }} nestedScrollEnabled>
                {openSorted.map(t => {
                  const on = t.id === task.id;
                  return (
                    <Pressable key={t.id} onPress={() => { if (!on) apply(Fx.switchTask(state, clock(), L, taskId, t.id)); setPicking(false); }} accessibilityRole="button" accessibilityState={{ selected: on }}
                      style={[styles.pick, { backgroundColor: on ? T.accent + "22" : T.surface, borderColor: on ? T.accent : T.border }]}>
                      <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: fz(12), color: T.text }}>
                        {t.title}{!!t.subject && <Text style={{ color: T.textFaint }}> · {t.subject}</Text>}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
            <Text style={[styles.taskTitle, { color: T.text }]}>{task.title}</Text>
            {(!!task.dueDate || task.estMins > 0) && (
              <View style={styles.taskMeta}>
                {!!task.dueDate && <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.textMuted }}>{formatDate(task.dueDate)}{task.dueTime ? ` ${formatTime(task.dueTime, h24)}` : ""}</Text>}
                {task.estMins > 0 && <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.textMuted }}>{formatDuration(task.estMins)}</Text>}
              </View>
            )}
            <Pressable onPress={markDone} accessibilityRole="button" style={[styles.done, { backgroundColor: "#2ED57322", borderColor: "#2ED57344" }]}>
              <Text style={[styles.btnText, { fontSize: fz(13), color: ink("#2ED573", T.light) }]}>Mark done</Text>
            </Pressable>
          </View>
        ) : (
          <Text style={[styles.nothing, { fontSize: fz(13), color: T.textFaint }]}>Nothing left to focus on</Text>
        )}

        {showsStopwatch(focusShow) && (
          <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
            <Text style={[styles.kicker, { fontSize: fz(10), color: T.textMuted }]}>STOPWATCH</Text>
            <Text style={[styles.sw, { color: T.text }]} accessibilityRole="timer" accessibilityLabel="Stopwatch">{formatStopwatch(swMs)}</Text>
            <View style={styles.btnRow}>
              <Pressable onPress={() => { if (state.swStartedAt == null) { const n = clock(); setNow(n); setState(Fx.swStart(state, n)); } else setState(Fx.swPause(state, clock())); }} accessibilityRole="button" style={solid}>
                <Text style={[styles.btnText, { fontSize: fz(12), color: contrastColor(T.accent) }]}>{state.swStartedAt != null ? "Pause" : swMs > 0 ? "Resume" : "Start"}</Text>
              </Pressable>
              {swMs > 0 && (
                <Pressable onPress={() => setState(Fx.swReset(state))} accessibilityRole="button" style={ghost}>
                  <Text style={[styles.btnText, { fontSize: fz(12), color: T.textMuted }]}>Reset</Text>
                </Pressable>
              )}
              {swMs >= 30000 && !!task && (
                <Pressable onPress={() => apply(Fx.swLog(state, clock(), taskId))} accessibilityRole="button" style={ghost}>
                  <Text style={[styles.btnText, { fontSize: fz(12), color: T.textMuted }]}>Log {formatDuration(stopwatchMinutes(swMs))} to task</Text>
                </Pressable>
              )}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function KeepAwake() {
  useKeepAwake("focus");
  return null;
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14 },
  h1: { fontSize: 26, lineHeight: 30, fontFamily: F.heading },
  rule: { height: 1, marginBottom: 16 },
  body: { paddingHorizontal: 16, paddingBottom: 140, gap: 16 },
  card: { borderWidth: 1, borderRadius: 12, padding: 16, alignItems: "center" },
  kicker: { alignSelf: "flex-start", fontFamily: F.body, letterSpacing: 0.8, paddingBottom: 6 },
  ringBox: { marginVertical: 10 },
  ringText: { fontFamily: F.bodyMedium, fontVariant: ["tabular-nums"] },
  btnRow: { flexDirection: "row", gap: 8, justifyContent: "center", flexWrap: "wrap" },
  btn: { borderRadius: 9, paddingVertical: 8, paddingHorizontal: 18 },
  btnText: { fontFamily: F.body, textAlign: "center" },
  taskCard: { borderWidth: 1, borderRadius: 16, padding: 20 },
  taskTop: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 },
  badge: { fontFamily: F.bodyMedium, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  pill: { fontFamily: F.body, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  change: { marginLeft: "auto", borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 2 },
  picker: { maxHeight: 180, marginBottom: 12 },
  pick: { borderWidth: 1, borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10 },
  taskTitle: { fontFamily: F.heading, fontSize: 22, lineHeight: 28, marginBottom: 8 },
  taskMeta: { flexDirection: "row", gap: 12, flexWrap: "wrap" },
  done: { marginTop: 14, borderWidth: 1, borderRadius: 11, paddingVertical: 11, alignItems: "center" },
  nothing: { textAlign: "center", fontFamily: F.body },
  sw: { fontFamily: F.bodyMedium, fontSize: 34, fontVariant: ["tabular-nums"], marginTop: 6, marginBottom: 14 },
});
