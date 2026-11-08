import { useEffect, useRef, useState } from "react";
import { AppState as RNAppState, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useIsFocused } from "expo-router";
import { useKeepAwake } from "expo-keep-awake";
import * as Haptics from "expo-haptics";
import { showsPomodoro, showsStopwatch, formatStopwatch } from "@dueplanner/core/lib/stopwatch";
import { mostUrgent } from "@dueplanner/core/lib/timeLeft";
import { formatDuration } from "@dueplanner/core/lib/format";
import { useApp } from "../../state/appContext";
import { usePersisted } from "../../lib/usePersisted";
import { clock } from "../../lib/clock";
import { cancelFocusEnd, requestNotifications, scheduleFocusEnd } from "../../lib/notifications";
import * as Fx from "../../state/focusTimer";
import { F } from "../../theme/fonts";
import { Button, Chip } from "../../components/ui";

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
  const { T } = app;
  const { pomodoroWork, pomodoroBreak, pomodoroAutoBreak, focusShow } = app.settings;
  const L: Fx.Lengths = { work: pomodoroWork, brk: pomodoroBreak, autoBreak: pomodoroAutoBreak };
  const [state, setState] = usePersisted<Fx.FocusState>("hw-focus-state", Fx.initialFocus(pomodoroWork), raw => Fx.cleanFocus(raw, pomodoroWork));
  const [now, setNow] = useState(clock);
  const focused = useIsFocused();

  const open = app.tasks.filter(t => !t.done && !t.archived);
  const task = open.find(t => t.id === state.taskId) ?? mostUrgent(open);
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
  const logged = (task?.sessions ?? []).reduce((n, s) => n + s.mins, 0);

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: T.bg }]} edges={["top", "left", "right"]}>
      {running && focused && <KeepAwake />}
      <ScrollView contentContainerStyle={styles.body} contentInsetAdjustmentBehavior="automatic">
        <Text style={[styles.h1, { color: T.accent }]} accessibilityRole="header">Focus</Text>

        {showsPomodoro(focusShow) && (
          <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
            <Text style={[styles.phase, { color: T.textMuted }]}>{state.phase === "work" ? "FOCUS" : "BREAK"}</Text>
            <Text style={[styles.clock, { color: T.text }]} accessibilityRole="timer" accessibilityLabel={`${Math.floor(secs / 60)} minutes ${secs % 60} seconds left`}>{mmss(secs)}</Text>
            <View style={[styles.track, { backgroundColor: T.border }]}>
              <View style={[styles.fill, { width: `${Math.round(pct * 100)}%`, backgroundColor: state.phase === "work" ? T.accent : "#2ED573" }]} />
            </View>
            <View style={styles.row}>
              {state.endAt == null
                ? <Button label={secs === total ? "Start" : "Resume"} onPress={startPomodoro} T={T} style={styles.flex} />
                : <Button label="Pause" onPress={() => setState(Fx.pause(state, clock()))} T={T} style={styles.flex} />}
              <Button label="Reset" kind="plain" onPress={() => apply(Fx.reset(state, clock(), L, taskId))} T={T} disabled={Fx.untouched(state, L) && state.phase === "work"} style={styles.flex} />
              <Button label={state.phase === "work" ? "Break" : "Skip"} kind="plain" accessibilityLabel={state.phase === "work" ? "Take a break now" : "Skip the break"} onPress={() => apply(Fx.skipPhase(state, clock(), L, taskId))} T={T} style={styles.flex} />
            </View>
          </View>
        )}

        <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
          <Text style={[styles.phase, { color: T.textMuted }]}>WORKING ON</Text>
          {task ? (
            <>
              <Text style={[styles.task, { color: T.text }]}>{task.title}</Text>
              {logged > 0 && <Text style={[styles.small, { color: T.textMuted }]}>{formatDuration(logged)} worked so far</Text>}
            </>
          ) : (
            <Text style={[styles.small, { color: T.textMuted }]}>No open tasks. Add one on Home to log time to it.</Text>
          )}
          {open.length > 1 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickRow}>
              {open.map(t => (
                <Chip
                  key={t.id}
                  label={t.title.length > 24 ? t.title.slice(0, 23) + "…" : t.title}
                  accessibilityLabel={`Work on ${t.title}`}
                  selected={t.id === taskId}
                  T={T}
                  onPress={() => apply(Fx.switchTask(state, clock(), L, taskId, t.id))}
                />
              ))}
            </ScrollView>
          )}
        </View>

        {showsStopwatch(focusShow) && (
          <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
            <Text style={[styles.phase, { color: T.textMuted }]}>STOPWATCH</Text>
            <Text style={[styles.clockSmall, { color: T.text }]} accessibilityRole="timer">{formatStopwatch(swMs)}</Text>
            <View style={styles.row}>
              {state.swStartedAt == null
                ? <Button label={swMs ? "Resume" : "Start"} onPress={() => { const n = clock(); setNow(n); setState(Fx.swStart(state, n)); }} T={T} style={styles.flex} />
                : <Button label="Pause" onPress={() => setState(Fx.swPause(state, clock()))} T={T} style={styles.flex} />}
              <Button label="Reset" kind="plain" disabled={!swMs} onPress={() => setState(Fx.swReset(state))} T={T} style={styles.flex} />
            </View>
            {!!task && swMs >= 1000 && (
              <Pressable onPress={() => apply(Fx.swLog(state, clock(), taskId))} accessibilityRole="button" hitSlop={6} style={styles.logLink}>
                <Text style={[styles.small, { color: T.text, textDecorationLine: "underline" }]}>Log {Math.max(1, Math.round(swMs / 60000))}m to task</Text>
              </Pressable>
            )}
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
  body: { padding: 16, paddingBottom: 140 },
  h1: { fontSize: 34, fontFamily: F.heading, marginTop: 12, marginBottom: 16, marginLeft: 4 },
  card: { borderWidth: 1, borderRadius: 16, padding: 18, marginBottom: 14 },
  phase: { fontSize: 11, fontFamily: F.body, letterSpacing: 1, marginBottom: 8 },
  clock: { fontSize: 64, fontFamily: F.heading, textAlign: "center", marginVertical: 6, fontVariant: ["tabular-nums"] },
  clockSmall: { fontSize: 40, fontFamily: F.heading, textAlign: "center", marginVertical: 4, fontVariant: ["tabular-nums"] },
  track: { height: 4, borderRadius: 2, overflow: "hidden", marginTop: 6, marginBottom: 16 },
  fill: { height: 4 },
  row: { flexDirection: "row", gap: 8 },
  flex: { flex: 1 },
  task: { fontSize: 20, fontFamily: F.heading },
  small: { fontSize: 12, fontFamily: F.body, marginTop: 4 },
  pickRow: { gap: 8, paddingTop: 14 },
  logLink: { alignSelf: "center", marginTop: 12 },
});
