import { useEffect, useState, type ReactNode } from "react";
import { Alert, Animated, Easing, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { router, usePathname, type Href } from "expo-router";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { contrastColor, ink } from "@dueplanner/core/lib/format";
import { dueShort, SIDEBAR_TASK_CAP, subjectGroups } from "@dueplanner/core/lib/sidebarSubjects";
import { todayISO } from "@dueplanner/core/lib/dates";
import { useApp } from "../state/appContext";
import { useDevAction } from "../lib/devScroll";
import { F } from "../theme/fonts";
import { TimerText } from "./TimerPill";
import { IconBell, IconCalendar, IconChevron, IconFocus, IconHistory, IconImport, IconPerson, IconSearch, IconSettings, IconSidebar, IconTasks } from "./icons";

// The web's sidebar, which on a phone-sized screen is a drawer: it slides in
// from the left over a dimmed page, from the header's sidebar button or a swipe
// in from the left edge (the 20px nearest it), and closes on a swipe left, a
// tap on the dimmed page, its own sidebar button or picking a row. Top to
// bottom as on the web: the profile row, Search, Home, Calendar, Focus, the
// subjects, Inbox, History, Import/Export, Settings, and the credit line.
// `children` are the app's screens; the edge swipe is detected over them.
export function SidebarHost({ children }: { children: ReactNode }) {
  const app = useApp();
  const { T, ms, drawerOpen, setDrawerOpen } = app;
  const { width } = useWindowDimensions();
  const W = Math.min(260, Math.round(width * 0.84)); // the web's width:260px; max-width:84vw
  const [p] = useState(() => new Animated.Value(0)); // 0 closed .. 1 open
  const [dragging, setDragging] = useState(false);

  // .2s ease-out, as the web's transform transition. Both the button (through
  // drawerOpen) and a released swipe end here.
  const slide = (open: boolean) => Animated.timing(p, { toValue: open ? 1 : 0, duration: ms(200), easing: Easing.bezier(0, 0, 0.58, 1), useNativeDriver: true });
  const settle = (open: boolean) => slide(open).start();
  useEffect(() => { slide(drawerOpen).start(); }, [drawerOpen]); // eslint-disable-line react-hooks/exhaustive-deps
  const end = (open: boolean) => { setDragging(false); setDrawerOpen(open); settle(open); };
  useDevAction("sidebar", arg => setDrawerOpen(arg !== "close")); // development only

  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  // Opening: sideways first (10px) from the left edge; a vertical move hands it to scrolling.
  const edge = usePanGesture({
    enabled: !drawerOpen,
    hitSlop: { left: 0, width: 20 },
    activeOffsetX: 10,
    failOffsetY: [-10, 10],
    runOnJS: true,
    onActivate: () => setDragging(true),
    onUpdate: e => p.setValue(clamp(e.translationX / W)),
    onDeactivate: e => end(e.translationX > W / 3 || e.velocityX > 500),
  });
  // Closing: a swipe left anywhere on the open drawer.
  const shut = usePanGesture({
    enabled: drawerOpen,
    activeOffsetX: -10,
    failOffsetY: [-10, 10],
    runOnJS: true,
    onActivate: () => setDragging(true),
    onUpdate: e => p.setValue(clamp(1 + e.translationX / W)),
    onDeactivate: e => end(!(e.translationX < -W / 3 || e.velocityX < -500)),
  });

  const x = p.interpolate({ inputRange: [0, 1], outputRange: [-W - 48, 0] }); // past its shadow when closed
  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <GestureDetector gesture={edge}>
        <View style={{ flex: 1 }} importantForAccessibility={drawerOpen ? "no-hide-descendants" : "auto"} accessibilityElementsHidden={drawerOpen}>
          {children}
        </View>
      </GestureDetector>
      <View style={StyleSheet.absoluteFill} pointerEvents={drawerOpen || dragging ? "box-none" : "none"}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.45)", opacity: p }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setDrawerOpen(false)} accessibilityRole="button" accessibilityLabel="Close sidebar" disabled={!drawerOpen} />
        </Animated.View>
        <GestureDetector gesture={shut}>
          <Animated.View style={[styles.panel, { width: W, backgroundColor: T.bg, borderRightColor: T.border, transform: [{ translateX: x }] }]}
            accessibilityViewIsModal={drawerOpen} accessibilityLabel="Main">
            <SidebarBody />
          </Animated.View>
        </GestureDetector>
      </View>
    </View>
  );
}

function SidebarBody() {
  const app = useApp();
  const { T, fz, setDrawerOpen } = app;
  const s = app.settings;
  const insets = useSafeAreaInsets();
  const path = usePathname();
  const today = todayISO();
  const [showAll, setShowAll] = useState<string[]>([]); // which unfolded subjects show every task; not remembered
  const groups = subjectGroups(app.tasks, s.subjects);
  const unread = s.recaps.filter(r => !r.read).length;
  const onHome = path === "/";
  const timing = app.focus.endAt != null || app.focus.swStartedAt != null;
  const openTaskId = path.startsWith("/task/") ? Number(path.slice(6)) : null;

  const close = () => setDrawerOpen(false);
  const go = (href: Href) => { close(); router.navigate(href); };
  const pick = (name: string) => {
    app.setSubjectFilter(onHome && app.subjectFilter === name ? null : name);
    if (app.homeFilter === "noest") app.setHomeFilter("all");
    go("/");
  };
  const openTask = (id: number) => { close(); if (openTaskId != null) router.replace(`/task/${id}`); else router.push(`/task/${id}`); };
  const toggleOpen = (name: string) => s.setOpenSubjects(s.openSubjects.includes(name) ? s.openSubjects.filter(n => n !== name) : [...s.openSubjects, name]);
  const signIn = () => Alert.alert("Sign in", "Signing in, and syncing with the website, comes in a later update. Until then your tasks are saved on this phone.");

  // One row (the web's SidebarRow, .sb-row): `current` marks the screen showing.
  const row = (icon: (color: string) => ReactNode, label: string, onPress: () => void, current: boolean, extra?: ReactNode, a11y?: string) => (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y ?? label} accessibilityState={{ selected: current }}
      style={({ pressed }) => [styles.row, { backgroundColor: current ? T.card : pressed ? T.cardAlt : "transparent" }]}>
      <View style={styles.icon}>{icon(current ? T.text : T.textMuted)}</View>
      <Text numberOfLines={1} style={[styles.label, { fontSize: fz(13), color: current ? T.text : T.textMuted }]}>{label}</Text>
      {extra}
    </Pressable>
  );
  const rule = <View style={[styles.rule, { backgroundColor: T.border + "33" }]} />;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={[styles.body, { paddingTop: 14 + insets.top, paddingBottom: 12 + insets.bottom }]}>
      <View style={styles.top}>
        <Pressable onPress={signIn} accessibilityRole="button" accessibilityLabel="Sign in. Sync across devices"
          style={({ pressed }) => [styles.row, styles.profile, { backgroundColor: pressed ? T.cardAlt : "transparent" }]}>
          <View style={[styles.avatar, { backgroundColor: T.cardAlt }]}>
            <IconPerson color={T.textMuted} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: fz(13), color: T.text }}>Sign in</Text>
            <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: fz(10), marginTop: 1, color: T.textMuted }}>Sync across devices</Text>
          </View>
        </Pressable>
        <Pressable onPress={close} hitSlop={6} accessibilityRole="button" accessibilityLabel="Close sidebar" style={styles.closeBtn}>
          <IconSidebar color={T.textMuted} />
        </Pressable>
      </View>
      {row(c => <IconSearch color={c} />, "Search", () => { close(); router.push("/search"); }, false)}
      {rule}
      {row(c => <IconTasks color={c} />, "Home", () => { app.setSubjectFilter(null); go("/"); }, onHome && app.subjectFilter == null)}
      {row(c => <IconCalendar color={c} />, "Calendar", () => go("/calendar"), path === "/calendar")}
      {row(c => <IconFocus color={c} />, "Focus", () => go("/focus"), path === "/focus",
        timing ? <TimerText color={T.text} size={fz(11)} /> : null)}

      {/* Subjects, each unfolding to its open tasks. Picking a name shows only it
          on Home (picking it again, or Home, shows everything). */}
      {groups.length > 0 && (
        <View>
          {rule}
          <Text style={[styles.kicker, { fontSize: fz(10), color: T.textMuted }]} accessibilityRole="header">SUBJECTS</Text>
          {groups.map(g => {
            const label = g.name || "No subject";
            const isOpen = s.openSubjects.includes(g.name);
            const all = showAll.includes(g.name);
            const shown = all ? g.tasks : g.tasks.slice(0, SIDEBAR_TASK_CAP);
            const color = g.name ? s.subjectColors[g.name] || T.accent : T.textMuted;
            const picked = onHome && app.subjectFilter === g.name;
            return (
              <View key={g.name}>
                <View style={styles.subRow}>
                  <Pressable onPress={() => toggleOpen(g.name)} hitSlop={{ top: 4, bottom: 4, left: 8 }} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}
                    accessibilityLabel={`${isOpen ? "Hide" : "Show"} ${label} tasks`} style={styles.arrow}>
                    <View style={{ transform: [{ rotate: isOpen ? "90deg" : "0deg" }] }}>
                      <IconChevron color={T.textMuted} />
                    </View>
                  </Pressable>
                  <Pressable onPress={() => pick(g.name)} accessibilityRole="button" accessibilityState={{ selected: picked }} accessibilityLabel={`${label}, ${g.tasks.length} to do`}
                    accessibilityHint={`Show only ${label} on Home`}
                    style={({ pressed }) => [styles.row, styles.subName, { backgroundColor: picked ? T.card : pressed ? T.cardAlt : "transparent" }]}>
                    <View style={[styles.dot, { backgroundColor: color }]} />
                    <Text numberOfLines={1} style={[styles.label, { fontSize: fz(13), color: picked ? T.text : T.textMuted }]}>{label}</Text>
                    {g.tasks.length > 0 && <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textMuted }}>{g.tasks.length}</Text>}
                  </Pressable>
                </View>
                {isOpen && (
                  <View style={[styles.tasks, { borderLeftColor: T.border + "33" }]}>
                    {g.tasks.length === 0 && <Text style={[styles.task, { fontFamily: F.body, fontSize: fz(11), color: T.textFaint }]}>Nothing to do</Text>}
                    {shown.map(t => {
                      const due = dueShort(t.dueDate, today);
                      const current = t.id === openTaskId;
                      return (
                        <Pressable key={t.id} onPress={() => openTask(t.id)} accessibilityRole="button" accessibilityLabel={`${t.title}${due ? `, ${due}` : ""}`}
                          style={({ pressed }) => [styles.row, styles.task, { backgroundColor: current ? T.card : pressed ? T.cardAlt : "transparent" }]}>
                          <Text numberOfLines={1} style={[styles.label, { fontSize: fz(12), color: current ? T.text : T.textMuted }]}>{t.title}</Text>
                          {!!due && <Text style={{ fontFamily: F.body, fontSize: fz(10), color: due === "Overdue" ? ink("#FF4757", T.light) : T.textMuted }}>{due}</Text>}
                        </Pressable>
                      );
                    })}
                    {g.tasks.length > SIDEBAR_TASK_CAP && (
                      <Pressable onPress={() => setShowAll(a => (all ? a.filter(n => n !== g.name) : [...a, g.name]))} accessibilityRole="button" style={[styles.row, styles.task]}>
                        <Text style={[styles.label, { fontSize: fz(12), color: T.textMuted }]}>{all ? "Show fewer" : `Show all ${g.tasks.length}`}</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
      {rule}
      {row(c => <IconBell color={c} />, "Inbox", () => go("/inbox"), path === "/inbox",
        unread > 0 ? <Text style={[styles.badge, { fontSize: fz(10), backgroundColor: T.accent, color: contrastColor(T.accent) }]}>{unread}</Text> : null,
        unread > 0 ? `Inbox, ${unread} unread` : "Inbox")}
      {row(c => <IconHistory color={c} />, "History", () => go("/history"), path === "/history")}
      {row(c => <IconImport color={c} />, "Import/Export", () => go("/import"), path === "/import")}
      {row(c => <IconSettings color={c} />, "Settings", () => go("/settings"), path === "/settings")}
      <View style={{ flex: 1 }} />
      <Text style={[styles.foot, { fontSize: fz(9), color: T.textFaint }]}>DuePlanner, by due. studios</Text>
    </ScrollView>
  );
}

// The web's .app-sidebar and .sb-* rules, in the same numbers.
const styles = StyleSheet.create({
  panel: { position: "absolute", top: 0, left: 0, bottom: 0, borderRightWidth: 1, shadowColor: "#000", shadowOpacity: 0.45, shadowRadius: 20, shadowOffset: { width: 0, height: 0 } },
  body: { flexGrow: 1, paddingHorizontal: 10, gap: 2 },
  top: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6 },
  profile: { flex: 1, minWidth: 0, paddingVertical: 7, paddingHorizontal: 8 },
  avatar: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  closeBtn: { padding: 8, borderRadius: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 8, paddingVertical: 9, paddingHorizontal: 10 },
  icon: { width: 18, alignItems: "center" },
  label: { flex: 1, minWidth: 0, fontFamily: F.body },
  rule: { height: 1, marginVertical: 8, marginHorizontal: 10 },
  kicker: { fontFamily: F.body, letterSpacing: 0.8, paddingTop: 4, paddingBottom: 6, paddingHorizontal: 10 },
  subRow: { flexDirection: "row", alignItems: "center" },
  arrow: { paddingVertical: 8, paddingLeft: 8, paddingRight: 4 },
  subName: { flex: 1, minWidth: 0, gap: 8, paddingVertical: 8, paddingLeft: 6, paddingRight: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tasks: { gap: 1, marginLeft: 13, marginBottom: 4, paddingLeft: 9, borderLeftWidth: 1 },
  task: { gap: 8, paddingVertical: 6, paddingHorizontal: 10 },
  badge: { fontFamily: F.bodyMedium, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1, overflow: "hidden" },
  foot: { fontFamily: F.body, paddingTop: 10, paddingHorizontal: 10, paddingBottom: 2 },
});
