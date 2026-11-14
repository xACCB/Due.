import { Pressable, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import { useApp } from "../state/appContext";

// The web's blurred backdrop behind a floating card or Search: the page
// blurred, then a wash of the background colour over it. "card" is the web's
// GrowCard/UpdateDetail (14px, 55% light / 50% dark); "search" its
// SearchOverlay (18px, 80% / 74%). A tap on it calls `onPress` (closes).
export function Backdrop({ kind, onPress, label = "Close" }: { kind: "card" | "search"; onPress: () => void; label?: string }) {
  const { T } = useApp();
  const wash = kind === "search"
    ? (T.light ? "rgba(245,245,245,0.8)" : "rgba(0,0,0,0.74)")
    : (T.light ? "rgba(245,245,245,0.55)" : "rgba(0,0,0,0.5)");
  return (
    <>
      <BlurView style={StyleSheet.absoluteFill} intensity={kind === "search" ? 45 : 35} tint={T.light ? "light" : "dark"} />
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: wash }]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} />
    </>
  );
}
