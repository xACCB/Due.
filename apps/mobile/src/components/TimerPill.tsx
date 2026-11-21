import { Pressable, StyleSheet, Text } from "react-native";
import Animated from "react-native-reanimated";
import { router } from "expo-router";
import { useApp } from "../state/appContext";
import { useNow } from "../lib/useNow";
import * as Fx from "../state/focusTimer";
import { F } from "../theme/fonts";
import { IconFocus } from "./icons";
import { fadeIn } from "../lib/motion";

// A running Pomodoro or stopwatch in the header (the web's .timer-pill): the
// Pomodoro's time left, else the stopwatch's. Opens Focus. Render it only
// while one runs, so its once-a-second clock only ticks then.
export function TimerPill() {
  const { T, fz, focus, ms } = useApp();
  const now = useNow(1000);
  const text = Fx.runningText(focus, now) ?? "";
  // Fades in as the web's does (.fade-in).
  return (
    <Animated.View entering={fadeIn(ms(200))}>
    <Pressable onPress={() => router.navigate("/focus")} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Timer running, ${text}. Open Focus`}
      style={[styles.pill, { backgroundColor: T.card, borderColor: T.border }]}>
      <IconFocus color={T.text} />
      <Text style={[styles.text, { fontSize: fz(11), color: T.text }]}>{text}</Text>
    </Pressable>
    </Animated.View>
  );
}

// The same time as plain text, for the sidebar's Focus row.
export function TimerText({ color, size }: { color: string; size: number }) {
  const { focus } = useApp();
  const now = useNow(1000);
  return <Text style={[styles.text, { fontSize: size, color }]}>{Fx.runningText(focus, now)}</Text>;
}

const styles = StyleSheet.create({
  pill: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 2 },
  text: { fontFamily: F.body, fontVariant: ["tabular-nums"] },
});
