import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

// A progress ring (the web's Pomodoro SVG ring) from plain views: each half of
// the circle is a clipped half-ring rotated into view, the right half first.
// `pct` 0..1, filled clockwise from the top. `children` sit in the middle.
export function Ring({ pct, size, stroke, color, track, children }: { pct: number; size: number; stroke: number; color: string; track: string; children?: ReactNode }) {
  const p = Math.max(0, Math.min(1, pct));
  const half = size / 2;
  const ring = { width: size, height: size, borderRadius: half, borderWidth: stroke, borderColor: color };
  const right = Math.min(p, 0.5) * 360; // 0..180
  const left = Math.max(0, p - 0.5) * 360; // 0..180
  return (
    <View style={{ width: size, height: size }}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: half, borderWidth: stroke, borderColor: track }]} />
      {/* Right half: a left half-ring turned clockwise into the right side. */}
      <View style={{ position: "absolute", left: half, top: 0, width: half, height: size, overflow: "hidden" }}>
        <View style={{ position: "absolute", left: -half, top: 0, width: size, height: size, transform: [{ rotate: `${right}deg` }] }}>
          <View style={{ position: "absolute", left: 0, top: 0, width: half, height: size, overflow: "hidden" }}>
            {p > 0 && <View style={ring} />}
          </View>
        </View>
      </View>
      {/* Left half, past 50%: a right half-ring turned into the left side. */}
      <View style={{ position: "absolute", left: 0, top: 0, width: half, height: size, overflow: "hidden" }}>
        <View style={{ position: "absolute", left: 0, top: 0, width: size, height: size, transform: [{ rotate: `${left}deg` }] }}>
          <View style={{ position: "absolute", left: half, top: 0, width: half, height: size, overflow: "hidden" }}>
            {p > 0.5 && <View style={[ring, { marginLeft: -half }]} />}
          </View>
        </View>
      </View>
      <View style={[StyleSheet.absoluteFill, { alignItems: "center", justifyContent: "center" }]}>{children}</View>
    </View>
  );
}
