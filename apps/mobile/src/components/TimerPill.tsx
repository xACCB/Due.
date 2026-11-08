import { Pressable, StyleSheet, Text } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { formatStopwatch } from "@dueplanner/core/lib/stopwatch";
import { useApp } from "../state/appContext";
import { useNow } from "../lib/useNow";
import * as Fx from "../state/focusTimer";
import { F } from "../theme/fonts";

const two = (n: number) => String(n).padStart(2, "0");

// A running Pomodoro or stopwatch in Home's header (the web's .timer-pill):
// the Pomodoro's time left, else the stopwatch's. Opens Focus. Render it only
// while one runs, so its once-a-second clock only ticks then.
export function TimerPill() {
  const { T, fz, focus } = useApp();
  const now = useNow(1000);
  const text = focus.endAt != null
    ? `${two(Math.floor(Fx.remaining(focus, now) / 60))}:${two(Fx.remaining(focus, now) % 60)}`
    : formatStopwatch(Fx.stopwatchMs(focus, now));
  return (
    <Pressable onPress={() => router.navigate("/focus")} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Timer running, ${text}. Open Focus`}
      style={[styles.pill, { backgroundColor: T.card, borderColor: T.border }]}>
      <SymbolView name="timer" size={12} tintColor={T.text} />
      <Text style={[styles.text, { fontSize: fz(11), color: T.text }]}>{text}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 2 },
  text: { fontFamily: F.body, fontVariant: ["tabular-nums"] },
});
