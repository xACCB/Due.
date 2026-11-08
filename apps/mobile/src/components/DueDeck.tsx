import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Animated, PanResponder, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { router } from "expo-router";
import { byDueDate } from "@dueplanner/core/lib/calendar";
import { todayISO } from "@dueplanner/core/lib/dates";
import { formatDuration, ink } from "@dueplanner/core/lib/format";
import { useApp } from "../state/appContext";
import { relativeDay, sortDay } from "../lib/day";
import { F } from "../theme/fonts";
import { DayTaskRow } from "./DayTaskRow";

const DECK_HEIGHT = 470;

// The Calendar's Deck view (the web's DueDeck): one card per date that still
// has an open task or is today or later, the date written large and that
// day's tasks under it. Up to four are drawn, each one behind sitting lower
// and narrower so their edges show. Swipe the top card left for the next date
// (it flies off), right for the one before (it comes back in from the left),
// or use the arrows. Opens on the first date from today on; the top card is
// remembered by its date, so changes elsewhere don't move you.
export function DueDeck() {
  const app = useApp();
  const { T, fz, ms } = app;
  const { width } = useWindowDimensions();
  const today = todayISO();
  const due = useMemo(() => byDueDate(app.tasks.filter(t => !t.archived)), [app.tasks]);
  const dates = useMemo(() => [...due.keys()].filter(d => d >= today || due.get(d)!.some(t => !t.done)).sort(), [due, today]);
  const [picked, setPicked] = useState<string | null>(null);
  const fallback = dates.find(d => d >= today) ?? dates[dates.length - 1];
  const current = picked && dates.includes(picked) ? picked : fallback;
  const idx = dates.indexOf(current);

  const [x] = useState(() => new Animated.Value(0));
  const busy = useRef(false);
  const reduced = useRef(false);
  useEffect(() => { AccessibilityInfo.isReduceMotionEnabled().then(v => { reduced.current = v; }).catch(() => {}); }, []);

  // Read by the gesture, which is made once.
  const live = useRef({ idx, dates, width, ms });
  useEffect(() => { live.current = { idx, dates, width, ms }; }, [idx, dates, width, ms]);

  // What to do with the shared position once the new top card is in place:
  // reset it (after a card flew off) or bring the earlier card in from the
  // left. Done in a layout effect, after React has swapped the cards; doing it
  // straight away would flash the outgoing card for a frame.
  const after = useRef<null | "reset" | "enter">(null);
  useLayoutEffect(() => {
    const step = after.current;
    after.current = null;
    if (step === "reset") { x.setValue(0); busy.current = false; }
    if (step === "enter") {
      x.setValue(-live.current.width * 1.2);
      Animated.timing(x, { toValue: 0, duration: live.current.ms(260), useNativeDriver: true }).start(() => { busy.current = false; });
    }
  }, [current, x]);

  const go = (delta: number) => {
    const { idx: i, dates: ds, width: w, ms: t } = live.current;
    const next = ds[i + delta];
    if (!next || busy.current) return false;
    if (reduced.current) { x.setValue(0); setPicked(next); return true; }
    busy.current = true;
    if (delta > 0) {
      Animated.timing(x, { toValue: -w * 1.2, duration: t(220), useNativeDriver: true }).start(() => {
        after.current = "reset";
        setPicked(next);
      });
    } else {
      after.current = "enter";
      setPicked(next);
    }
    return true;
  };
  const goRef = useRef(go);
  useEffect(() => { goRef.current = go; });

  // The handlers read the refs only during a gesture, never while rendering;
  // the lint can't tell callbacks given to PanResponder from render code.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => !busy.current && Math.abs(g.dx) >= 6 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderMove: (_, g) => {
      const { idx: i, dates: ds } = live.current;
      // Follows the finger toward the next card; resists when there's nothing
      // that way, and when pulling right (the earlier card comes in over it).
      x.setValue(g.dx < 0 && i < ds.length - 1 ? g.dx : g.dx * 0.3);
    },
    onPanResponderRelease: (_, g) => {
      const want = g.dx <= -70 || (g.vx < -0.6 && g.dx < -24) ? 1 : g.dx >= 70 || (g.vx > 0.6 && g.dx > 24) ? -1 : 0;
      if (want === 1 && goRef.current(1)) return;
      Animated.timing(x, { toValue: 0, duration: 200, useNativeDriver: true }).start();
      if (want === -1) goRef.current(-1);
    },
    onPanResponderTerminate: () => { Animated.timing(x, { toValue: 0, duration: 200, useNativeDriver: true }).start(); },
  }));

  if (dates.length === 0) {
    return (
      <View style={[styles.empty, { backgroundColor: T.card, borderColor: T.border }]}>
        <Text style={[styles.emptyTitle, { color: T.text }]}>Nothing due</Text>
        <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.textFaint, textAlign: "center" }}>Tasks with a due date show up here, one card per day.</Text>
      </View>
    );
  }

  const rotate = x.interpolate({ inputRange: [-width, 0, width], outputRange: ["-40deg", "0deg", "40deg"] });
  const navBtn = (glyph: string, label: string, delta: number, disabled: boolean) => (
    <Pressable onPress={() => go(delta)} disabled={disabled} hitSlop={6} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}
      style={[styles.navBtn, { borderColor: T.border, opacity: disabled ? 0.4 : 1 }]}>
      <Text style={{ color: T.text, fontSize: fz(16), lineHeight: fz(16) + 3 }}>{glyph}</Text>
    </Pressable>
  );

  return (
    <View>
      <View style={styles.deck} accessibilityLabel="Due dates. Swipe left or right, or use the arrows below, to move between days">
        {dates.slice(idx, idx + 4).map((iso, k) => {
          const d = new Date(iso + "T00:00:00");
          const list = sortDay(due.get(iso) ?? []);
          const open = list.filter(t => !t.done);
          const mins = open.reduce((n, t) => n + (t.estMins || 0), 0);
          const rel = relativeDay(iso, today);
          const late = iso < today && open.length > 0;
          const top = k === 0;
          const depth = [{ translateY: k * 10 }, { scale: 1 - k * 0.045 }];
          return (
            <Animated.View
              key={iso}
              {...(top ? pan.panHandlers : {})}
              importantForAccessibility={top ? "auto" : "no-hide-descendants"}
              accessibilityElementsHidden={!top}
              style={[
                styles.card,
                { backgroundColor: T.bg, borderColor: T.border, zIndex: 4 - k, shadowOpacity: T.light ? 0.1 : 0.55 },
                { transform: top ? [{ translateX: x }, { rotate }, ...depth] : depth },
              ]}
            >
              <View style={styles.cardHead}>
                <View style={{ flexShrink: 1 }}>
                  <Text style={[styles.weekday, { fontSize: fz(12), color: T.textMuted }]}>{d.toLocaleDateString(undefined, { weekday: "long" }).toUpperCase()}</Text>
                  <Text style={[styles.bigDate, { color: T.accent }]}>{d.getDate()}</Text>
                  <Text style={[styles.monthYear, { color: T.text }]}>{d.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</Text>
                </View>
                <View style={styles.cardSide}>
                  <Text style={{ fontFamily: F.bodyMedium, fontSize: fz(12), color: late ? ink("#FF4757", T.light) : T.text }}>{rel}{late ? ", overdue" : ""}</Text>
                  <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textMuted, marginTop: 3 }}>{open.length === 0 ? "All done" : `${open.length} due`}{mins ? ` · ${formatDuration(mins)}` : ""}</Text>
                </View>
              </View>
              <View style={[styles.divider, { backgroundColor: T.border }]} />
              <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list} scrollEnabled={top}>
                {list.map(t => <DayTaskRow key={t.id} t={t} onOpen={() => router.push(`/task/${t.id}`)} />)}
              </ScrollView>
            </Animated.View>
          );
        })}
      </View>
      <View style={styles.nav}>
        {navBtn("‹", "Earlier date", -1, idx === 0)}
        <Text style={[styles.count, { fontSize: fz(11), color: T.textFaint }]} accessibilityLiveRegion="polite">{idx + 1} of {dates.length}</Text>
        {navBtn("›", "Later date", 1, idx === dates.length - 1)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  deck: { height: DECK_HEIGHT, marginBottom: 42 },
  card: {
    position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderWidth: 1, borderRadius: 24,
    paddingTop: 22, paddingHorizontal: 20, paddingBottom: 18, overflow: "hidden", transformOrigin: "50% 100%",
    shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowRadius: 16,
  },
  cardHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 12 },
  weekday: { fontFamily: F.body, letterSpacing: 1.4 },
  bigDate: { fontFamily: F.heading, fontSize: 116, lineHeight: 116, marginTop: 4, marginBottom: 2 },
  monthYear: { fontFamily: F.heading, fontSize: 22, lineHeight: 26 },
  cardSide: { alignItems: "flex-end", paddingTop: 2 },
  divider: { height: 1, marginTop: 14, marginBottom: 12 },
  list: { gap: 6 },
  nav: { flexDirection: "row", alignItems: "center", gap: 8 },
  navBtn: { width: 38, height: 38, borderRadius: 9, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  count: { flex: 1, textAlign: "center", fontFamily: F.body },
  empty: { borderWidth: 1, borderRadius: 14, paddingVertical: 28, paddingHorizontal: 16, alignItems: "center", gap: 6 },
  emptyTitle: { fontFamily: F.heading, fontSize: 20 },
});
