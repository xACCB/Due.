import { useState, useRef, type ComponentRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { recapMessage } from "@dueplanner/core/lib/recaps";
import { formatDate } from "@dueplanner/core/lib/format";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";
import { ScreenTitle } from "../components/ScreenTitle";
import { Dropdown } from "../components/Dropdown";
import { MessageCard } from "../components/MessageCard";
import { useDevAction, useDevScroll } from "../lib/devScroll";

// Inbox -> Messages (the web's): a recap when a day, week, month or year ends,
// if something was finished or worked on in it. Tapping one opens it in full
// (MessageCard, with Back / Next / Dismiss) and marks it read; × dismisses it. (The web's Updates list describes the
// website, so it isn't shown here until the phone app has its own.)
export default function Inbox() {
  const app = useApp();
  const { T, fz } = app;
  const { recaps, setRecaps } = app.settings;
  const [openId, setOpenId] = useState<string | null>(null);
  const items = recaps.map(r => ({ r, m: recapMessage(r) }));
  const openIndex = openId ? items.findIndex(x => x.m.id === openId) : -1;

  // The web's openMessage: opens it and marks it read.
  const open = (id: string) => {
    setOpenId(id);
    setRecaps(prev => prev.map(r => (r.id === id && !r.read ? { ...r, read: true } : r)));
  };
  const dismiss = (id: string) => setRecaps(prev => prev.filter(r => r.id !== id));
  useDevAction("open-message", id => open(id)); // development only

  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  useDevScroll(scrollRef); // development only: the dev remote's "scroll"
  return (
    <ScrollView ref={scrollRef} style={{ backgroundColor: T.bg }} contentContainerStyle={styles.body}>
      <ScreenTitle title="Inbox" />
      <Dropdown title={`Messages${items.length ? ` (${items.length})` : ""}`} gap={12}>
        {items.length === 0
          ? <Text style={[styles.none, { fontSize: fz(11), color: T.textFaint }]}>No messages yet. A recap arrives here when a day, week, month or year ends, if you finished or worked on something in it.</Text>
          : items.map(({ r, m }) => {
            const unread = !r.read;
            return (
              <View key={m.id} style={styles.item}>
                <Pressable onPress={() => open(m.id)} accessibilityRole="button" accessibilityHint="Opens the message"
                  accessibilityLabel={`${unread ? "Unread: " : ""}${m.headline}, ${formatDate(m.date)}`} style={styles.itemMain}>
                  <View style={styles.itemHead}>
                    <View style={styles.headline}>
                      {unread && <View style={[styles.dot, { backgroundColor: T.accent }]} />}
                      <Text style={[styles.headText, { fontSize: fz(12), color: T.accent }]}>{m.headline}</Text>
                    </View>
                    <Text style={[styles.date, { fontSize: fz(10), color: T.textFaint }]}>{formatDate(m.date)}</Text>
                  </View>
                  <Text style={[styles.kind, { fontSize: fz(10), color: T.textFaint }]}>{m.kind}</Text>
                  <Text numberOfLines={2} style={[styles.desc, { fontSize: fz(11), color: unread ? T.text : T.textMuted }]}>{m.description}</Text>
                </Pressable>
                <Pressable onPress={() => dismiss(m.id)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Dismiss ${m.headline}`}>
                  <Text style={{ fontSize: fz(14), color: T.textFaint }}>×</Text>
                </Pressable>
              </View>
            );
          })}
      </Dropdown>
      {openIndex >= 0 && (
        <MessageCard
          items={items.map(x => x.m)}
          index={openIndex}
          onIndex={i => open(items[i].m.id)}
          onDismiss={id => { setOpenId(null); dismiss(id); }}
          onClose={() => setOpenId(null)}
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 48 },
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
});
