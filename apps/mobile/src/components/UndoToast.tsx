import { useEffect } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { contrastColor } from "@dueplanner/core/lib/format";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";

const TOAST_MS = 5000; // the web's

// The web's undo toast: a pill centred 20 above the bottom, the message and a
// solid Undo, gone after five seconds. One for the whole app (useApp's
// undoToast, set with sayUndo); the root layout draws it over every screen,
// and the task sheet draws its own, since iOS puts the sheet above the rest.
export function UndoToast() {
  const { T, fz, undoToast, hideUndo, undo } = useApp();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const n = undoToast?.n;
  useEffect(() => {
    if (n == null) return;
    const t = setTimeout(hideUndo, TOAST_MS);
    return () => clearTimeout(t);
  }, [n, hideUndo]);
  if (!undoToast) return null;
  return (
    <View pointerEvents="box-none" style={[styles.wrap, { bottom: insets.bottom + 20 }]}>
      <View style={[styles.toast, { maxWidth: width - 32, backgroundColor: T.card, borderColor: T.border }]} accessibilityLiveRegion="polite" accessibilityRole="alert">
        <Text numberOfLines={1} style={[styles.text, { fontSize: fz(12), color: T.text }]}>{undoToast.text}</Text>
        <Pressable onPress={() => { undo(); hideUndo(); }} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Undo ${undoToast.text}`}
          style={({ pressed }) => [styles.btn, { backgroundColor: T.accent, opacity: pressed ? 0.8 : 1 }]}>
          <Text style={{ fontFamily: F.bodyMedium, fontSize: fz(12), color: contrastColor(T.accent) }}>Undo</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 0, right: 0, alignItems: "center" },
  toast: {
    flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 999,
    paddingVertical: 10, paddingRight: 10, paddingLeft: 16,
    shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 },
  },
  text: { fontFamily: F.body, maxWidth: 200 },
  btn: { borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14 },
});
