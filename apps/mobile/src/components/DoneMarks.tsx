import { useEffect, useState, type ReactNode } from "react";
import { Animated, Easing, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { useApp } from "../state/appContext";

// The web's completion marks (MiniCard's CheckMark and .strike in styles.ts).
// With `animate` (a task just ticked, in Home's justDone hold) the check circle
// pops from 70% (.25s), the ✓ draws in left to right (.36s after .07s) and a
// line draws across every line of the title (.42s after .19s), all eased
// cubic-bezier(.65,0,.35,1) and scaled by Animation speed. Without it they're
// simply there. Drawn with plain views: the ✓ is revealed by a widening mask,
// and the strike lines come from the title's own line boxes (onTextLayout), so
// a wrapped title gets one per line, like the web's box-decoration-break.

const EASE = Easing.bezier(0.65, 0, 0.35, 1);

// 0 -> 1 when `on` turns true and `animate` is set; straight to its end otherwise.
function useDraw(on: boolean, animate: boolean, delay: number, duration: number, native: boolean): Animated.Value {
  const { ms } = useApp();
  const [v] = useState(() => new Animated.Value(on && !animate ? 1 : 0));
  useEffect(() => {
    if (!on) { v.setValue(0); return; }
    if (!animate) { v.setValue(1); return; }
    v.setValue(0);
    const a = Animated.timing(v, { toValue: 1, delay: ms(delay), duration: ms(duration), easing: EASE, useNativeDriver: native });
    a.start();
    return () => a.stop();
  }, [on, animate, v, ms, delay, duration, native]);
  return v;
}

// The circle's pop (wrap the check in it).
export function CheckPop({ animate, style, children }: { animate: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const { ms } = useApp();
  const [s] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!animate) return;
    s.setValue(0.7);
    const a = Animated.timing(s, { toValue: 1, duration: ms(250), easing: Easing.out(Easing.quad), useNativeDriver: true });
    a.start();
    return () => a.stop();
  }, [animate, s, ms]);
  return <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>;
}

// The ✓ inside a done check: `size` the space inside the circle, `font` the
// glyph's size (as the check drew it before).
export function CheckGlyph({ size, font, animate, color = "#111" }: { size: number; font: number; animate: boolean; color?: string }) {
  const p = useDraw(true, animate, 70, 360, false);
  return (
    // A fixed box so the mask grows from its left edge (the circle centres
    // whatever is inside it).
    <View style={{ width: size, alignItems: "flex-start" }}>
      <Animated.View style={{ width: p.interpolate({ inputRange: [0, 1], outputRange: [0, size] }), overflow: "hidden" }}>
        <View style={{ width: size, alignItems: "center" }}>
          <Text style={{ color, fontSize: font, lineHeight: Math.round(font * 1.2), fontWeight: "700" }}>✓</Text>
        </View>
      </Animated.View>
    </View>
  );
}

type Line = { x: number; y: number; width: number; height: number };

// A task title that's struck through when `done` (in the text's own colour).
export function StrikeText({ done, animate, color, style, numberOfLines, children }: {
  done: boolean; animate: boolean; color: string; style: StyleProp<TextStyle>; numberOfLines?: number; children: ReactNode;
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const p = useDraw(done, animate, 190, 420, true);
  return (
    <View style={{ flexShrink: 1 }}>
      <Text
        numberOfLines={numberOfLines}
        onTextLayout={e => setLines(e.nativeEvent.lines.map(l => ({ x: l.x, y: l.y, width: l.width, height: l.height })))}
        style={[style, { textDecorationLine: "none" }]}
      >
        {children}
      </Text>
      {done && lines.map((l, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={{ position: "absolute", left: l.x, top: Math.round(l.y + l.height * 0.55), width: l.width, height: 1.5, backgroundColor: color, transformOrigin: "0% 50%", transform: [{ scaleX: p }] }}
        />
      ))}
    </View>
  );
}
