import { useEffect, useState } from "react";
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { WhatsNewItem } from "@dueplanner/core/whatsNew";
import { contrastColor, longDate } from "@dueplanner/core/lib/format";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";

// An Inbox message opened in full (the web's UpdateDetail): its kind, headline,
// date, text and the tasks it lists, with ‹ Back and Next › stepping through
// the messages in place (the text fades in, no slide, as on the web), "2 of 3",
// and Dismiss. Over a dimmed screen (the web blurs it; that needs a native
// package the phone app doesn't have yet).
export function MessageCard({ items, index, onIndex, onDismiss, onClose }: {
  items: WhatsNewItem[]; index: number; onIndex: (i: number) => void; onDismiss: (id: string) => void; onClose: () => void;
}) {
  const { T, fz, ms } = useApp();
  const item = items[index];
  const [fade] = useState(() => new Animated.Value(1));
  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: ms(200), useNativeDriver: true }).start();
  }, [index, fade, ms]);
  if (!item) return null;
  const btn = (label: string, a11y: string, onPress: () => void, disabled = false) => (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ disabled }}
      style={[styles.btn, { borderColor: T.border, opacity: disabled ? 0.4 : 1 }]}>
      <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.textMuted }}>{label}</Text>
    </Pressable>
  );
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.wrap} accessibilityViewIsModal>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: T.light ? "rgba(245,245,245,0.86)" : "rgba(0,0,0,0.72)" }]} onPress={onClose} accessibilityLabel="Close" />
        <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border, shadowOpacity: T.light ? 0.16 : 0.6 }]}>
          <ScrollView contentContainerStyle={styles.body} bounces={false}>
            <Animated.View style={{ opacity: fade, gap: 14 }}>
              <View style={styles.top}>
                <Text style={[styles.kind, { fontSize: fz(10), color: T.textMuted, backgroundColor: T.cardAlt, borderColor: T.border }]}>{item.kind.toUpperCase()}</Text>
                <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
                  <Text style={{ fontSize: 20, lineHeight: 22, color: T.textFaint, paddingHorizontal: 4 }}>×</Text>
                </Pressable>
              </View>
              <View>
                <Text style={[styles.headline, { color: T.text }]} accessibilityRole="header">{item.headline}</Text>
                <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textMuted, marginTop: 6 }}>{longDate(item.date)}</Text>
              </View>
              <Text style={{ fontFamily: F.body, fontSize: fz(13), lineHeight: Math.round(fz(13) * 1.6), color: T.text }}>{item.description}</Text>
              {!!item.list?.length && (
                <View style={[styles.box, { backgroundColor: T.surface, borderColor: T.border }]}>
                  <Text style={[styles.boxLabel, { fontSize: fz(10), color: T.textMuted }]}>FINISHED</Text>
                  {item.list.map((t, i) => (
                    <Text key={i} style={{ fontFamily: F.body, fontSize: fz(12), lineHeight: Math.round(fz(12) * 1.6), color: T.text }}>•  {t}</Text>
                  ))}
                </View>
              )}
            </Animated.View>
            <View style={styles.nav}>
              {btn("‹ Back", "Back to the previous message", () => onIndex(index - 1), index === 0)}
              {btn("Next ›", "Next message", () => onIndex(index + 1), index === items.length - 1)}
              <Text style={[styles.count, { fontSize: fz(10), color: T.textFaint }]} accessibilityLiveRegion="polite">{index + 1} of {items.length}</Text>
              <Pressable onPress={() => onDismiss(item.id)} accessibilityRole="button" accessibilityLabel={`Dismiss ${item.headline}`} style={[styles.btn, { backgroundColor: T.accent, borderColor: T.accent }]}>
                <Text style={{ fontFamily: F.body, fontSize: fz(12), color: contrastColor(T.accent) }}>Dismiss</Text>
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  card: { width: "100%", maxWidth: 460, maxHeight: "100%", borderWidth: 1, borderRadius: 16, overflow: "hidden", shadowColor: "#000", shadowOffset: { width: 0, height: 16 }, shadowRadius: 24 },
  body: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, gap: 14 },
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  kind: { fontFamily: F.body, letterSpacing: 0.6, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, overflow: "hidden" },
  headline: { fontFamily: F.heading, fontSize: 26, lineHeight: 30 },
  box: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  boxLabel: { fontFamily: F.body, letterSpacing: 0.6, marginBottom: 4 },
  nav: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 4 },
  btn: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 9 },
  count: { flex: 1, textAlign: "center", fontFamily: F.body },
});
