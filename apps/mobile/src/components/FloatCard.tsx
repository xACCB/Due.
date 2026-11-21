import { useEffect, type ReactNode } from "react";
import { Modal, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { useApp } from "../state/appContext";
import { EASE_OUT } from "../lib/motion";
import { Backdrop } from "./Backdrop";

// The shell of a card floating over the blurred screen (PopCard, MessageCard):
// the backdrop and the card come in together, 0.2s ease-out, the card settling
// from 96%, and leave the same way, a little quicker. The blur fades by its
// strength (Backdrop's `progress`): a Modal's own fade made it snap on at the
// end and off at the start. `children` gets `close(after?)`, which plays the
// way out and then calls `after` (onClose by default), as the web's cards close
// before they dismiss.
export function FloatCard({ onClose, label, style, children }: {
  onClose: () => void; label?: string; style?: StyleProp<ViewStyle>; children: (close: (after?: () => void) => void) => ReactNode;
}) {
  const { ms } = useApp();
  const reduced = useReducedMotion();
  const p = useSharedValue(reduced ? 1 : 0);
  const closing = useSharedValue(false); // a second tap on the way out does nothing
  useEffect(() => {
    if (!reduced) p.set(withTiming(1, { duration: ms(200), easing: EASE_OUT }));
  }, [p, ms, reduced]);
  const close = (after: () => void = onClose) => {
    if (closing.get()) return;
    closing.set(true);
    if (reduced) { after(); return; }
    p.set(withTiming(0, { duration: ms(150), easing: EASE_OUT }, finished => { "worklet"; if (finished) scheduleOnRN(after); }));
  };
  const cardStyle = useAnimatedStyle(() => ({ opacity: p.get(), transform: [{ scale: 0.96 + 0.04 * p.get() }] }));
  return (
    <Modal visible transparent animationType="none" onRequestClose={() => close()} statusBarTranslucent>
      <View style={styles.wrap} accessibilityViewIsModal>
        <Backdrop kind="card" onPress={() => close()} progress={p} />
        <Animated.View accessibilityLabel={label} style={[style, cardStyle]}>
          {children(close)}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
});
