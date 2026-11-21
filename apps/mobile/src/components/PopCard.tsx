import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { useApp } from "../state/appContext";
import { FloatCard } from "./FloatCard";

// A floating card over the blurred screen with a × in its corner (the web's
// GrowCard, used by Calendar's day card and Time left's detail). The web grows
// it out of the row that was tapped; here it fades in and settles from 96%
// (FloatCard). Its colours are the web's: the page colour for the card, the
// card colour for what's inside. Tapping outside, ×, or the back gesture closes it.
export function PopCard({ onClose, label, children }: { onClose: () => void; label: string; children: ReactNode }) {
  const { T } = useApp();
  return (
    <FloatCard onClose={onClose} label={label} style={[styles.card, { backgroundColor: T.bg, borderColor: T.border, shadowOpacity: T.light ? 0.16 : 0.6 }]}>
      {close => (
        <>
          {children}
          <Pressable onPress={() => close()} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close" style={styles.close}>
            <Text style={{ fontSize: 20, lineHeight: 22, color: T.textFaint }}>×</Text>
          </Pressable>
        </>
      )}
    </FloatCard>
  );
}

const styles = StyleSheet.create({
  card: { width: "100%", maxWidth: 460, maxHeight: "80%", borderWidth: 1, borderRadius: 20, padding: 20, shadowColor: "#000", shadowOffset: { width: 0, height: 16 }, shadowRadius: 24 },
  close: { position: "absolute", top: 14, right: 14, paddingHorizontal: 4 },
});
