import { useState, useRef, type ComponentRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router } from "expo-router";
import type { Task } from "@dueplanner/core/types";
import { timeLeft } from "@dueplanner/core/lib/taskViews";
import { dueBucket } from "@dueplanner/core/lib/timeLeft";
import { todayISO } from "@dueplanner/core/lib/dates";
import { countdown, formatDate, formatDuration, formatTime, ink } from "@dueplanner/core/lib/format";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";
import { DayTaskRow } from "../components/DayTaskRow";
import { PopCard } from "../components/PopCard";
import { useNow } from "../lib/useNow";
import { useDevAction, useDevScroll } from "../lib/devScroll";

const fmtMins = (m: number) => formatDuration(m) || "0m";

// The header's "Time left" (the web's dropdown): open time by due date and by
// subject. Tapping a row opens it in a card (TimeDetail, as on the web).
export default function TimeLeft() {
  const app = useApp();
  const { T, fz } = app;
  const { subjectColors } = app.settings;
  const today = todayISO();
  const tl = timeLeft(app.tasks, today);
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (key: string) => setOpen(key);
  useDevAction("open-time", key => setOpen(key)); // development only
  const inOpen = (t: Task) => !open ? false : open.startsWith("due:") ? dueBucket(t.dueDate, today) === open.slice(4) : (t.subject || "") === open.slice(4);
  const openTitle = !open ? "" : open.startsWith("due:") ? tl.byDue.find(b => "due:" + b.key === open)?.label ?? "Time left" : open.slice(4) || "No subject";

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
              <Text style={[styles.chev, { fontSize: fz(12), color: T.textFaint }]}>›</Text>
            </Pressable>
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
                    <Text style={[styles.chev, { fontSize: fz(12), color: T.textFaint }]}>›</Text>
                  </View>
                  <View style={[styles.track, { backgroundColor: T.cardAlt }]}>
                    <View style={[styles.fill, { width: `${r.pct}%`, backgroundColor: c }]} />
                  </View>
                  {r.spent > 0 && <Text style={[styles.spent, { fontSize: fz(10), color: T.textFaint }]}>{fmtMins(r.spent)} worked of {fmtMins(r.mins)} planned</Text>}
                </Pressable>
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
      {open && (
        <TimeDetail
          title={openTitle}
          kicker={open.startsWith("due:") ? "Time left · by due date" : "Time left · subject"}
          color={open.startsWith("sub:") && open.slice(4) ? subjectColors[open.slice(4)] || T.accent : undefined}
          list={app.tasks.filter(t => !t.archived && !t.done && inOpen(t))}
          onOpen={t => { setOpen(null); router.push(`/task/${t.id}`); }}
          onClose={() => setOpen(null)}
        />
      )}
    </ScrollView>
  );
}

// A Time left row opened (the web's TimeDetail): totals (time left, tasks,
// time already worked, how many have no estimate) and every open task in it,
// soonest first, each with when it's due and how long it should take.
function TimeDetail({ title, kicker, color, list, onOpen, onClose }: {
  title: string; kicker: string; color?: string; list: Task[]; onOpen: (t: Task) => void; onClose: () => void;
}) {
  const { T, fz, h24 } = useApp();
  const now = useNow(30000);
  const mins = list.reduce((n, t) => n + (t.estMins || 0), 0);
  const worked = list.reduce((n, t) => n + (t.sessions || []).reduce((a, x) => a + x.mins, 0), 0);
  const noEstimate = list.filter(t => !t.estMins).length;
  const sorted = list.slice().sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999") || (a.dueTime || "99").localeCompare(b.dueTime || "99") || a.order - b.order);
  const noteFor = (t: Task) => {
    const when = !t.dueDate ? "Anytime" : countdown(t.dueDate, t.dueTime, now) ?? `${formatDate(t.dueDate)}${t.dueTime ? ` ${formatTime(t.dueTime, h24)}` : ""}`;
    return `${when} · ${formatDuration(t.estMins) || "no estimate"}`;
  };
  const stat = (label: string, value: string) => (
    <View style={[styles.stat, { backgroundColor: T.surface }]}>
      <Text numberOfLines={1} style={{ fontFamily: F.heading, fontSize: fz(18), color: T.text }}>{value}</Text>
      <Text style={{ fontFamily: F.body, fontSize: fz(9), color: T.textFaint, marginTop: 2, letterSpacing: 0.5 }}>{label.toUpperCase()}</Text>
    </View>
  );
  return (
    <PopCard onClose={onClose} label={`${kicker}: ${title}`}>
      <View style={{ paddingRight: 28 }}>
        <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textMuted, letterSpacing: 1.3 }}>{kicker.toUpperCase()}</Text>
        <View style={styles.detailTitle}>
          {!!color && <View style={[styles.detailDot, { backgroundColor: color }]} />}
          <Text numberOfLines={1} style={{ flexShrink: 1, fontFamily: F.heading, fontSize: 28, lineHeight: 32, color: T.text }} accessibilityRole="header">{title}</Text>
        </View>
      </View>
      <View style={styles.stats}>
        {stat("Time left", fmtMins(mins))}
        {stat(list.length === 1 ? "Task" : "Tasks", String(list.length))}
        {stat("Worked", fmtMins(worked))}
      </View>
      {noEstimate > 0 && <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textMuted, marginTop: 10 }}>{noEstimate} {noEstimate === 1 ? "task has" : "tasks have"} no estimate, so the time left reads low.</Text>}
      <View style={{ height: 1, backgroundColor: T.border, marginTop: 14, marginBottom: 12 }} />
      {sorted.length === 0
        ? <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.textFaint }}>Nothing left here.</Text>
        : (
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 6 }}>
            {sorted.map(t => <DayTaskRow key={t.id} t={t} surface note={noteFor(t)} onOpen={() => onOpen(t)} />)}
          </ScrollView>
        )}
    </PopCard>
  );
}

const styles = StyleSheet.create({
  detailTitle: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 4 },
  detailDot: { width: 12, height: 12, borderRadius: 6 },
  stats: { flexDirection: "row", gap: 8, marginTop: 14 },
  stat: { flex: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 8, alignItems: "center" },
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
