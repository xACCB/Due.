import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, FlatList, LayoutAnimation, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import * as Haptics from "expo-haptics";
import type { Task, TaskTemplate } from "@dueplanner/core/types";
import { filterTasks, groupTasks, heldOpen, sortTasks, timeLeft } from "@dueplanner/core/lib/taskViews";
import { buildSuggestion } from "@dueplanner/core/lib/tasks";
import { contrastColor, formatDuration } from "@dueplanner/core/lib/format";
import { todayISO } from "@dueplanner/core/lib/dates";
import { startFromTemplate } from "@dueplanner/core/lib/addFlow";
import { useApp } from "../../state/appContext";
import { useNow } from "../../lib/useNow";
import { F } from "../../theme/fonts";
import { TaskCard } from "../../components/TaskCard";
import { TaskLayout } from "../../components/TaskLayouts";
import { AddSheet } from "../../components/AddSheet";
import { UndoToast } from "../../components/UndoToast";
import { TimerPill } from "../../components/TimerPill";
import { dragDelta } from "../../lib/reorder";

// The web's filter chips (taskViews' filterTasks). "noest" (no estimate) has
// no chip of its own: Time left's "Show them" sets it, and its chip clears it.
const FILTERS = ["all", "pending", "done", "archived"];
const EMPTY: Record<string, string> = {
  archived: "No archived tasks", done: "No completed tasks yet", pending: "Nothing pending. Nice work!",
  noest: "Every open task has an estimate", all: "Nothing here yet",
};

// "3h 20m", or "0m" (the web header's fmtMins).
const fmtMins = (m: number) => formatDuration(m) || "0m";

type Row = { kind: "head"; key: string; label: string } | { kind: "task"; key: string; task: Task } | { kind: "layout"; key: string };

// Home, as on the web: the menu button and Time left in the header, the smart
// suggestion, search, the filter chips, the task cards (grouped when Group by
// is set), and + Add homework with the templates under it.
export default function Home() {
  const app = useApp();
  const { T, h24, fz } = app;
  const s = app.settings;
  const now = useNow();
  const [adding, setAdding] = useState<{ template?: TaskTemplate } | null>(null);
  // dueplanner://?add=1 opens the add sheet (a shortcut into adding).
  const { add } = useLocalSearchParams<{ add?: string }>();
  useEffect(() => {
    if (!add) return;
    setAdding({}); // eslint-disable-line react-hooks/set-state-in-effect -- opening from a link is an outside event
    router.setParams({ add: undefined });
  }, [add]);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const hideToast = useCallback(() => setToast(null), []);
  const say = (text: string) => setToast(prev => ({ text, n: (prev?.n ?? 0) + 1 }));

  const filter = app.homeFilter;
  // A subject filter whose subject no longer has tasks or a row is ignored (the web's subjectFilterOn).
  const subjectOn = app.subjectFilter != null && (s.subjects.includes(app.subjectFilter) || app.tasks.some(t => t.subject === app.subjectFilter)) ? app.subjectFilter : null;
  // Completing a task (the web's justDone): the card holds its place for 640ms
  // while its check fills and its title strikes, then glides to its new spot
  // (LayoutAnimation). Reduced motion skips the hold and the glide.
  const [justDone, setJustDone] = useState<number[]>([]);
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduced).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => sub.remove();
  }, []);
  const glide = () => { if (!reduced) LayoutAnimation.configureNext(LayoutAnimation.create(320, "easeInEaseOut", "opacity")); };

  const allSorted = useMemo(() => sortTasks(app.tasks, justDone), [app.tasks, justDone]);
  const shown = filterTasks(allSorted, { filter, subject: subjectOn, showDone: s.showDone, justDone });
  const pending = allSorted.filter(t => heldOpen(t, justDone));
  const tl = timeLeft(app.tasks, todayISO());
  const pendingCount = shown.filter(t => !t.done && !t.archived).length;

  const suggestionTask = allSorted.find(t => !t.done && !t.archived);
  const showSuggestionCard = !!suggestionTask && s.showSuggestion && s.hiddenSuggestionFor !== suggestionTask.id;

  const rows: Row[] = s.layout !== "list"
    ? (shown.length ? [{ kind: "layout" as const, key: "layout" }] : [])
    : s.groupBy !== "none"
    ? groupTasks(shown, s.groupBy).flatMap(g => [{ kind: "head" as const, key: "h-" + g.key, label: `${g.label} (${g.tasks.length})` }, ...g.tasks.map(t => ({ kind: "task" as const, key: String(t.id), task: t }))])
    : shown.map(t => ({ kind: "task" as const, key: String(t.id), task: t }));

  // Drag to reorder (List, no grouping, as on the web): the drop lands among
  // the open cards on screen, then moves the task that far in the full order.
  const canReorder = s.layout === "list" && s.groupBy === "none";
  const [dragging, setDragging] = useState(false);
  const heights = useRef(new Map<number, number>());
  const visibleOpen = shown.filter(t => !t.done);
  const drop = (t: Task, dy: number) => {
    const from = visibleOpen.findIndex(x => x.id === t.id);
    const d = dragDelta(visibleOpen.map(x => heights.current.get(x.id) ?? 80), from, dy);
    const target = visibleOpen[from + d];
    if (!d || !target) return;
    app.moveBy(t.id, pending.indexOf(target) - pending.indexOf(t));
    Haptics.selectionAsync().catch(() => {});
  };
  const moveBy = (t: Task, delta: number) => {
    const target = visibleOpen[visibleOpen.findIndex(x => x.id === t.id) + delta];
    if (target) app.moveBy(t.id, pending.indexOf(target) - pending.indexOf(t));
  };

  const toggle = (t: Task) => {
    if (!t.done && !reduced) {
      setJustDone(prev => [...prev, t.id]);
      setTimeout(() => { glide(); setJustDone(prev => prev.filter(x => x !== t.id)); }, 640);
    } else glide();
    app.toggle(t.id);
    if (!t.done) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    say(t.done ? `"${t.title}" marked not done` : `"${t.title}" completed`);
  };
  const remove = (t: Task) => { glide(); app.remove(t.id); say(`"${t.title}" deleted`); };
  const startTemplate = (tpl: TaskTemplate) => {
    const step = startFromTemplate(app.questions, tpl);
    if (step.done) { glide(); app.add(step.done); say(`"${step.done.title}" added`); } else setAdding({ template: tpl });
  };

  const chip = (label: string, on: boolean, onPress: () => void, a11y?: string) => (
    <Pressable key={label} onPress={onPress} hitSlop={6} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={a11y ?? label}
      style={[styles.chip, { backgroundColor: on ? T.accent : "transparent", borderColor: on ? T.accent : T.border }]}>
      <Text style={[styles.chipText, { fontSize: fz(11), color: on ? contrastColor(T.accent) : T.textMuted }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );

  const header = (
    <View>
      {showSuggestionCard && (
        <View style={[styles.suggest, { backgroundColor: T.cardAlt, borderColor: T.accent + "33" }]}>
          <Text style={{ fontSize: fz(12), color: T.text }} accessibilityElementsHidden>✦</Text>
          <Text style={[styles.suggestText, { fontSize: fz(12), color: T.text }]}>{buildSuggestion(app.tasks)}</Text>
          <Pressable onPress={() => s.setHiddenSuggestionFor(suggestionTask!.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hide this suggestion" accessibilityHint="It comes back when another task becomes most urgent">
            <Text style={{ fontSize: fz(16), color: T.textFaint, lineHeight: fz(16) + 2 }}>×</Text>
          </Pressable>
        </View>
      )}

      <Pressable onPress={() => router.push("/search")} accessibilityRole="search" accessibilityLabel="Search tasks"
        style={[styles.search, { backgroundColor: T.card, borderColor: T.border }]}>
        <SymbolView name="magnifyingglass" size={15} tintColor={T.textFaint} />
        <Text style={[styles.searchText, { fontSize: fz(13), color: T.textFaint }]}>Search tasks...</Text>
      </Pressable>

      <View style={styles.filters}>
        {FILTERS.map(f => chip(f[0].toUpperCase() + f.slice(1), filter === f, () => { if (f !== filter) glide(); app.setHomeFilter(f); }))}
        {filter === "noest" && chip("No estimate ×", true, () => app.setHomeFilter("all"), "Clear no-estimate filter")}
        {subjectOn != null && chip(`${subjectOn || "No subject"} ×`, true, () => app.setSubjectFilter(null), `Stop showing only ${subjectOn || "No subject"}`)}
        <Text style={[styles.pendingCount, { fontSize: fz(10), color: T.textFaint }]}>{pendingCount} pending</Text>
      </View>
    </View>
  );

  const footer = (
    <View>
      {shown.length === 0 && <Text style={[styles.empty, { fontSize: fz(12), color: T.textFaint }]}>{EMPTY[filter] ?? EMPTY.all}</Text>}
      <View style={styles.addArea}>
        <Pressable onPress={() => setAdding({})} accessibilityRole="button" accessibilityLabel="Add homework"
          style={({ pressed }) => [styles.addBtn, { backgroundColor: T.accent, opacity: pressed ? 0.85 : 1 }]}>
          <Text style={[styles.addText, { fontSize: fz(17), color: contrastColor(T.accent) }]}>+ Add homework</Text>
        </Pressable>
        {s.templates.length > 0 && <Text style={[styles.tplLabel, { fontSize: fz(10), color: T.textFaint }]}>OR START FROM A TEMPLATE</Text>}
        {s.templates.length > 0 && (
          <View style={styles.tpls}>
            {s.templates.map(tpl => (
              <View key={tpl.id} style={[styles.tpl, { backgroundColor: T.card, borderColor: T.border }]}>
                <Pressable onPress={() => startTemplate(tpl)} accessibilityRole="button" accessibilityLabel={`New task from template ${tpl.name}`} style={styles.tplName}>
                  <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.textMuted }}>{tpl.name}</Text>
                </Pressable>
                <Pressable onPress={() => s.setTemplates(s.templates.filter(x => x.id !== tpl.id))} accessibilityRole="button" accessibilityLabel={`Delete template ${tpl.name}`} style={styles.tplDel}>
                  <Text style={{ fontSize: fz(13), color: T.textFaint }}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: T.bg }]} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <View style={styles.headLeft}>
          <Pressable onPress={() => router.push("/menu")} hitSlop={10} accessibilityRole="button" accessibilityLabel="Open menu" accessibilityHint="Inbox, History, Import/Export and your subjects">
            <SymbolView name="sidebar.left" size={21} tintColor={T.textMuted} />
          </Pressable>
          <Text style={[styles.h1, { color: T.text }]} accessibilityRole="header">Home</Text>
        </View>
        <View style={styles.headRight}>
        {(app.focus.endAt != null || app.focus.swStartedAt != null) && <TimerPill />}
        <Pressable onPress={() => router.push("/time-left")} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Time left: ${fmtMins(tl.totalMins)}. Show the breakdown`} style={styles.timeLeft}>
          <Text style={[styles.tlLabel, { fontSize: fz(9), color: T.textFaint }]}>Time left</Text>
          <Text style={[styles.tlValue, { color: T.light ? "#000" : "#fff" }]}>{fmtMins(tl.totalMins)}</Text>
        </Pressable>
        </View>
      </View>
      <View style={[styles.rule, { backgroundColor: T.accent }]} />

      <FlatList
        data={rows}
        keyExtractor={r => r.key}
        contentContainerStyle={styles.list}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!dragging}
        renderItem={({ item }) => item.kind === "layout"
          ? <TaskLayout layout={s.layout as Exclude<typeof s.layout, "list">} tasks={shown} now={now} onOpen={t => router.push(`/task/${t.id}`)} onToggle={toggle} onDelete={remove} />
          : item.kind === "head"
          ? <Text style={[styles.groupHead, { fontSize: fz(10), color: T.textMuted }]} accessibilityRole="header">{item.label.toUpperCase()}</Text>
          : (
            <TaskCard
              task={item.task}
              rank={pending.indexOf(item.task)}
              holding={justDone.includes(item.task.id)}
              T={T} fz={fz} h24={h24} now={now}
              colorCode={s.colorCodeUrgency}
              subjectColor={s.subjectColors[item.task.subject]}
              onOpen={() => router.push(`/task/${item.task.id}`)}
              onToggle={() => toggle(item.task)}
              onDelete={() => remove(item.task)}
              reorder={canReorder && !item.task.done ? {
                drop: dy => drop(item.task, dy),
                moveBy: d => moveBy(item.task, d),
                dragging: setDragging,
                height: px => { heights.current.set(item.task.id, px); },
              } : undefined}
            />
          )}
      />

      {toast && <UndoToast text={toast.text} n={toast.n} T={T} onHide={hideToast} onUndo={() => { app.undo(); hideToast(); }} />}
      <AddSheet visible={!!adding} template={adding?.template} onClose={() => setAdding(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 14 },
  headLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  h1: { fontSize: 26, lineHeight: 30, fontFamily: F.heading },
  timeLeft: { alignItems: "flex-end" },
  headRight: { flexDirection: "row", alignItems: "flex-end", gap: 12 },
  tlLabel: { fontFamily: F.body },
  tlValue: { fontFamily: F.heading, fontSize: 20, lineHeight: 24 },
  rule: { height: 1, marginBottom: 16 },
  list: { paddingHorizontal: 16, paddingBottom: 140 },
  suggest: { flexDirection: "row", alignItems: "flex-start", gap: 7, borderWidth: 1, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 16 },
  suggestText: { flex: 1, fontFamily: F.body, lineHeight: 18 },
  search: { flexDirection: "row", alignItems: "center", gap: 9, height: 42, borderWidth: 1, borderRadius: 10, paddingHorizontal: 13, marginBottom: 10 },
  searchText: { fontFamily: F.body },
  filters: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 12 },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4, maxWidth: 180 },
  chipText: { fontFamily: F.body },
  pendingCount: { marginLeft: "auto", fontFamily: F.body },
  groupHead: { fontFamily: F.body, letterSpacing: 0.8, paddingTop: 6, paddingBottom: 8 },
  empty: { textAlign: "center", fontFamily: F.body, paddingVertical: 32 },
  addArea: { alignItems: "center", gap: 10, paddingTop: 24 },
  addBtn: { borderRadius: 14, paddingVertical: 13, paddingHorizontal: 28 },
  addText: { fontFamily: F.heading },
  tplLabel: { fontFamily: F.body, letterSpacing: 0.8 },
  tpls: { flexDirection: "row", flexWrap: "wrap", gap: 6, justifyContent: "center", maxWidth: 340 },
  tpl: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 999 },
  tplName: { paddingVertical: 7, paddingLeft: 14, paddingRight: 4 },
  tplDel: { paddingVertical: 7, paddingLeft: 4, paddingRight: 12 },
});
