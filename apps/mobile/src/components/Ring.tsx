import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Circle, Svg } from "react-native-svg";

// The web's Pomodoro ring, drawn the same way: a track circle and a progress
// circle of radius 45 on a 100 grid, the progress a 283-long dash with round
// ends, offset by what's used up, turned so it starts at the top. `pct` 0..1
// is how much of the ring shows. `children` sit in the middle.
export function Ring({ pct, size, stroke, color, track, children }: { pct: number; size: number; stroke: number; color: string; track: string; children?: ReactNode }) {
  const p = Math.max(0, Math.min(1, pct));
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} viewBox="0 0 100 100" style={{ transform: [{ rotate: "-90deg" }] }}>
        <Circle cx="50" cy="50" r="45" fill="none" stroke={track} strokeWidth={stroke} />
        {p > 0 && <Circle cx="50" cy="50" r="45" fill="none" stroke={color} strokeWidth={stroke} strokeDasharray="283" strokeDashoffset={283 * (1 - p)} strokeLinecap="round" />}
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.middle]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  middle: { alignItems: "center", justifyContent: "center" },
});
