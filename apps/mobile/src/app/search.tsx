import { useEffect, useRef, useState, type ComponentRef } from "react";
import { AccessibilityInfo, FlatList, Keyboard, Pressable, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useNavigation, usePreventRemove } from "expo-router";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import type { Task } from "@dueplanner/core/types";
import { searchTasks } from "@dueplanner/core/lib/taskViews";
import { daysUntil, getPriority, ink } from "@dueplanner/core/lib/format";
import { priColor } from "@dueplanner/core/constants";
import { useApp } from "../state/appContext";
import { EASE_OUT } from "../lib/motion";
import { F } from "../theme/fonts";
import { useDevAction } from "../lib/devScroll";
import { IconSearch } from "../components/icons";
import { Backdrop } from "../components/Backdrop";
import { setSearchFieldHidden, takeSearchOrigin } from "../lib/searchOrigin";

// The web's SearchOverlay motion: the bar flies out of Home's field in 440ms
// and back in 300ms, the backdrop fades in over 260ms (ease-out) and out over
// 280ms (ease-in), the results fade out first (140ms).
const FLY_OUT = Easing.bezier(0.2, 0.9, 0.25, 1);
const FLY_BACK = Easing.bezier(0.4, 0, 0.2, 1);
const EASE_IN = Easing.bezier(0.42, 0, 1, 1);
const BAR_H = 54;

// Search (the web's SearchOverlay): a title, subject or tag; archived tasks
// left out, open ones first, 50 at most (core's searchTasks). Return opens
// the first result; tapping one opens its task sheet. The bar sits where the
// web's does: a third of the way down the space the keyboard leaves.
// Opened from Home's field, the bar flies out of it and back into it on
// closing (lib/searchOrigin.ts); opened from the sidebar, it fades. The screen
// itself has no animation (app/_layout.tsx): this is all of it.
export default function Search() {
  const app = useApp();
  const { T, fz, ms } = app;
  const navigation = useNavigation();
  const reduced = useReducedMotion();
  const [from] = useState(takeSearchOrigin);
  const fromH = from?.h ?? BAR_H;
  const barRef = useRef<ComponentRef<typeof View>>(null);
  const inputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const shade = useSharedValue(reduced ? 1 : 0); // the backdrop and the results
  const shown = useSharedValue(reduced ? 1 : 0); // the bar, unseen until it's measured
  const fly = useSharedValue(from && !reduced ? 0 : 1); // 0 over Home's field, 1 in place
  const dx = useSharedValue(0);
  const dy = useSharedValue(0);
  const placed = useRef(false);
  const leaving = useRef(false); // replaced by a task's sheet: no flying back
  const onBarLayout = () => {
    if (placed.current || reduced) return;
    placed.current = true;
    shade.set(withTiming(1, { duration: ms(260), easing: EASE_OUT }));
    // The cursor (and the keyboard) once the bar has nearly arrived: focusing
    // at once held up the first 250ms of the flight, which then jumped.
    setTimeout(() => inputRef.current?.focus(), ms(200));
    if (!from) { shown.set(withTiming(1, { duration: ms(200), easing: EASE_OUT })); return; }
    barRef.current?.measureInWindow((x, y) => {
      dx.set(from.x - x);
      dy.set(from.y - y);
      shown.set(1);
      setSearchFieldHidden(true);
      fly.set(withTiming(1, { duration: ms(440), easing: FLY_OUT }));
    });
  };
  // Every way out (Cancel, the backdrop, a back gesture) plays the way back first.
  // The leaving itself waits for the way back: kept here, then sent once the
  // guard is off (a dispatch from inside the guard was refused again, in a loop).
  const [goAction, setGoAction] = useState<{ type: string } | null>(null);
  useEffect(() => { if (goAction) navigation.dispatch(goAction); }, [goAction, navigation]);
  usePreventRemove(!reduced && !goAction, ({ data }) => {
    const done = () => { setSearchFieldHidden(false); setGoAction(data.action); };
    if (leaving.current || !placed.current) { done(); return; }
    leaving.current = true;
    Keyboard.dismiss();
    shade.set(withTiming(0, { duration: ms(280), easing: EASE_IN }));
    const end = (finished?: boolean) => { "worklet"; if (finished) scheduleOnRN(done); };
    if (from) fly.set(withTiming(0, { duration: ms(300), easing: FLY_BACK }, end));
    else shown.set(withTiming(0, { duration: ms(200), easing: EASE_IN }, end));
  });
  useEffect(() => () => setSearchFieldHidden(false), []);
  const listStyle = useAnimatedStyle(() => ({ opacity: Math.min(shade.get(), shown.get()) }));
  const ringStyle = useAnimatedStyle(() => ({
    opacity: shown.get(),
    transform: [{ translateX: dx.get() * (1 - fly.get()) }, { translateY: dy.get() * (1 - fly.get()) }],
  }));
  const barStyle = useAnimatedStyle(() => ({ height: fromH + (BAR_H - fromH) * fly.get() }));
  const { subjectColors, colorCodeUrgency } = app.settings;
  const [query, setQuery] = useState("");
  useDevAction("search", q => setQuery(q)); // development only: typing a query
  const [typing, setTyping] = useState(false); // the field has the cursor: the web's ring
  const q = query.trim().toLowerCase();
  const results = searchTasks(app.shownTasks, q);
  const open = (t: Task) => { leaving.current = true; router.replace(`/task-sheet/${t.id}`); };
  // "3 tasks found" is for screen readers only, as on the web (its .sr-only line).
  const found = q && results.length ? `${results.length} ${results.length === 1 ? "task" : "tasks"} found` : "";
  useEffect(() => { if (found) AccessibilityInfo.announceForAccessibility(found); }, [found]);
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const aimH = (height - insets.top - insets.bottom) * 0.58; // the web's aimH while a phone keyboard is coming
  const barTop = Math.max(24, Math.round(aimH * 0.34 - 28));

  const highlight = (title: string) => {
    const at = q ? title.toLowerCase().indexOf(q) : -1;
    if (at < 0) return title;
    return (
      <>
        {title.slice(0, at)}
        <Text style={{ backgroundColor: T.light ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.18)" }}>{title.slice(at, at + q.length)}</Text>
        {title.slice(at + q.length)}
      </>
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
      {/* The web's blurred backdrop; a tap on it closes Search. */}
      <Backdrop kind="search" onPress={() => router.back()} label="Close Search" progress={shade} />
      <View style={{ height: barTop }} pointerEvents="none" />
      {/* The web's ring while the field has the cursor: 2px of accent, 2px outside the bar. */}
      <Animated.View style={[styles.ring, { borderColor: typing ? T.accent : "transparent" }, ringStyle]}>
      <Animated.View ref={barRef} onLayout={onBarLayout} style={[styles.bar, { backgroundColor: T.card, borderColor: T.border }, barStyle]}>
        <IconSearch color={T.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          ref={inputRef}
          autoFocus={reduced}
          placeholder="Search tasks..."
          placeholderTextColor={T.textFaint}
          accessibilityLabel="Search tasks"
          returnKeyType="search"
          autoCorrect={false}
          onSubmitEditing={() => { if (results[0]) open(results[0]); }}
          onFocus={() => setTyping(true)}
          onBlur={() => setTyping(false)}
          style={[styles.input, { color: T.text, fontSize: fz(16) }]}
        />
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel">
          <Text style={[styles.cancel, { fontSize: fz(11), color: T.textMuted }]}>Cancel</Text>
        </Pressable>
      </Animated.View>
      </Animated.View>
      {/* Only as tall as its rows, so a tap on the space below reaches the
          backdrop and closes Search, as on the web. */}
      <Animated.View pointerEvents="box-none" style={[{ flexShrink: 1 }, listStyle]}>
      <FlatList
        style={{ flexGrow: 0 }}
        data={results}
        keyExtractor={t => String(t.id)}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.list}
        renderItem={({ item: t }) => {
          const pr = getPriority(t.dueDate, t.estMins, t.priorityOverride);
          const sc = subjectColors[t.subject] || T.accent;
          return (
            <Pressable onPress={() => open(t)} accessibilityRole="button" accessibilityLabel={`${t.title}${t.done ? ", done" : ""}${t.subject ? `, ${t.subject}` : ""}`}
              style={({ pressed }) => [styles.row, { backgroundColor: pressed ? T.cardAlt : T.card, borderColor: T.border }]}>
              <View style={[styles.dot, { backgroundColor: t.done ? T.textFaint : priColor(pr, colorCodeUrgency) }]} />
              <Text numberOfLines={1} style={[styles.title, { fontSize: fz(14), color: t.done ? T.textFaint : T.text, textDecorationLine: t.done ? "line-through" : "none" }]}>{highlight(t.title)}</Text>
              {!!t.subject && <Text style={[styles.pill, { fontSize: fz(10), backgroundColor: sc + "22", color: ink(sc, T.light) }]}>{t.subject}</Text>}
              {!t.done && !!t.dueDate && <Text style={[styles.due, { fontSize: fz(10), color: ink(priColor(pr, colorCodeUrgency), T.light) }]}>{daysUntil(t.dueDate)}</Text>}
            </Pressable>
          );
        }}
        ListFooterComponent={
          found ? undefined : (
            <Text style={[styles.note, { fontSize: fz(11), color: T.textMuted }]} accessibilityLiveRegion="polite">
              {!q ? "Type a title, subject or tag" : `No tasks match "${query.trim()}"`}
            </Text>
          )
        }
      />
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  ring: { marginTop: 22, padding: 2, borderWidth: 2, borderRadius: 16, marginHorizontal: -4 },
  bar: { flexDirection: "row", alignItems: "center", gap: 9, height: BAR_H, overflow: "hidden", borderWidth: 1, borderRadius: 12, paddingLeft: 15, paddingRight: 8 },
  input: { flex: 1, fontFamily: F.body, paddingVertical: 9 },
  cancel: { fontFamily: F.body, padding: 6 },
  list: { paddingTop: 10, gap: 6, paddingBottom: 40 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 13 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  title: { flex: 1, fontFamily: F.heading },
  pill: { fontFamily: F.body, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  due: { fontFamily: F.body },
  note: { textAlign: "center", fontFamily: F.body, paddingVertical: 6 },
});
