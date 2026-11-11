import { useState, useRef, type ComponentRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import type { Task } from "@dueplanner/core/types";
import { timeLeft, sortTasks } from "@dueplanner/core/lib/taskViews";
import { dueBucket } from "@dueplanner/core/lib/timeLeft";
import { todayISO } from "@dueplanner/core/lib/dates";
import { formatDuration, ink } from "@dueplanner/core/lib/format";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";
import { MiniTaskRow } from "../components/MiniTaskRow";
import { useDevScroll } from "../lib/devScroll";

const fmtMins = (m: number) => formatDuration(m) || "0m";

// The header's "Time left" (the web's dropdown): open time by due date and by
// subject. Tapping a row shows its tasks under it (the web opens them in a
// card, TimeDetail).
export default function TimeLeft() {
  const app = useApp();
  const { T, fz } = app;
  const { subjectColors } = app.settings;
  const today = todayISO();
  const tl = timeLeft(app.tasks, today);
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (key: string) => setOpen(o => (o === key ? null : key));
  const tasksFor = (pick: (t: Task) => boolean) => sortTasks(tl.openTasks.filter(pick), []);

  const list = (tasks: Task[]) => (
    <View style={styles.tasks}>
      {tasks.map(t => <MiniTaskRow key={t.id} t={t} onOpen={() => router.push(`/task/${t.id}`)} />)}
    </View>
  );

  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  useDevScroll(scrollRef); // development only: the dev remote's "scroll"
  return (
    <ScrollView ref={scrollRef} style={{ backgroundColor: T.bg }} contentContainerStyle={styles.body}>
      <Text style={[styles.h1, { color: T.text }]} accessibilityRole="header">Time left</Text>
      <Text style={[styles.total, { color: T.light ? "#000" : "#fff" }]}>{fmtMins(tl.totalMins)}</Text>

      <Text style={[styles.kicker, { fontSize: fz(10), color: T.textMuted }]}>BY DUE DATE</Text>
      {tl.byDue.length === 0
        ? <Text style={[styles.none, { fontSize: fz(12), color: T.textFaint }]}>Nothing left to do</Text>
        : tl.byDue.map(b => (
          <View key={b.key}>
            <Pressable onPress={() => toggle("due:" + b.key)} accessibilityRole="button" accessibilityState={{ expanded: open === "due:" + b.key }}
              accessibilityLabel={`${b.label}: ${b.count} ${b.count === 1 ? "task" : "tasks"}, ${fmtMins(b.mins)}`} style={styles.row}>
              <Text style={[styles.label, { fontSize: fz(12), color: b.key === "overdue" ? ink("#FF4757", T.light) : T.text }]}>{b.label}</Text>
              <Text style={[styles.count, { fontSize: fz(11), color: T.textMuted }]}>{b.count} {b.count === 1 ? "task" : "tasks"}</Text>
              <Text style={[styles.mins, { fontSize: fz(12), color: T.text }]}>{fmtMins(b.mins)}</Text>
              <Text style={[styles.chev, { fontSize: fz(12), color: T.textFaint }]}>{open === "due:" + b.key ? "⌄" : "›"}</Text>
            </Pressable>
            {open === "due:" + b.key && list(tasksFor(t => dueBucket(t.dueDate, today) === b.key))}
          </View>
        ))}

      {tl.bySubject.length > 0 && (
        <>
          <View style={[styles.divider, { backgroundColor: T.border + "33" }]} />
          <Text style={[styles.kicker, { fontSize: fz(10), color: T.textMuted }]}>BY SUBJECT</Text>
          {tl.bySubject.map(r => {
            const c = r.name ? subjectColors[r.name] || T.accent : T.textMuted;
            const key = "sub:" + r.name;
            return (
              <View key={key}>
                <Pressable onPress={() => toggle(key)} accessibilityRole="button" accessibilityState={{ expanded: open === key }}
                  accessibilityLabel={`${r.name || "No subject"}: ${fmtMins(r.mins)}, ${r.pct} percent`} style={styles.subRow}>
                  <View style={styles.row}>
                    <View style={[styles.dot, { backgroundColor: c }]} />
                    <Text numberOfLines={1} style={[styles.label, { fontSize: fz(12), color: r.name ? T.text : T.textMuted }]}>{r.name || "No subject"}</Text>
                    <Text style={[styles.mins, { fontSize: fz(12), color: T.text }]}>{fmtMins(r.mins)}</Text>
                    <Text style={[styles.pct, { fontSize: fz(11), color: T.textMuted }]}>{r.pct}%</Text>
                    <Text style={[styles.chev, { fontSize: fz(12), color: T.textFaint }]}>{open === key ? "⌄" : "›"}</Text>
                  </View>
                  <View style={[styles.track, { backgroundColor: T.cardAlt }]}>
                    <View style={[styles.fill, { width: `${r.pct}%`, backgroundColor: c }]} />
                  </View>
                  {r.spent > 0 && <Text style={[styles.spent, { fontSize: fz(10), color: T.textFaint }]}>{fmtMins(r.spent)} worked of {fmtMins(r.mins)} planned</Text>}
                </Pressable>
                {open === key && list(tasksFor(t => (t.subject || "") === r.name))}
              </View>
            );
          })}
        </>
      )}

      {tl.noEstimateCount > 0 && (
        <Pressable onPress={() => { app.setHomeFilter("noest"); router.back(); }} accessibilityRole="button" style={styles.noest}>
          <Text style={[styles.label, { fontSize: fz(11), color: T.textMuted }]}>
            {tl.noEstimateCount} {tl.noEstimateCount === 1 ? "task has" : "tasks have"} no estimate, so the total is low. Show them ›
          </Text>
        </Pressable>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, paddingBottom: 48 },
  h1: { fontFamily: F.heading, fontSize: 26, lineHeight: 30 },
  total: { fontFamily: F.heading, fontSize: 34, lineHeight: 40, marginBottom: 18 },
  kicker: { fontFamily: F.body, letterSpacing: 0.8, marginBottom: 10 },
  none: { fontFamily: F.body },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  subRow: { paddingBottom: 4 },
  label: { flex: 1, fontFamily: F.body },
  count: { fontFamily: F.body },
  mins: { fontFamily: F.body, minWidth: 52, textAlign: "right" },
  pct: { fontFamily: F.body, width: 34, textAlign: "right" },
  chev: { fontFamily: F.body, width: 12, textAlign: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  track: { height: 3, borderRadius: 99, marginLeft: 16, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 99 },
  spent: { fontFamily: F.body, marginTop: 4, marginLeft: 16 },
  divider: { height: 1, marginVertical: 14 },
  tasks: { gap: 6, paddingVertical: 6 },
  noest: { marginTop: 16 },
});
