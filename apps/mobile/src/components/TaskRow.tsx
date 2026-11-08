import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Task } from "@dueplanner/core/types";
import { formatDate, formatDuration, formatTime, getPriority, ink } from "@dueplanner/core/lib/format";
import { priColor } from "@dueplanner/core/constants";
import type { Theme } from "../theme/types";
import { F } from "../theme/fonts";

interface Props {
  task: Task; T: Theme; h24: boolean; colorCode: boolean; subjectColor?: string;
  onToggle: () => void; onOpen: () => void; onDelete?: () => void;
}

// One task: the done check, title and details, and (on Home) delete. Tapping
// the row opens the task page. Empty fields show nothing (no "No date").
export function TaskRow({ task, T, h24, colorCode, subjectColor, onToggle, onOpen, onDelete }: Props) {
  const pr = getPriority(task.dueDate, task.estMins, task.priorityOverride);
  const due = task.dueDate ? formatDate(task.dueDate) + (task.dueTime ? ` ${formatTime(task.dueTime, h24)}` : "") : "";
  const rest = [due, formatDuration(task.estMins), task.recurrence && task.recurrence !== "none" ? `↻ ${task.recurrence}` : ""].filter(Boolean).join("  ·  ");
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`${task.title}${task.done ? ", done" : ""}${task.subject ? `, ${task.subject}` : ""}${due ? `, due ${due}` : ""}`}
      accessibilityHint="Opens the task"
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? T.cardAlt : T.card, borderColor: T.border }]}
    >
      <View style={[styles.bar, { backgroundColor: task.done ? T.border : priColor(pr, colorCode) }]} />
      <Pressable
        onPress={onToggle}
        hitSlop={12}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: task.done }}
        accessibilityLabel={task.done ? `Mark ${task.title} not done` : `Mark ${task.title} done`}
        style={[styles.check, { borderColor: task.done ? "#2ED573" : T.textMuted, backgroundColor: task.done ? "#2ED573" : "transparent" }]}
      >
        {task.done && <Text style={styles.tick}>✓</Text>}
      </Pressable>
      <View style={styles.body}>
        <Text style={[styles.title, { color: task.done ? T.textMuted : T.text, textDecorationLine: task.done ? "line-through" : "none" }]} numberOfLines={2}>
          {task.title}
        </Text>
        {(!!task.subject || !!rest) && (
          <Text style={styles.meta} numberOfLines={1}>
            {!!task.subject && <Text style={{ color: ink(subjectColor || T.accent, T.light) }}>{task.subject}</Text>}
            {!!task.subject && !!rest && <Text style={{ color: T.textMuted }}>{"  ·  "}</Text>}
            {!!rest && <Text style={{ color: T.textMuted }}>{rest}</Text>}
          </Text>
        )}
      </View>
      {onDelete && (
        <Pressable onPress={onDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Delete ${task.title}`} style={styles.del}>
          <Text style={[styles.delText, { color: T.textMuted }]}>×</Text>
        </Pressable>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, overflow: "hidden", minHeight: 56, marginBottom: 8 },
  bar: { width: 3, alignSelf: "stretch" },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center", marginLeft: 12 },
  tick: { color: "#000", fontSize: 14, fontWeight: "700", lineHeight: 16 },
  body: { flex: 1, paddingVertical: 10, paddingHorizontal: 12, gap: 3 },
  title: { fontSize: 15, fontFamily: F.body },
  meta: { fontSize: 11, fontFamily: F.body },
  del: { paddingHorizontal: 14, alignSelf: "stretch", justifyContent: "center" },
  delText: { fontSize: 22, lineHeight: 24 },
});
