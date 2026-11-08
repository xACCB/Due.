import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import type { Task } from "@dueplanner/core/types";
import { priColor } from "@dueplanner/core/constants";
import { countdown, daysUntil, formatDate, formatDuration, formatTime, getPriority, ink } from "@dueplanner/core/lib/format";
import type { Theme } from "../theme/types";
import { F } from "../theme/fonts";
import { Swipe } from "./Swipe";

const DONE_GREEN = "#2ED573";

interface Props {
  task: Task;
  rank: number; // place among open tasks (0: "do first", 1: "next up"), -1 for none
  T: Theme; fz: (px: number) => number; h24: boolean; colorCode: boolean; now: number;
  subjectColor?: string;
  onOpen: () => void;
  onToggle: () => void;
  onDelete: () => void;
  // The List's drag handle (open tasks, no grouping): `drop(dy)` when let go
  // after dragging dy pixels, `moveBy(±1)` for the accessibility actions,
  // `dragging(on)` so the list can stop scrolling meanwhile, `height(px)` so
  // it knows how far each card is.
  reorder?: { drop: (dy: number) => void; moveBy: (delta: number) => void; dragging: (on: boolean) => void; height: (px: number) => void };
}

// One task on Home: the web's MiniCard. A swipe right marks it done (or not
// done), a swipe left deletes it, as on the web; the check and × do the same
// with a tap. Tapping the card opens the task page.
export function TaskCard({ task, rank, T, fz, h24, colorCode, now, subjectColor, onOpen, onToggle, onDelete, reorder }: Props) {
  const [dy] = useState(() => new Animated.Value(0));
  const [held, setHeld] = useState(false);
  const handlers = useRef(reorder);
  useEffect(() => { handlers.current = reorder; });
  // Created once; it reads the latest callbacks through `handlers`, and only
  // during a drag (the lint can't tell PanResponder callbacks from render code).
  // eslint-disable-next-line react-hooks/refs
  const [grip] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { setHeld(true); handlers.current?.dragging(true); },
    onPanResponderMove: (_, g) => dy.setValue(g.dy),
    onPanResponderRelease: (_, g) => { handlers.current?.drop(g.dy); dy.setValue(0); setHeld(false); handlers.current?.dragging(false); },
    onPanResponderTerminate: () => { dy.setValue(0); setHeld(false); handlers.current?.dragging(false); },
  }));
  const pr = getPriority(task.dueDate, task.estMins, task.priorityOverride);
  const sc = subjectColor || T.accent;
  const dm = countdown(task.dueDate, task.dueTime, now) ?? daysUntil(task.dueDate);
  const live = !task.done;
  const isTop = rank === 0 && live;
  const isNext = rank === 1 && live;
  const subs = task.subtasks ?? [];
  const subsDone = subs.filter(s => s.done).length;
  const due = task.dueDate ? formatDate(task.dueDate) + (task.dueTime ? ` ${formatTime(task.dueTime, h24)}` : "") : "";

  return (
    <Animated.View onLayout={e => reorder?.height(e.nativeEvent.layout.height + 10)}
      style={held ? { transform: [{ translateY: dy }, { scale: 1.02 }], zIndex: 10, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 8 } } : null}>
    <Swipe done={task.done} radius={13} gap={10} onToggle={onToggle} onDelete={onDelete}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${task.title}${task.done ? ", done" : ""}${task.subject ? `, ${task.subject}` : ""}${due ? `, due ${due}` : ""}`}
        accessibilityHint="Opens the task. Swipe right to mark it done, left to delete it."
        accessibilityActions={[{ name: "toggle", label: task.done ? "Mark not done" : "Mark done" }, { name: "delete", label: "Delete" }]}
        onAccessibilityAction={e => (e.nativeEvent.actionName === "toggle" ? onToggle() : onDelete())}
        style={({ pressed }) => [
          styles.card,
          {
            backgroundColor: pressed ? T.cardAlt : isTop ? T.cardAlt : T.card,
            borderColor: isTop ? T.accent + "44" : !live ? "transparent" : T.border,
          },
        ]}
      >
        {live && <View style={[styles.bar, { backgroundColor: priColor(pr, colorCode) }]} />}
        <View style={styles.row}>
          {!!reorder && live && (
            <View
              {...grip.panHandlers}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel={`Reorder ${task.title}`}
              accessibilityHint="Drag to move it in the list"
              accessibilityActions={[{ name: "increment", label: "Move up" }, { name: "decrement", label: "Move down" }]}
              onAccessibilityAction={e => {
                const up = e.nativeEvent.actionName === "increment";
                reorder.moveBy(up ? -1 : 1);
                AccessibilityInfo.announceForAccessibility(up ? "Moved up" : "Moved down");
              }}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 6 }}
              style={styles.grip}
            >
              <Text style={{ fontSize: fz(14), color: T.textFaint, lineHeight: fz(14) + 4 }}>⠿</Text>
            </View>
          )}
          <Pressable
            onPress={onToggle}
            hitSlop={10}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: task.done }}
            accessibilityLabel={task.done ? `Mark ${task.title} not done` : `Mark ${task.title} done`}
            style={[styles.check, { borderColor: task.done ? DONE_GREEN : T.textFaint, backgroundColor: task.done ? DONE_GREEN : "transparent" }]}
          >
            {task.done && <Text style={styles.tick}>✓</Text>}
          </Pressable>
          <View style={styles.body}>
            <View style={styles.titleLine}>
              {isTop && <Text style={[styles.badge, { fontSize: fz(10), backgroundColor: T.accent + "33", color: T.accent }]}>do first</Text>}
              {isNext && <Text style={[styles.badge, { fontSize: fz(10), backgroundColor: T.text + "11", color: T.text }]}>next up</Text>}
              <Text style={[styles.title, { fontSize: fz(15), color: task.done ? T.textFaint : T.text, textDecorationLine: task.done ? "line-through" : "none" }]}>{task.title}</Text>
              {!!task.recurrence && task.recurrence !== "none" && <Text style={{ color: T.textMuted, fontSize: fz(12) }} accessibilityLabel={`Repeats ${task.recurrence}`}>↻</Text>}
              {!!task.subject && <Text style={[styles.pill, { fontSize: fz(10), backgroundColor: sc + "22", color: ink(sc, T.light) }]}>{task.subject}</Text>}
              {!!task.priorityOverride && (
                <Text style={[styles.badge, { fontSize: fz(10), backgroundColor: priColor(task.priorityOverride, colorCode) + "22", color: ink(priColor(task.priorityOverride, colorCode), T.light) }]}>{task.priorityOverride}</Text>
              )}
              {task.tags?.map(tag => <Text key={tag} style={[styles.tag, { fontSize: fz(10), color: T.textMuted }]}>#{tag}</Text>)}
            </View>
            {(!!due || task.estMins > 0 || (live && !!dm)) && (
              <View style={styles.metaLine}>
                {!!due && <Text style={[styles.meta, { fontSize: fz(11), color: T.textMuted }]}>{due}</Text>}
                {task.estMins > 0 && <Text style={[styles.meta, { fontSize: fz(11), color: T.textMuted }]}>{formatDuration(task.estMins)}</Text>}
                {live && !!dm && <Text style={[styles.metaStrong, { fontSize: fz(11), color: ink(priColor(pr, colorCode), T.light) }]}>{dm}</Text>}
              </View>
            )}
            {subs.length > 0 && (
              <View style={styles.subs} accessibilityLabel={`${subsDone} of ${subs.length} subtasks done`}>
                <View style={[styles.subsTrack, { backgroundColor: T.border }]}>
                  <View style={[styles.subsFill, { width: `${Math.round((subsDone / subs.length) * 100)}%`, backgroundColor: T.accent }]} />
                </View>
                <Text style={[styles.meta, { fontSize: fz(10), color: T.textFaint }]}>{subsDone}/{subs.length}</Text>
              </View>
            )}
          </View>
          <Pressable onPress={onDelete} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Delete ${task.title}`} style={styles.del}>
            <Text style={[styles.delText, { fontSize: fz(15), color: T.textFaint }]}>×</Text>
          </Pressable>
        </View>
      </Pressable>
    </Swipe>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 13, borderWidth: 1, paddingVertical: 13, paddingHorizontal: 15, overflow: "hidden" },
  bar: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 9, paddingLeft: 8 },
  check: { width: 19, height: 19, borderRadius: 10, borderWidth: 2, alignItems: "center", justifyContent: "center", marginTop: 2 },
  tick: { color: "#111", fontSize: 11, lineHeight: 13, fontWeight: "700" },
  body: { flex: 1, minWidth: 0 },
  titleLine: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: 7, rowGap: 4 },
  title: { fontFamily: F.heading },
  badge: { fontFamily: F.bodyMedium, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  pill: { fontFamily: F.body, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  tag: { fontFamily: F.body },
  metaLine: { flexDirection: "row", flexWrap: "wrap", columnGap: 12, marginTop: 4 },
  meta: { fontFamily: F.body },
  metaStrong: { fontFamily: F.bodyMedium },
  subs: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 5 },
  subsTrack: { flex: 1, maxWidth: 80, height: 4, borderRadius: 999, overflow: "hidden" },
  subsFill: { height: "100%", borderRadius: 999 },
  grip: { marginTop: 1, paddingHorizontal: 2 },
  del: { paddingHorizontal: 5, paddingVertical: 2 },
  delText: { lineHeight: 18 },
});
