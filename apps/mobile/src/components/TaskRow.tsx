import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Task } from "@dueplanner/core/types";
import { formatDate, formatDuration, getPriority } from "@dueplanner/core/lib/format";
import { priColor } from "@dueplanner/core/constants";
import type { Theme } from "../theme/useTheme";
import { F } from "../theme/fonts";

interface Props { task: Task; T: Theme; onToggle: () => void; onDelete: () => void; }

export function TaskRow({ task, T, onToggle, onDelete }: Props) {
  const pr = getPriority(task.dueDate, task.estMins, task.priorityOverride);
  const meta = [task.subject, task.dueDate && formatDate(task.dueDate), formatDuration(task.estMins)].filter(Boolean).join("  ·  ");
  return (
    <View style={[styles.row, { backgroundColor: T.card, borderColor: T.border }]}>
      <View style={[styles.bar, { backgroundColor: task.done ? T.border : priColor(pr, true) }]} />
      <Pressable
        onPress={onToggle}
        hitSlop={10}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: task.done }}
        accessibilityLabel={task.done ? `Mark ${task.title} not done` : `Mark ${task.title} done`}
        style={[styles.check, { borderColor: task.done ? "#2ED573" : T.textMuted, backgroundColor: task.done ? "#2ED573" : "transparent" }]}
      >
        {task.done && <Text style={styles.tick}>✓</Text>}
      </Pressable>
      <View style={styles.body}>
        <Text
          style={[styles.title, { color: task.done ? T.textMuted : T.text, textDecorationLine: task.done ? "line-through" : "none" }]}
          numberOfLines={2}
        >
          {task.title}
        </Text>
        {!!meta && <Text style={[styles.meta, { color: T.textMuted }]} numberOfLines={1}>{meta}</Text>}
      </View>
      <Pressable onPress={onDelete} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Delete ${task.title}`} style={styles.del}>
        <Text style={[styles.delText, { color: T.textMuted }]}>×</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, overflow: "hidden", minHeight: 56, marginBottom: 8 },
  bar: { width: 3, alignSelf: "stretch" },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center", marginLeft: 12 },
  tick: { color: "#000", fontSize: 14, fontWeight: "700", lineHeight: 16 },
  body: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, gap: 2 },
  title: { fontSize: 15, fontFamily: F.body },
  meta: { fontSize: 11, fontFamily: F.body },
  del: { paddingHorizontal: 14, alignSelf: "stretch", justifyContent: "center" },
  delText: { fontSize: 22, lineHeight: 24 },
});
