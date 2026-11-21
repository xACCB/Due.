import { Pressable, StyleSheet } from "react-native";
import { BlurView } from "expo-blur";
import Animated, { useAnimatedProps, useAnimatedStyle, useSharedValue, type SharedValue } from "react-native-reanimated";
import { useApp } from "../state/appContext";

const AnimatedBlur = Animated.createAnimatedComponent(BlurView);

// The web's blurred backdrop behind a floating card or Search: the page
// blurred, then a wash of the background colour over it. "card" is the web's
// GrowCard/UpdateDetail (14px, 55% light / 50% dark); "search" its
// SearchOverlay (18px, 80% / 74%). A tap on it calls `onPress` (closes).
// `progress` (0 to 1) fades it in or out: the blur by its strength, since iOS
// drops a blur that is itself partly transparent and it would snap on at the end.
export function Backdrop({ kind, onPress, label = "Close", progress }: { kind: "card" | "search"; onPress: () => void; label?: string; progress?: SharedValue<number> }) {
  const { T } = useApp();
  const full = useSharedValue(1);
  const p = progress ?? full;
  const max = kind === "search" ? 45 : 35;
  const blurProps = useAnimatedProps(() => ({ intensity: max * p.get() }));
  const washStyle = useAnimatedStyle(() => ({ opacity: p.get() }));
  const wash = kind === "search"
    ? (T.light ? "rgba(245,245,245,0.8)" : "rgba(0,0,0,0.74)")
    : (T.light ? "rgba(245,245,245,0.55)" : "rgba(0,0,0,0.5)");
  return (
    <>
      <AnimatedBlur style={StyleSheet.absoluteFill} animatedProps={blurProps} tint={T.light ? "light" : "dark"} />
      <Animated.View style={[StyleSheet.absoluteFill, washStyle]}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: wash }]} onPress={onPress} accessibilityRole="button" accessibilityLabel={label} />
      </Animated.View>
    </>
  );
}
