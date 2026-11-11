import { Pressable, StyleSheet, Text, View, type DimensionValue } from "react-native";
import type { Task } from "@dueplanner/core/types";
import { priColor } from "@dueplanner/core/constants";
import { countdown, daysUntil, formatDate, formatDuration, getPriority, ink } from "@dueplanner/core/lib/format";
import { prioritySplit } from "@dueplanner/core/lib/taskViews";
import type { LayoutName } from "@dueplanner/core/constants";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";
import { Swipe } from "./Swipe";
import { CheckGlyph, CheckPop, StrikeText } from "./DoneMarks";

const DONE_GREEN = "#2ED573";

interface Props {
  layout: Exclude<LayoutName, "list">;
  tasks: Task[];
  now: number;
  onOpen: (t: Task) => void;
  onToggle: (t: Task) => void;
  onDelete: (t: Task) => void;
  // Tasks just ticked, in Home's hold: their check and strike animate in.
  justDone?: number[];
}

// The web's other task layouts (renderTasks in App.tsx): Board, Checklist,
// Kanban, Progress and Pyramid. Every card swipes like the List's (right:
// done, left: delete); Kanban and Pyramid sort by priority and show no due
// label, as on the web. Grouping applies only to the List.
export function TaskLayout({ layout, tasks, now, onOpen, onToggle, onDelete, justDone = [] }: Props) {
  const app = useApp();
  const { T, fz } = app;
  const { colorCodeUrgency: cc, subjectColors } = app.settings;
  const pr = (t: Task) => getPriority(t.dueDate, t.estMins, t.priorityOverride);
  const dueText = (t: Task) => countdown(t.dueDate, t.dueTime, now) ?? daysUntil(t.dueDate);
  const sc = (t: Task) => subjectColors[t.subject] || T.accent;

  const held = (t: Task) => t.done && justDone.includes(t.id);
  const check = (t: Task, size: number, round = true) => (
    <CheckPop key={`chk-${t.id}`} animate={held(t)}>
    <Pressable onPress={() => onToggle(t)} hitSlop={10} accessibilityRole="checkbox" accessibilityState={{ checked: t.done }}
      accessibilityLabel={t.done ? `Mark ${t.title} not done` : `Mark ${t.title} done`}
      style={{ width: size, height: size, borderRadius: round ? size / 2 : 4, borderWidth: size < 16 ? 1.5 : 2, borderColor: t.done ? DONE_GREEN : T.textFaint, backgroundColor: t.done ? DONE_GREEN : "transparent", alignItems: "center", justifyContent: "center" }}>
      {t.done && <CheckGlyph size={size - (size < 16 ? 3 : 4)} font={Math.round(size * 0.6)} animate={held(t)} />}
    </Pressable>
    </CheckPop>
  );
  const del = (t: Task, size = 13) => (
    <Pressable onPress={() => onDelete(t)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Delete ${t.title}`}>
      <Text style={{ fontSize: fz(size), color: T.textFaint, lineHeight: fz(size) + 2 }}>×</Text>
    </Pressable>
  );
  const title = (t: Task, size: number, heading: boolean, oneLine = false) => (
    <StrikeText done={t.done} animate={held(t)} color={T.textFaint} numberOfLines={oneLine ? 1 : undefined} style={{ fontFamily: heading ? F.heading : F.body, fontSize: fz(size), color: t.done ? T.textFaint : T.text }}>{t.title}</StrikeText>
  );
  const pill = (t: Task) => !!t.subject && (
    <Text style={[styles.pill, { fontSize: fz(10), backgroundColor: sc(t) + "22", color: ink(sc(t), T.light) }]}>{t.subject}</Text>
  );
  const card = (t: Task, radius: number, gap: number, style: object, children: React.ReactNode) => (
    <Swipe key={t.id} done={t.done} radius={radius} gap={gap} onToggle={() => onToggle(t)} onDelete={() => onDelete(t)}>
      <Pressable onPress={() => onOpen(t)} accessibilityRole="button" accessibilityLabel={`${t.title}${t.done ? ", done" : ""}`} accessibilityHint="Opens the task"
        style={({ pressed }) => [{ backgroundColor: pressed ? T.cardAlt : T.card, borderRadius: radius, borderWidth: 1, borderColor: T.border }, style]}>
        {children}
      </Pressable>
    </Swipe>
  );

  if (layout === "checklist") return (
    <View>
      {tasks.map((t, i) => card(t, 10, 6, styles.checkRow, (
        <>
          <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textFaint, minWidth: 18 }}>{String(i + 1).padStart(2, "0")}</Text>
          {check(t, 20, false)}
          <View style={{ flex: 1 }}>{title(t, 13, false)}</View>
          {!t.done && !!dueText(t) && <Text style={{ fontFamily: F.body, fontSize: fz(10), color: ink(priColor(pr(t), cc), T.light) }}>{dueText(t)}</Text>}
          {del(t, 14)}
        </>
      )))}
    </View>
  );

  if (layout === "board") return (
    <View style={styles.grid}>
      {tasks.map(t => (
        <View key={t.id} style={styles.half}>
          {card(t, 12, 10, styles.boardCard, (
            <>
              <View style={[styles.boardBar, { backgroundColor: priColor(pr(t), cc) }]} />
              <View style={styles.between}>{pill(t)}<View style={{ marginLeft: "auto" }}>{del(t)}</View></View>
              {title(t, 14, true)}
              {!!t.dueDate && (
                <Text style={{ fontFamily: F.body, fontSize: fz(10), color: T.textMuted }}>
                  {formatDate(t.dueDate)}{!t.done && !!dueText(t) && <Text style={{ color: ink(priColor(pr(t), cc), T.light) }}> · {dueText(t)}</Text>}
                </Text>
              )}
              <View style={[styles.between, { marginTop: "auto" }]}>
                <Text style={{ fontFamily: F.body, fontSize: fz(10), color: T.textMuted }}>{formatDuration(t.estMins)}</Text>
                {check(t, 17)}
              </View>
            </>
          ))}
        </View>
      ))}
    </View>
  );

  if (layout === "kanban") {
    if (tasks.length === 0) return null;
    const split = prioritySplit(tasks, []);
    const cols = [{ key: "high", label: "Urgent", list: split.high }, { key: "medium", label: "Soon", list: split.medium }, { key: "low", label: "Later", list: split.low }, { key: "done", label: "✓ Done", list: split.done }];
    return (
      <View style={styles.grid}>
        {cols.map(c => (
          <View key={c.key} style={styles.half}>
            <View style={[styles.column, { backgroundColor: T.surface, borderColor: T.border }]}>
              <Text style={{ fontFamily: F.bodyMedium, fontSize: fz(11), color: T.textMuted, marginBottom: 10 }} accessibilityRole="header">{c.label} ({c.list.length})</Text>
              {c.list.map(t => card(t, 8, 6, styles.kanbanCard, (
                <>
                  {check(t, 14)}
                  <View style={{ flex: 1, minWidth: 0 }}>{title(t, 12, false, true)}</View>
                  {del(t, 12)}
                </>
              )))}
              {c.list.length === 0 && <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textFaint, textAlign: "center", paddingVertical: 10 }}>Empty</Text>}
            </View>
          </View>
        ))}
      </View>
    );
  }

  if (layout === "progress") return (
    <View>
      {tasks.map(t => {
        const subs = t.subtasks ?? [];
        const doneSubs = subs.filter(s => s.done).length;
        const pct = t.done ? 100 : subs.length ? Math.round((doneSubs / subs.length) * 100) : 0;
        return card(t, 12, 10, styles.progressCard, (
          <>
            <View style={[styles.between, { marginBottom: 8, gap: 8 }]}>
              <View style={[styles.rowGap, { flex: 1 }]}>{check(t, 18)}{title(t, 14, true)}</View>
              <View style={styles.rowGap}>{pill(t)}{del(t)}</View>
            </View>
            <View style={styles.rowGap}>
              <View style={[styles.track, { backgroundColor: T.border }]}>
                <View style={[styles.fill, { width: `${pct}%` as DimensionValue, backgroundColor: t.done ? DONE_GREEN : priColor(pr(t), cc) }]} />
              </View>
              {(t.done || subs.length > 0) && <Text style={{ fontFamily: F.body, fontSize: fz(10), color: T.textFaint }}>{t.done ? "Done" : `${doneSubs}/${subs.length}`}</Text>}
              {t.estMins > 0 && <Text style={{ fontFamily: F.body, fontSize: fz(10), color: T.textMuted }}>{formatDuration(t.estMins)}</Text>}
              {!t.done && !!dueText(t) && <Text style={{ fontFamily: F.body, fontSize: fz(10), color: ink(priColor(pr(t), cc), T.light) }}>{dueText(t)}</Text>}
            </View>
          </>
        ));
      })}
    </View>
  );

  // Pyramid
  const split = prioritySplit(tasks, []);
  const tiers = [
    { list: split.high, color: ink(priColor("high", cc), T.light), label: "High Priority", w: "100%" },
    { list: split.medium, color: ink(priColor("medium", cc), T.light), label: "Medium Priority", w: "85%" },
    { list: split.low, color: ink(priColor("low", cc), T.light), label: "Low Priority", w: "65%" },
    { list: split.done, color: T.textFaint, label: "✓ Done", w: "45%" },
  ];
  return (
    <View style={{ gap: 8 }}>
      {tiers.filter(tier => tier.list.length > 0).map(tier => (
        <View key={tier.label} style={{ width: tier.w as DimensionValue, alignSelf: "center" }}>
          <Text style={{ fontFamily: F.body, fontSize: fz(10), color: tier.color, textAlign: "center", marginBottom: 5 }} accessibilityRole="header">{tier.label}</Text>
          {tier.list.map(t => (
            <Swipe key={t.id} done={t.done} radius={9} gap={5} onToggle={() => onToggle(t)} onDelete={() => onDelete(t)}>
              <Pressable onPress={() => onOpen(t)} accessibilityRole="button" accessibilityLabel={`${t.title}${t.done ? ", done" : ""}`}
                style={({ pressed }) => [styles.pyramidCard, { backgroundColor: pressed ? T.cardAlt : T.card, borderColor: tier.color + "44" }]}>
                {check(t, 15)}
                <View style={{ flex: 1, minWidth: 0 }}>{title(t, 12, false, true)}</View>
                {!!t.subject && <Text style={{ fontFamily: F.body, fontSize: fz(10), color: T.textMuted }}>{t.subject}</Text>}
                {del(t)}
              </Pressable>
            </Swipe>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { fontFamily: F.body, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 11, paddingHorizontal: 14 },
  grid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -5 },
  half: { width: "50%", paddingHorizontal: 5 },
  boardCard: { padding: 13, gap: 7, minHeight: 130, overflow: "hidden" },
  boardBar: { position: "absolute", top: 0, left: 0, right: 0, height: 3 },
  between: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  column: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
  kanbanCard: { flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 9, paddingHorizontal: 10 },
  progressCard: { paddingVertical: 13, paddingHorizontal: 15 },
  rowGap: { flexDirection: "row", alignItems: "center", gap: 8 },
  track: { flex: 1, height: 7, borderRadius: 999, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 999 },
  pyramidCard: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 9, borderWidth: 1, paddingVertical: 9, paddingHorizontal: 12 },
});
