import { useRef, type ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import ReanimatedSwipeable, { SwipeDirection, type SwipeableMethods } from "react-native-gesture-handler/ReanimatedSwipeable";
import { ink } from "@dueplanner/core/lib/format";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";

const DONE_GREEN = "#2ED573";
const DELETE_RED = "#FF4757";
// The web's SWIPE_THRESHOLD: past this, letting go acts.
const SWIPE_AT = 64;

// A task card's swipe, as in every web layout: right marks it done (or not
// done), left deletes it, with the web's tinted reveal and label behind.
export function Swipe({ done, radius, gap = 0, onToggle, onDelete, children }: {
  done: boolean; radius: number; gap?: number; onToggle: () => void; onDelete: () => void; children: ReactNode;
}) {
  const { T, fz } = useApp();
  const swipe = useRef<SwipeableMethods>(null);
  const reveal = (right: boolean) => (
    <View style={[styles.reveal, { backgroundColor: (right ? DONE_GREEN : DELETE_RED) + "33", justifyContent: right ? "flex-start" : "flex-end" }]}>
      <Text style={[styles.text, { fontSize: fz(13), color: ink(right ? DONE_GREEN : DELETE_RED, T.light) }]}>
        {right ? (done ? "↩ Mark not done" : "✓ Mark done") : "Delete"}
      </Text>
    </View>
  );
  return (
    <ReanimatedSwipeable
      ref={swipe}
      friction={1}
      leftThreshold={SWIPE_AT}
      rightThreshold={SWIPE_AT}
      overshootLeft={false}
      overshootRight={false}
      renderLeftActions={() => reveal(true)}
      renderRightActions={() => reveal(false)}
      onSwipeableOpen={dir => {
        swipe.current?.reset();
        if (dir === SwipeDirection.RIGHT) onToggle(); else onDelete();
      }}
      containerStyle={{ borderRadius: radius, marginBottom: gap }}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create({
  reveal: { flex: 1, flexDirection: "row", alignItems: "center", paddingHorizontal: 20, width: 200 },
  text: { fontFamily: F.bodyMedium },
});
