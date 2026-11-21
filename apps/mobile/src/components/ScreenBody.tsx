// A main screen's content below its header, entering as the web's .sec-body
// does: 0.2s ease-out, from 4px above and transparent. The header stays still,
// as the web's does, so only the content changes when switching screens.
// Plays each time the screen is switched to (lib/selectedTab.ts), not when a
// sheet or Search closes over it. `enter="mount"` plays it once when the
// screen opens (Profile, the task page: whole pages as on the web), and
// `enter={false}` not at all (the task sheet, which slides up instead).
// Reduced motion shows it at once.
import { useEffect, type ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useRoute } from "expo-router";
import { useApp } from "../state/appContext";
import { EASE_OUT } from "../lib/motion";
import { useSelectedTab } from "../lib/selectedTab";

export function ScreenBody({ children, style, enter = "tab" }: { children: ReactNode; style?: StyleProp<ViewStyle>; enter?: "tab" | "mount" | false }) {
  const { ms } = useApp();
  const name = useRoute().name;
  const selected = useSelectedTab() === name;
  const shown = enter === "tab" ? selected : true;
  const reduced = useReducedMotion() || enter === false;
  const p = useSharedValue(enter === false ? 1 : 0);
  useEffect(() => {
    // Hidden screens wait at the start, so the next switch has nothing to undo.
    if (!shown) p.set(0);
    else p.set(reduced ? 1 : withTiming(1, { duration: ms(200), easing: EASE_OUT }));
  }, [shown, reduced, ms, p]);
  const anim = useAnimatedStyle(() => ({ opacity: p.get(), transform: [{ translateY: (1 - p.get()) * -4 }] }));
  return <Animated.View style={[{ flex: 1 }, style, anim]}>{children}</Animated.View>;
}
