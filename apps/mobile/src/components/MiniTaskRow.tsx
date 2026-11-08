import { Pressable, StyleSheet, Text } from "react-native";
import * as Haptics from "expo-haptics";
import type { Task } from "@dueplanner/core/types";
import { ink } from "@dueplanner/core/lib/format";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";

const DONE_GREEN = "#2ED573";

// A compact task row (the web's CardTaskRow): the done check, the title and
// the subject, plus an optional note on the right. Used where tasks are listed
// inside something else (Time left, a Calendar day, the menu's subjects).
export function MiniTaskRow({ t, note, onOpen, noCheck }: { t: Task; note?: string; onOpen: () => void; noCheck?: boolean }) {
  const app = useApp();
  const { T, fz } = app;
  const sc = app.settings.subjectColors[t.subject] || T.accent;
  return (
    <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={`${t.title}${t.done ? ", done" : ""}${t.subject ? `, ${t.subject}` : ""}${note ? `, ${note}` : ""}`}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? T.cardAlt : T.card }]}>
      {!noCheck && (
        <Pressable
          onPress={() => {
            app.toggle(t.id);
            if (!t.done) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
          }}
          hitSlop={10}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: t.done }}
          accessibilityLabel={t.done ? `Mark ${t.title} not done` : `Mark ${t.title} done`}
          style={[styles.check, { borderColor: t.done ? DONE_GREEN : T.textFaint, backgroundColor: t.done ? DONE_GREEN : "transparent" }]}
        >
          {t.done && <Text style={styles.tick}>✓</Text>}
        </Pressable>
      )}
      <Text numberOfLines={1} style={[styles.title, { fontSize: fz(15), color: t.done ? T.textFaint : T.text, textDecorationLine: t.done ? "line-through" : "none" }]}>{t.title}</Text>
      {!!t.subject && <Text style={[styles.pill, { fontSize: fz(10), backgroundColor: sc + "22", color: ink(sc, T.light) }]}>{t.subject}</Text>}
      {!!note && <Text style={[styles.note, { fontSize: fz(10), color: T.textMuted }]}>{note}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 11 },
  check: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  tick: { color: "#111", fontSize: 10, lineHeight: 12, fontWeight: "700" },
  title: { flex: 1, fontFamily: F.heading },
  pill: { fontFamily: F.body, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  note: { fontFamily: F.body },
});
