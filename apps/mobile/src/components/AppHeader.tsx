import { Pressable, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import { formatDuration } from "@dueplanner/core/lib/format";
import { timeLeft } from "@dueplanner/core/lib/taskViews";
import { todayISO } from "@dueplanner/core/lib/dates";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";
import { TimerPill } from "./TimerPill";

// The web's header, shared by Home, Calendar and Settings: the menu button
// (the web's sidebar button), the screen's name, a running timer's pill, and
// Time left (opens its breakdown), with the accent rule under it.
export function AppHeader({ title }: { title: string }) {
  const app = useApp();
  const { T, fz } = app;
  // "3h 20m", or "0m" (the web header's fmtMins).
  const left = formatDuration(timeLeft(app.tasks, todayISO()).totalMins) || "0m";
  return (
    <>
      <View style={styles.header}>
        <View style={styles.left}>
          <Pressable onPress={() => router.push("/menu")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Open menu" accessibilityHint="Inbox, History, Import/Export and your subjects">
            <SymbolView name={{ ios: "sidebar.left", android: "left_panel_open" }} size={21} tintColor={T.textMuted} />
          </Pressable>
          <Text style={[styles.h1, { color: T.text }]} accessibilityRole="header">{title}</Text>
        </View>
        <View style={styles.right}>
          {(app.focus.endAt != null || app.focus.swStartedAt != null) && <TimerPill />}
          <Pressable onPress={() => router.push("/time-left")} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Time left: ${left}. Show the breakdown`} style={styles.timeLeft}>
            <Text style={[styles.tlLabel, { fontSize: fz(9), color: T.textFaint }]}>Time left</Text>
            <Text style={[styles.tlValue, { color: T.light ? "#000" : "#fff" }]}>{left}</Text>
          </Pressable>
        </View>
      </View>
      <View style={[styles.rule, { backgroundColor: T.accent }]} />
    </>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14 },
  left: { flexDirection: "row", alignItems: "center", gap: 12, flexShrink: 1 },
  h1: { fontSize: 26, lineHeight: 30, fontFamily: F.heading },
  right: { flexDirection: "row", alignItems: "flex-end", gap: 12 },
  timeLeft: { alignItems: "flex-end" },
  tlLabel: { fontFamily: F.body },
  tlValue: { fontFamily: F.heading, fontSize: 20, lineHeight: 24 },
  rule: { height: 1, marginBottom: 16 },
});
