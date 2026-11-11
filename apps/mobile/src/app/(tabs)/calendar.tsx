import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { byDueDate, monthGrid, monthOnlyGrid, shiftMonth, monthSwipe, weekdayLabels } from "@dueplanner/core/lib/calendar";
import { todayISO } from "@dueplanner/core/lib/dates";
import { contrastColor, formatDuration, ink } from "@dueplanner/core/lib/format";
import { priColor } from "@dueplanner/core/constants";
import { useApp } from "../../state/appContext";
import { F } from "../../theme/fonts";
import { AddSheet } from "../../components/AddSheet";
import { DayTaskRow } from "../../components/DayTaskRow";
import { DueDeck } from "../../components/DueDeck";
import { sortDay } from "../../lib/day";
import { useDevScroll } from "../../lib/devScroll";

const longDay = (iso: string) => new Date(iso + "T00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

// The Calendar tab (the web's): a Month grid or the Deck of due dates.
export default function CalendarScreen() {
  const app = useApp();
  const { T, fz } = app;
  const { calendarView, setCalendarView } = app.settings;
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  useDevScroll(scrollRef); // development only: the dev remote's "scroll"
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: T.bg }]} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={[styles.h1, { color: T.text }]} accessibilityRole="header">Calendar</Text>
      </View>
      <View style={[styles.rule, { backgroundColor: T.accent }]} />
      <ScrollView ref={scrollRef} contentContainerStyle={styles.body}>
        <View style={styles.switch}>
          {([["month", "Month"], ["deck", "Deck"]] as const).map(([k, l]) => {
            const on = calendarView === k;
            return (
              <Pressable key={k} onPress={() => setCalendarView(k)} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: on }}
                style={[styles.chip, { backgroundColor: on ? T.accent : "transparent", borderColor: on ? T.accent : T.border }]}>
                <Text style={{ fontFamily: F.body, fontSize: fz(11), color: on ? contrastColor(T.accent) : T.textMuted }}>{l}</Text>
              </Pressable>
            );
          })}
        </View>
        {calendarView === "deck" ? <DueDeck /> : <MonthView />}
      </ScrollView>
    </SafeAreaView>
  );
}

function MonthView() {
  const app = useApp();
  const { T, fz } = app;
  const { weekStart, calendarMonthOnly, subjectColors, colorCodeUrgency } = app.settings;
  const today = todayISO();
  const [[year, month], setYM] = useState<[number, number]>(() => [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1]);
  const [selected, setSelected] = useState(today);
  const [adding, setAdding] = useState(false);

  const cells = calendarMonthOnly ? monthOnlyGrid(year, month, weekStart) : monthGrid(year, month, weekStart);
  const due = useMemo(() => byDueDate(app.tasks.filter(t => !t.archived)), [app.tasks]);
  const dayTasks = sortDay(due.get(selected) ?? []);
  const openMins = dayTasks.filter(t => !t.done).reduce((n, t) => n + (t.estMins || 0), 0);
  const monthName = new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const thisYM = [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1];
  const showToday = !(year === thisYM[0] && month === thisYM[1] && selected === today);
  const inMonth = (iso: string) => Number(iso.slice(5, 7)) - 1 === month;

  // Swipe the grid sideways to change month (the web's pointer swipe, 50px).
  const ym = useRef({ year, month });
  useEffect(() => { ym.current = { year, month }; }, [year, month]);
  // The handlers read the refs only during a gesture, never while rendering;
  // the lint can't tell callbacks given to PanResponder from render code.
  // eslint-disable-next-line react-hooks/refs
  const [swipe] = useState(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
    onPanResponderRelease: (_, g) => {
      const step = monthSwipe(g.dx);
      if (step) setYM(shiftMonth(ym.current.year, ym.current.month, step));
    },
  }));

  const navBtn = (glyph: string, label: string, onPress: () => void) => (
    <Pressable onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} style={[styles.navBtn, { borderColor: T.border }]}>
      <Text style={{ color: T.text, fontSize: fz(16), lineHeight: fz(16) + 3 }}>{glyph}</Text>
    </Pressable>
  );

  return (
    <View style={styles.stack}>
      <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
        <View style={styles.monthHead}>
          <Text style={[styles.monthName, { color: T.text }]} accessibilityRole="header" accessibilityLiveRegion="polite">{monthName}</Text>
          {showToday && (
            <Pressable onPress={() => { setYM([thisYM[0], thisYM[1]]); setSelected(today); }} accessibilityRole="button" style={[styles.todayBtn, { borderColor: T.border }]}>
              <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textMuted }}>Today</Text>
            </Pressable>
          )}
          {navBtn("‹", "Previous month", () => setYM(shiftMonth(year, month, -1)))}
          {navBtn("›", "Next month", () => setYM(shiftMonth(year, month, 1)))}
        </View>
        <View style={styles.week} importantForAccessibility="no-hide-descendants">
          {weekdayLabels(weekStart).map(l => <Text key={l} style={[styles.weekday, { fontSize: fz(10), color: T.textFaint }]}>{l.slice(0, 2).toUpperCase()}</Text>)}
        </View>
        <View style={styles.grid} {...swipe.panHandlers}>
          {cells.map((iso, i) => {
            if (iso == null) return <View key={`blank-${i}`} style={styles.cellBox} />;
            const list = due.get(iso) ?? [];
            const open = list.filter(t => !t.done);
            const mins = open.reduce((n, t) => n + (t.estMins || 0), 0);
            const isSel = iso === selected, isToday = iso === today, other = !inMonth(iso);
            const overdue = iso < today && open.length > 0;
            return (
              <View key={iso} style={styles.cellBox}>
                <Pressable
                  onPress={() => setSelected(iso)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: isSel }}
                  accessibilityLabel={longDay(iso) + (isToday ? ", today" : "") + (open.length ? `, ${open.length} due${mins ? `, ${formatDuration(mins)}` : ""}` : "") + (overdue ? ", overdue" : "")}
                  style={[styles.cell, { borderWidth: isSel ? 2 : 1, borderColor: isSel ? T.accent : isToday ? T.textMuted : "transparent", opacity: other ? 0.4 : 1 }]}
                >
                  <Text style={[styles.dayNum, { fontSize: fz(13), fontFamily: isToday ? F.bodyMedium : F.body, color: overdue ? ink(priColor("high", colorCodeUrgency), T.light) : T.text }]}>{Number(iso.slice(8))}</Text>
                  <View style={styles.dots}>
                    {open.slice(0, 3).map(t => <View key={t.id} style={[styles.dot, { backgroundColor: subjectColors[t.subject] || T.textMuted }]} />)}
                    {open.length > 3 && <Text style={{ fontFamily: F.body, fontSize: fz(8), lineHeight: fz(8) + 1, color: T.textMuted }}>+</Text>}
                  </View>
                </Pressable>
              </View>
            );
          })}
        </View>
      </View>

      <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
        <View style={styles.dayHead}>
          <Text style={[styles.dayTitle, { fontSize: fz(17), color: T.text }]}>{selected === today ? "Today" : longDay(selected)}</Text>
          {dayTasks.length > 0 && <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textMuted }}>{dayTasks.filter(t => !t.done).length} due{openMins ? ` · ${formatDuration(openMins)}` : ""}</Text>}
        </View>
        {dayTasks.length === 0
          ? <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.textFaint, marginBottom: 10 }}>Nothing due.</Text>
          : <View style={styles.rows}>{dayTasks.map(t => <DayTaskRow key={t.id} t={t} surface onOpen={() => router.push(`/task/${t.id}`)} />)}</View>}
        <Pressable onPress={() => setAdding(true)} accessibilityRole="button" style={({ pressed }) => [styles.add, { borderColor: T.border, opacity: pressed ? 0.7 : 1 }]}>
          <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.textMuted }}>
            + Add homework due {selected === today ? "today" : new Date(selected + "T00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </Text>
        </Pressable>
      </View>
      <AddSheet visible={adding} presetDate={selected} onClose={() => setAdding(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14 },
  h1: { fontSize: 26, lineHeight: 30, fontFamily: F.heading },
  rule: { height: 1, marginBottom: 16 },
  body: { paddingHorizontal: 16, paddingBottom: 140 },
  switch: { flexDirection: "row", gap: 6, marginBottom: 10 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  stack: { gap: 10 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14 },
  monthHead: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  monthName: { flex: 1, fontFamily: F.heading, fontSize: 20, lineHeight: 24 },
  todayBtn: { borderWidth: 1, borderRadius: 9, height: 34, paddingHorizontal: 12, justifyContent: "center" },
  navBtn: { width: 34, height: 34, borderRadius: 9, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  week: { flexDirection: "row", marginBottom: 4 },
  weekday: { width: `${100 / 7}%`, textAlign: "center", fontFamily: F.body, letterSpacing: 0.4 },
  grid: { flexDirection: "row", flexWrap: "wrap", rowGap: 4 },
  cellBox: { width: `${100 / 7}%`, height: 48, paddingHorizontal: 2 },
  cell: { flex: 1, borderRadius: 10, alignItems: "center", paddingTop: 5, gap: 4 },
  dayNum: { lineHeight: 15 },
  dots: { flexDirection: "row", gap: 3, alignItems: "center", height: 6 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  dayHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 10 },
  dayTitle: { flex: 1, fontFamily: F.heading },
  rows: { gap: 6, marginBottom: 10 },
  add: { borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
});
