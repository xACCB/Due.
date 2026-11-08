import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { byDueDate, monthGrid, monthOnlyGrid, shiftMonth, weekdayLabels } from "@dueplanner/core/lib/calendar";
import { todayISO } from "@dueplanner/core/lib/dates";
import { contrastColor, formatDate } from "@dueplanner/core/lib/format";
import { sortTasks } from "@dueplanner/core/lib/taskViews";
import { useApp } from "../../state/appContext";
import { F } from "../../theme/fonts";
import type { Theme } from "../../theme/types";
import { TaskRow } from "../../components/TaskRow";
import { AddSheet } from "../../components/AddSheet";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// The Calendar tab (the web's CalendarView, Month view): a month grid where
// each day shows up to 3 subject-coloured dots for its open tasks, and the
// picked day's tasks below. The grid and dates come from core's calendar.ts.
export default function CalendarScreen() {
  const app = useApp();
  const { T, h24 } = app;
  const { weekStart, calendarMonthOnly, subjectColors, colorCodeUrgency } = app.settings;
  const today = todayISO();
  const [[year, month], setYM] = useState<[number, number]>(() => [Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1]);
  const [picked, setPicked] = useState(today);
  const [adding, setAdding] = useState(false);

  const cells = calendarMonthOnly ? monthOnlyGrid(year, month, weekStart) : monthGrid(year, month, weekStart);
  const live = app.tasks.filter(t => !t.archived);
  const openByDay = byDueDate(live.filter(t => !t.done));
  const pickedTasks = sortTasks(live.filter(t => t.dueDate === picked), []);
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  const go = (delta: number) => setYM(shiftMonth(year, month, delta));

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: T.bg }]} edges={["top", "left", "right"]}>
      <ScrollView contentContainerStyle={styles.body} contentInsetAdjustmentBehavior="automatic">
        <View style={styles.header}>
          <Text style={[styles.h1, { color: T.accent }]} accessibilityRole="header">{MONTHS[month]} {year}</Text>
          <View style={styles.nav}>
            <NavBtn label="‹" a11y="Previous month" T={T} onPress={() => go(-1)} />
            <Pressable onPress={() => { setYM([Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1]); setPicked(today); }} hitSlop={8} accessibilityRole="button" accessibilityLabel="Today">
              <Text style={[styles.today, { color: T.text }]}>Today</Text>
            </Pressable>
            <NavBtn label="›" a11y="Next month" T={T} onPress={() => go(1)} />
          </View>
        </View>

        <View style={styles.week}>
          {weekdayLabels(weekStart).map(d => <Text key={d} style={[styles.weekday, { color: T.textMuted }]}>{d.slice(0, 2)}</Text>)}
        </View>
        <View style={styles.grid}>
          {cells.map((iso, i) => {
            if (!iso) return <View key={`e${i}`} style={styles.cell} />;
            const dayTasks = openByDay.get(iso) ?? [];
            const isPicked = iso === picked, isToday = iso === today, inMonth = iso.startsWith(prefix);
            const n = dayTasks.length;
            return (
              <Pressable
                key={iso}
                onPress={() => setPicked(iso)}
                accessibilityRole="button"
                accessibilityState={{ selected: isPicked }}
                accessibilityLabel={`${formatDate(iso)}${isToday ? ", today" : ""}${n ? `, ${n} open task${n === 1 ? "" : "s"}` : ""}`}
                style={styles.cell}
              >
                <View style={[styles.dayCircle, isPicked ? { backgroundColor: T.accent } : isToday ? { borderWidth: 1, borderColor: T.accent } : null]}>
                  <Text style={[styles.dayNum, { color: isPicked ? contrastColor(T.accent) : inMonth ? T.text : T.textFaint }]}>{Number(iso.slice(8))}</Text>
                </View>
                <View style={styles.dots}>
                  {dayTasks.slice(0, 3).map(t => <View key={t.id} style={[styles.dot, { backgroundColor: subjectColors[t.subject] || T.textMuted }]} />)}
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.dayHead}>
          <Text style={[styles.h2, { color: T.text }]}>{picked === today ? "Today" : formatDate(picked)}</Text>
        </View>
        {pickedTasks.map(t => (
          <TaskRow
            key={t.id}
            task={t}
            T={T}
            h24={h24}
            colorCode={colorCodeUrgency}
            subjectColor={subjectColors[t.subject]}
            onToggle={() => app.toggle(t.id)}
            onOpen={() => router.push(`/task/${t.id}`)}
          />
        ))}
        <Pressable onPress={() => setAdding(true)} accessibilityRole="button" style={({ pressed }) => [styles.add, { borderColor: T.border, opacity: pressed ? 0.7 : 1 }]}>
          <Text style={[styles.addText, { color: T.text }]}>+ Add homework due {picked === today ? "today" : formatDate(picked)}</Text>
        </Pressable>
      </ScrollView>
      <AddSheet visible={adding} presetDate={picked} onClose={() => setAdding(false)} />
    </SafeAreaView>
  );
}

function NavBtn({ label, a11y, T, onPress }: { label: string; a11y: string; T: Theme; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={10} accessibilityRole="button" accessibilityLabel={a11y} style={[styles.navBtn, { borderColor: T.border }]}>
      <Text style={[styles.navGlyph, { color: T.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { paddingHorizontal: 16, paddingBottom: 140 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4, paddingTop: 12, paddingBottom: 16 },
  h1: { fontSize: 28, fontFamily: F.heading },
  nav: { flexDirection: "row", alignItems: "center", gap: 14 },
  navBtn: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  navGlyph: { fontSize: 20, lineHeight: 22 },
  today: { fontSize: 13, fontFamily: F.body },
  week: { flexDirection: "row", marginBottom: 6 },
  weekday: { width: `${100 / 7}%`, textAlign: "center", fontSize: 11, fontFamily: F.body },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  cell: { width: `${100 / 7}%`, alignItems: "center", paddingVertical: 5, minHeight: 52 },
  dayCircle: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  dayNum: { fontSize: 14, fontFamily: F.body },
  dots: { flexDirection: "row", gap: 3, height: 6, marginTop: 3 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  dayHead: { marginTop: 18, marginBottom: 10, paddingHorizontal: 4 },
  h2: { fontSize: 20, fontFamily: F.heading },
  add: { borderWidth: 1, borderStyle: "dashed", borderRadius: 12, paddingVertical: 13, alignItems: "center", marginTop: 4 },
  addText: { fontSize: 13, fontFamily: F.body },
});
