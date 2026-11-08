import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { router, type Href } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { contrastColor, ink } from "@dueplanner/core/lib/format";
import { dueShort, SIDEBAR_TASK_CAP, subjectGroups } from "@dueplanner/core/lib/sidebarSubjects";
import { todayISO } from "@dueplanner/core/lib/dates";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";

// The menu (the web's sidebar, which on a phone is a drawer): Search, Inbox,
// History, Import/Export and Settings, then the subjects. A subject's arrow
// shows its open tasks (most urgent first); its name shows only that subject
// on Home. Home, Calendar and Focus are the tab bar here.
export default function Menu() {
  const app = useApp();
  const { T, fz } = app;
  const s = app.settings;
  const today = todayISO();
  const [showAll, setShowAll] = useState<string[]>([]);
  const groups = subjectGroups(app.tasks, s.subjects);
  const unread = s.recaps.filter(r => !r.read).length;

  const go = (href: Href) => { router.back(); router.push(href); };
  const pick = (name: string) => {
    app.setSubjectFilter(app.subjectFilter === name ? null : name);
    app.setHomeFilter(app.homeFilter === "noest" ? "all" : app.homeFilter);
    router.back();
    router.navigate("/");
  };
  const toggleOpen = (name: string) => s.setOpenSubjects(s.openSubjects.includes(name) ? s.openSubjects.filter(n => n !== name) : [...s.openSubjects, name]);

  const row = (icon: SFSymbol, label: string, onPress: () => void, extra?: React.ReactNode) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label + (label === "Inbox" && unread ? `, ${unread} unread` : "")}
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? T.cardAlt : "transparent" }]}>
      <SymbolView name={icon} size={18} tintColor={T.textMuted} />
      <Text style={[styles.rowText, { fontSize: fz(13), color: T.text }]}>{label}</Text>
      {extra}
    </Pressable>
  );

  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={styles.body}>
      {row("magnifyingglass", "Search", () => go("/search"))}
      <View style={[styles.rule, { backgroundColor: T.border }]} />
      {row("bell", "Inbox", () => go("/inbox"), unread > 0 && (
        <Text style={[styles.badge, { fontSize: fz(10), backgroundColor: T.accent, color: contrastColor(T.accent) }]}>{unread}</Text>
      ))}
      {row("clock.arrow.circlepath", "History", () => go("/history"))}
      {row("square.and.arrow.down", "Import/Export", () => go("/import"))}
      {row("gearshape", "Settings", () => { router.back(); router.navigate("/settings"); })}

      {groups.length > 0 && (
        <>
          <View style={[styles.rule, { backgroundColor: T.border }]} />
          <Text style={[styles.kicker, { fontSize: fz(10), color: T.textMuted }]} accessibilityRole="header">SUBJECTS</Text>
          {groups.map(g => {
            const label = g.name || "No subject";
            const isOpen = s.openSubjects.includes(g.name);
            const all = showAll.includes(g.name);
            const shown = all ? g.tasks : g.tasks.slice(0, SIDEBAR_TASK_CAP);
            const color = g.name ? s.subjectColors[g.name] || T.accent : T.textMuted;
            const picked = app.subjectFilter === g.name;
            return (
              <View key={g.name}>
                <View style={styles.subRow}>
                  <Pressable onPress={() => toggleOpen(g.name)} hitSlop={6} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}
                    accessibilityLabel={`${isOpen ? "Hide" : "Show"} ${label} tasks`} style={styles.arrow}>
                    <View style={{ transform: [{ rotate: isOpen ? "90deg" : "0deg" }] }}>
                      <SymbolView name="chevron.right" size={11} weight="semibold" tintColor={T.textMuted} />
                    </View>
                  </Pressable>
                  <Pressable onPress={() => pick(g.name)} accessibilityRole="button" accessibilityState={{ selected: picked }} accessibilityLabel={`${label}, ${g.tasks.length} to do`}
                    accessibilityHint={`Show only ${label} on Home`}
                    style={({ pressed }) => [styles.subName, { backgroundColor: picked ? T.cardAlt : pressed ? T.card : "transparent" }]}>
                    <View style={[styles.dot, { backgroundColor: color }]} />
                    <Text numberOfLines={1} style={[styles.rowText, { fontSize: fz(13), color: T.text }]}>{label}</Text>
                    {g.tasks.length > 0 && <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textMuted }}>{g.tasks.length}</Text>}
                  </Pressable>
                </View>
                {isOpen && (
                  <View style={[styles.tasks, { borderLeftColor: T.border }]}>
                    {g.tasks.length === 0 && <Text style={[styles.taskText, { fontSize: fz(11), color: T.textFaint }]}>Nothing to do</Text>}
                    {shown.map(t => {
                      const due = dueShort(t.dueDate, today);
                      return (
                        <Pressable key={t.id} onPress={() => go(`/task/${t.id}`)} accessibilityRole="button" accessibilityLabel={`${t.title}${due ? `, ${due}` : ""}`}
                          style={({ pressed }) => [styles.task, { backgroundColor: pressed ? T.cardAlt : "transparent" }]}>
                          <Text numberOfLines={1} style={[styles.taskText, { fontSize: fz(12), color: T.text }]}>{t.title}</Text>
                          {!!due && <Text style={{ fontFamily: F.body, fontSize: fz(10), color: due === "Overdue" ? ink("#FF4757", T.light) : T.textMuted }}>{due}</Text>}
                        </Pressable>
                      );
                    })}
                    {g.tasks.length > SIDEBAR_TASK_CAP && (
                      <Pressable onPress={() => setShowAll(a => (all ? a.filter(n => n !== g.name) : [...a, g.name]))} accessibilityRole="button" style={styles.task}>
                        <Text style={[styles.taskText, { fontSize: fz(12), color: T.textMuted }]}>{all ? "Show fewer" : `Show all ${g.tasks.length}`}</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </>
      )}

      <Text style={[styles.foot, { fontSize: fz(9), color: T.textFaint }]}>DuePlanner, by due. studios</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 12, paddingTop: 16, paddingBottom: 40 },
  row: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 9, paddingVertical: 10, paddingHorizontal: 10 },
  rowText: { flex: 1, fontFamily: F.body },
  badge: { fontFamily: F.bodyMedium, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1, overflow: "hidden" },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 8, marginHorizontal: 10 },
  kicker: { fontFamily: F.body, letterSpacing: 0.8, paddingHorizontal: 10, paddingTop: 4, paddingBottom: 6 },
  subRow: { flexDirection: "row", alignItems: "center" },
  arrow: { paddingVertical: 10, paddingLeft: 10, paddingRight: 6 },
  subName: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 9, paddingVertical: 9, paddingLeft: 6, paddingRight: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tasks: { marginLeft: 15, paddingLeft: 9, borderLeftWidth: 1, marginBottom: 4 },
  task: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 },
  taskText: { flex: 1, fontFamily: F.body },
  foot: { fontFamily: F.body, paddingHorizontal: 10, paddingTop: 24 },
});
