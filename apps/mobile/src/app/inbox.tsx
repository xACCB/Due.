import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { recapMessage } from "@dueplanner/core/lib/recaps";
import { formatDate } from "@dueplanner/core/lib/format";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";
import { ScreenTitle } from "../components/ScreenTitle";

// Inbox -> Messages (the web's): a recap when a day, week, month or year ends,
// if something was finished or worked on in it. Tapping one opens it in full
// and marks it read; × dismisses it. (The web's Updates list describes the
// website, so it isn't shown here until the phone app has its own.)
export default function Inbox() {
  const app = useApp();
  const { T, fz } = app;
  const { recaps, setRecaps } = app.settings;
  const [openId, setOpenId] = useState<string | null>(null);
  const items = recaps.map(r => ({ r, m: recapMessage(r) }));

  const open = (id: string) => {
    setOpenId(o => (o === id ? null : id));
    setRecaps(prev => prev.map(r => (r.id === id && !r.read ? { ...r, read: true } : r)));
  };
  const dismiss = (id: string) => setRecaps(prev => prev.filter(r => r.id !== id));

  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={styles.body}>
      <ScreenTitle title="Inbox" />
      <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
        <Text style={[styles.kicker, { fontSize: fz(11), color: T.textMuted }]} accessibilityRole="header">MESSAGES{items.length ? ` (${items.length})` : ""}</Text>
        {items.length === 0
          ? <Text style={[styles.none, { fontSize: fz(11), color: T.textFaint }]}>No messages yet. A recap arrives here when a day, week, month or year ends, if you finished or worked on something in it.</Text>
          : items.map(({ r, m }) => {
            const unread = !r.read;
            const isOpen = openId === m.id;
            return (
              <View key={m.id} style={styles.item}>
                <Pressable onPress={() => open(m.id)} accessibilityRole="button" accessibilityState={{ expanded: isOpen }}
                  accessibilityLabel={`${unread ? "Unread: " : ""}${m.headline}, ${formatDate(m.date)}`} style={styles.itemMain}>
                  <View style={styles.itemHead}>
                    <View style={styles.headline}>
                      {unread && <View style={[styles.dot, { backgroundColor: T.accent }]} />}
                      <Text style={[styles.headText, { fontSize: fz(12), color: T.accent }]}>{m.headline}</Text>
                    </View>
                    <Text style={[styles.date, { fontSize: fz(10), color: T.textFaint }]}>{formatDate(m.date)}</Text>
                  </View>
                  <Text style={[styles.kind, { fontSize: fz(10), color: T.textFaint }]}>{m.kind}</Text>
                  <Text numberOfLines={isOpen ? undefined : 2} style={[styles.desc, { fontSize: fz(11), color: unread ? T.text : T.textMuted }]}>{m.description}</Text>
                  {isOpen && !!m.list?.length && (
                    <View style={styles.list}>
                      {m.list.map((line, i) => <Text key={i} style={[styles.desc, { fontSize: fz(11), color: T.textMuted }]}>· {line}</Text>)}
                    </View>
                  )}
                </Pressable>
                <Pressable onPress={() => dismiss(m.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Dismiss ${m.headline}`}>
                  <Text style={{ fontSize: fz(14), color: T.textFaint }}>×</Text>
                </Pressable>
              </View>
            );
          })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 48 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14, gap: 12 },
  kicker: { fontFamily: F.body, letterSpacing: 0.7 },
  none: { fontFamily: F.body, lineHeight: 17 },
  item: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  itemMain: { flex: 1, minWidth: 0 },
  itemHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 },
  headline: { flexDirection: "row", alignItems: "center", flexShrink: 1 },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 7 },
  headText: { fontFamily: F.bodyMedium },
  date: { fontFamily: F.body },
  kind: { fontFamily: F.body, marginTop: 1 },
  desc: { fontFamily: F.body, marginTop: 2, lineHeight: 16 },
  list: { marginTop: 6, gap: 2 },
});
