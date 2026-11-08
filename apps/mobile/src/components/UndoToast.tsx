import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Theme } from "../theme/types";
import { F } from "../theme/fonts";

const TOAST_MS = 5000; // the web's

// "Completed · Undo", above the tab bar, gone after a few seconds. `n` changes
// with every new message, so a repeat of the same text restarts the timer.
export function UndoToast({ text, n, T, onUndo, onHide }: { text: string; n: number; T: Theme; onUndo: () => void; onHide: () => void }) {
  const insets = useSafeAreaInsets();
  useEffect(() => {
    const t = setTimeout(onHide, TOAST_MS);
    return () => clearTimeout(t);
  }, [n, onHide]);
  return (
    <View style={[styles.toast, { bottom: insets.bottom + 70, backgroundColor: T.cardAlt, borderColor: T.borderAccent }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
      <Text style={[styles.text, { color: T.text }]}>{text}</Text>
      <Pressable onPress={onUndo} hitSlop={12} accessibilityRole="button" accessibilityLabel={`Undo ${text}`}>
        <Text style={[styles.btn, { color: T.accent }]}>Undo</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: { position: "absolute", left: 16, right: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  text: { fontSize: 13, fontFamily: F.body },
  btn: { fontSize: 13, fontFamily: F.bodyMedium },
});
