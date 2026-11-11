import { Pressable, StyleSheet, Text } from "react-native";
import * as Haptics from "expo-haptics";
import type { Task } from "@dueplanner/core/types";
import { formatDuration, formatTime, ink } from "@dueplanner/core/lib/format";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";

const DONE_GREEN = "#2ED573";

// A task on a Calendar day or a Deck card (the web's rows there): the check,
// the title, the subject, and the due time (or the estimate when there's none).
// `surface`: the Month view's day panel uses the surface colour, the Deck the card colour.
// `note`: replaces the due time / estimate on the right (Time left's "Tomorrow · 2h").
export function DayTaskRow({ t, surface, note, onOpen }: { t: Task; surface?: boolean; note?: string; onOpen: () => void }) {
  const app = useApp();
  const { T, fz, h24 } = app;
  const sc = app.settings.subjectColors[t.subject] || T.accent;
  const right = note ?? (t.dueTime ? formatTime(t.dueTime, h24) : t.estMins > 0 ? formatDuration(t.estMins) : "");
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${t.title}${t.done ? ", done" : ""}${t.subject ? `, ${t.subject}` : ""}${right ? `, ${right}` : ""}`}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? T.cardAlt : surface ? T.surface : T.card }]}>
      <Pressable
        onPress={() => { app.toggle(t.id); if (!t.done) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}); }}
        hitSlop={10}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: t.done }}
        accessibilityLabel={t.done ? `Mark ${t.title} not done` : `Mark ${t.title} done`}
        style={[styles.check, { borderColor: t.done ? DONE_GREEN : T.textFaint, backgroundColor: t.done ? DONE_GREEN : "transparent" }]}
      >
        {t.done && <Text style={styles.tick}>✓</Text>}
      </Pressable>
      <Text numberOfLines={1} style={[styles.title, { fontSize: fz(surface ? 14 : 15), color: t.done ? T.textFaint : T.text, textDecorationLine: t.done ? "line-through" : "none" }]}>{t.title}</Text>
      {!!t.subject && <Text style={[styles.pill, { fontSize: fz(10), backgroundColor: sc + "22", color: ink(sc, T.light) }]}>{t.subject}</Text>}
      {!!right && <Text style={{ fontFamily: F.body, fontSize: fz(10), color: T.textMuted }}>{right}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 11 },
  check: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  tick: { color: "#111", fontSize: 10, lineHeight: 12, fontWeight: "700" },
  title: { flex: 1, fontFamily: F.heading },
  pill: { fontFamily: F.body, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
});
