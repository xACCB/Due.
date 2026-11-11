import { useEffect, useState, type ReactNode } from "react";
import { Animated, Easing, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useApp } from "../state/appContext";

// A floating card over the dimmed screen with a × in its corner (the web's
// GrowCard, used by Calendar's day card and Time left's detail). The web grows
// it out of the row that was tapped; here it fades in and settles from 96%.
// Tapping outside, ×, or the back gesture closes it.
export function PopCard({ onClose, label, children }: { onClose: () => void; label: string; children: ReactNode }) {
  const { T, ms } = useApp();
  const [s] = useState(() => new Animated.Value(0.96));
  useEffect(() => {
    Animated.timing(s, { toValue: 1, duration: ms(200), easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [s, ms]);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.wrap} accessibilityViewIsModal>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: T.light ? "rgba(245,245,245,0.86)" : "rgba(0,0,0,0.72)" }]} onPress={onClose} accessibilityLabel="Close" />
        <Animated.View accessibilityLabel={label} style={[styles.card, { backgroundColor: T.card, borderColor: T.border, shadowOpacity: T.light ? 0.16 : 0.6, transform: [{ scale: s }] }]}>
          {children}
          <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
            <Text style={{ fontSize: 20, lineHeight: 22, color: T.textFaint }}>×</Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  card: { width: "100%", maxWidth: 460, maxHeight: "80%", borderWidth: 1, borderRadius: 16, padding: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 16 }, shadowRadius: 24 },
  close: { position: "absolute", top: 14, right: 14, paddingHorizontal: 4 },
});
