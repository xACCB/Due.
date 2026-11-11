import { useEffect, useRef, useState, type ReactNode } from "react";
import { Animated, LayoutAnimation, PanResponder, Pressable, StyleSheet, Switch, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { contrastColor, ink } from "@dueplanner/core/lib/format";
import type { Theme } from "../theme/types";
import { F } from "../theme/fonts";
import { useApp } from "../state/appContext";
import { readJSON } from "../lib/storage";

// Small shared pieces, styled from the theme like the web's runtime css
// (.chip, buttons, settings rows). Components only: this file exports nothing else.

export function Chip({ label, onPress, T, selected, color, accessibilityLabel }: {
  label: string; onPress: () => void; T: Theme; selected?: boolean; color?: string; accessibilityLabel?: string;
}) {
  const { fz } = useApp();
  const fg = color ? ink(color, T.light) : T.text;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [
        styles.chip,
        { borderColor: selected ? T.accent : color ?? T.border, backgroundColor: selected ? T.accent : color ? color + "22" : T.cardAlt, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={[styles.chipText, { fontSize: fz(13), color: selected ? contrastColor(T.accent) : fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Button({ label, onPress, T, kind = "primary", disabled, accessibilityLabel, style }: {
  label: string; onPress: () => void; T: Theme; kind?: "primary" | "plain" | "danger"; disabled?: boolean; accessibilityLabel?: string; style?: StyleProp<ViewStyle>;
}) {
  const { fz } = useApp();
  const bg = kind === "primary" ? T.accent : "transparent";
  const fg = kind === "primary" ? contrastColor(T.accent) : kind === "danger" ? ink("#FF4757", T.light) : T.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor: kind === "primary" ? T.accent : T.border, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
        style,
      ]}
    >
      <Text style={[styles.buttonText, { fontSize: fz(14), color: fg }]}>{label}</Text>
    </Pressable>
  );
}

// A Settings section as a dropdown (the web's SettingsSection): the header
// row toggles it and the body renders only while open. Closed when Settings
// opens, as on the web.
// `gap`: space between the open body's children, as the web section's `gap`.
export function Section({ title, T, gap = 0, children }: { title: string; T: Theme; gap?: number; children: ReactNode }) {
  const { fz, ms } = useApp();
  // Development only: the "dev-open-section" key opens one section, so a
  // screenshot can show it (see lib/devRemote.ts).
  const [open, setOpen] = useState(() => __DEV__ && readJSON<string | null>("dev-open-section", null) === title);
  return (
    <View style={[styles.sectionBody, styles.section, { backgroundColor: T.card, borderColor: T.border }]}>
      <Pressable
        onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.create(ms(200), "easeOut", "opacity")); setOpen(o => !o); }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        style={styles.sectionHead}
      >
        <Text style={[styles.sectionTitle, { fontSize: fz(10), color: T.textMuted }]}>{title.toUpperCase()}</Text>
        <Text style={{ fontSize: fz(13), color: T.textMuted, transform: [{ rotate: open ? "180deg" : "0deg" }] }}>⌄</Text>
      </Pressable>
      {open && <View style={[styles.sectionInner, { gap }]}>{children}</View>}
    </View>
  );
}

export function Row({ label, T, children, hint }: { label: string; T: Theme; children?: ReactNode; hint?: string }) {
  const { fz } = useApp();
  return (
    <View style={[styles.row, { borderBottomColor: T.border }]}>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { fontSize: fz(14), color: T.text }]}>{label}</Text>
        {!!hint && <Text style={[styles.rowHint, { fontSize: fz(11), color: T.textMuted }]}>{hint}</Text>}
      </View>
      {children}
    </View>
  );
}

export function ToggleRow({ label, value, onChange, T, hint }: { label: string; value: boolean; onChange: (v: boolean) => void; T: Theme; hint?: string }) {
  return (
    <Row label={label} T={T} hint={hint}>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} trackColor={{ true: T.light ? "#333333" : "#cccccc", false: T.border }} />
    </Row>
  );
}

// Choose one of a few options (Light/Dark/System, 12h/24h...).
export function Segmented<V extends string | number>({ options, value, onChange, T, label }: {
  options: { label: string; value: V }[]; value: V; onChange: (v: V) => void; T: Theme; label: string;
}) {
  const { fz } = useApp();
  return (
    <View style={[styles.seg, { borderColor: T.border }]} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map(o => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={o.label}
            style={[styles.segItem, { backgroundColor: on ? T.accent : "transparent" }]}
          >
            <Text style={[styles.segText, { fontSize: fz(12), color: on ? contrastColor(T.accent) : T.text }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// − value + for a whole number.
export function Stepper({ value, onChange, min, max, step = 1, T, label, unit }: {
  value: number; onChange: (v: number) => void; min: number; max: number; step?: number; T: Theme; label: string; unit?: string;
}) {
  const { fz } = useApp();
  return (
    <View style={styles.stepper}>
      <Pressable onPress={() => onChange(Math.max(min, value - step))} disabled={value <= min} hitSlop={6} accessibilityRole="button" accessibilityState={{ disabled: value <= min }} accessibilityLabel={`Less ${label}`} style={[styles.stepBtn, { borderColor: T.border, opacity: value <= min ? 0.4 : 1 }]}>
        <Text style={[styles.stepGlyph, { color: T.text }]}>−</Text>
      </Pressable>
      <Text style={[styles.stepValue, { fontSize: fz(14), color: T.text }]} accessibilityLabel={`${label}: ${value}${unit ? " " + unit : ""}`}>{value}{unit ? ` ${unit}` : ""}</Text>
      <Pressable onPress={() => onChange(Math.min(max, value + step))} disabled={value >= max} hitSlop={6} accessibilityRole="button" accessibilityState={{ disabled: value >= max }} accessibilityLabel={`More ${label}`} style={[styles.stepBtn, { borderColor: T.border, opacity: value >= max ? 0.4 : 1 }]}>
        <Text style={[styles.stepGlyph, { color: T.text }]}>+</Text>
      </Pressable>
    </View>
  );
}

// ── The web Settings' pieces (App.tsx's Settings sections) ──────────────────

// The web's Toggle: a 38x20 pill, the accent when on, the solid border colour
// when off, its knob in the contrasting colour.
export function Toggle({ on, onChange, T, label }: { on: boolean; onChange: (v: boolean) => void; T: Theme; label: string }) {
  const { ms } = useApp();
  const [x] = useState(() => new Animated.Value(on ? 1 : 0));
  useEffect(() => {
    Animated.timing(x, { toValue: on ? 1 : 0, duration: ms(200), useNativeDriver: true }).start();
  }, [on, x, ms]);
  const track = on ? T.accent : T.border; // the web's solidBorder is the border colour
  return (
    <Pressable onPress={() => onChange(!on)} hitSlop={10} accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={label}
      style={[styles.tog, { backgroundColor: track }]}>
      <Animated.View style={[styles.knob, { backgroundColor: contrastColor(track), transform: [{ translateX: x.interpolate({ inputRange: [0, 1], outputRange: [0, 18] }) }] }]} />
    </Pressable>
  );
}

// The web's .sl label: small capitals above a control.
export function Label({ children, T, right }: { children: string; T: Theme; right?: ReactNode }) {
  const { fz } = useApp();
  return (
    <View style={styles.labelRow}>
      <Text style={[styles.label, { fontSize: fz(10), color: T.textMuted }]}>{children.toUpperCase()}</Text>
      {right}
    </View>
  );
}

// A label and hint with a Toggle across from them. `caps`: the label in the
// .sl style (as Urgency Color Coding is); otherwise plain text.
export function ToggleLine({ label, hint, on, onChange, T, caps }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void; T: Theme; caps?: boolean }) {
  const { fz } = useApp();
  return (
    <View style={styles.toggleLine}>
      <View style={{ flex: 1 }}>
        {caps
          ? <Text style={[styles.label, { fontSize: fz(10), color: T.textMuted, paddingBottom: 4 }]}>{label.toUpperCase()}</Text>
          : <Text style={{ fontFamily: F.body, fontSize: fz(12), color: T.text }}>{label}</Text>}
        {!!hint && <Text style={{ fontFamily: F.body, fontSize: fz(10), color: T.textFaint, marginTop: caps ? 0 : 1 }}>{hint}</Text>}
      </View>
      <Toggle on={on} onChange={onChange} T={T} label={label} />
    </View>
  );
}

// The web's grids of choice buttons (Appearance, Time format, Focus length...):
// `columns` across, the chosen one tinted with the accent. `top`: something
// above each label (a glyph, the "Aa" sample).
export function Tiles<V extends string | number | boolean>({ options, value, onChange, T, columns, label, tall }: {
  options: { value: V; label: string; top?: (on: boolean) => ReactNode }[]; value: V; onChange: (v: V) => void; T: Theme; columns: number; label: string; tall?: boolean;
}) {
  const { fz } = useApp();
  const rows: (typeof options)[] = [];
  for (let i = 0; i < options.length; i += columns) rows.push(options.slice(i, i + columns));
  return (
    <View style={styles.tiles} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {rows.map((row, r) => (
        <View key={r} style={styles.tileRow}>
          {row.map(o => {
            const on = o.value === value;
            return (
              <Pressable key={String(o.value)} onPress={() => onChange(o.value)} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={o.label}
                style={[styles.tile, { paddingVertical: tall ? 9 : 8, backgroundColor: on ? T.accent + "22" : T.surface, borderColor: on ? T.accent : T.border }]}>
                {o.top?.(on)}
                <Text style={{ fontFamily: o.top ? F.bodyMedium : F.body, fontSize: fz(11), color: on ? T.accent : T.textMuted, textAlign: "center" }}>{o.label}</Text>
              </Pressable>
            );
          })}
          {/* keep a short last row's tiles the same width */}
          {Array.from({ length: columns - row.length }, (_, i) => <View key={`pad-${i}`} style={styles.tilePad} />)}
        </View>
      ))}
    </View>
  );
}

// The web's range input (Animation speed): an accent track and a round thumb
// that snaps to `values`. Drag or tap the track; VoiceOver swipes up or down.
export function Slider({ value, values, onChange, T, label, valueText }: {
  value: number; values: number[]; onChange: (v: number) => void; T: Theme; label: string; valueText: (v: number) => string;
}) {
  const [w, setW] = useState(0);
  const idx = Math.max(0, values.indexOf(value));
  const live = useRef({ w, values, onChange, start: 0 });
  useEffect(() => { live.current = { ...live.current, w, values, onChange }; }, [w, values, onChange]);
  const pick = (x: number) => {
    const { w: width, values: vs, onChange: set } = live.current;
    if (!width) return;
    const f = Math.min(1, Math.max(0, (x - 11) / Math.max(1, width - 22)));
    set(vs[Math.round(f * (vs.length - 1))]);
  };
  // The handlers read the refs only during a touch, never while rendering.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: e => { live.current.start = e.nativeEvent.locationX; pick(live.current.start); },
    onPanResponderMove: (_, g) => pick(live.current.start + g.dx),
  }));
  const step = (d: number) => { const i = Math.min(values.length - 1, Math.max(0, idx + d)); if (i !== idx) onChange(values[i]); };
  return (
    <View
      onLayout={e => setW(e.nativeEvent.layout.width)}
      {...pan.panHandlers}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: valueText(value) }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={e => step(e.nativeEvent.actionName === "increment" ? 1 : -1)}
      style={styles.slider}
    >
      <View pointerEvents="none" style={[styles.track, { backgroundColor: T.accent }]} />
      {w > 0 && (
        <View pointerEvents="none" style={[styles.thumb, { left: (idx / (values.length - 1)) * (w - 22), backgroundColor: T.light ? "#ffffff" : "#000000", borderColor: T.accent }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tog: { width: 38, height: 20, borderRadius: 999, justifyContent: "center", paddingHorizontal: 3 },
  knob: { width: 14, height: 14, borderRadius: 7, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } },
  labelRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 10 },
  label: { fontFamily: F.body, letterSpacing: 0.8, paddingBottom: 6 },
  toggleLine: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  tiles: { gap: 7 },
  tileRow: { flexDirection: "row", gap: 7 },
  tile: { flex: 1, borderWidth: 1.5, borderRadius: 9, paddingHorizontal: 6, alignItems: "center", justifyContent: "flex-end", gap: 2 },
  tilePad: { flex: 1 },
  slider: { height: 26, justifyContent: "center", marginTop: 2, marginBottom: 4 },
  track: { height: 4, borderRadius: 999 },
  thumb: { position: "absolute", top: 2, width: 22, height: 22, borderRadius: 11, borderWidth: 2, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontSize: 13, fontFamily: F.body },
  button: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 14, fontFamily: F.bodyMedium },
  section: { marginBottom: 8 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  sectionTitle: { fontFamily: F.body, letterSpacing: 0.8 },
  sectionInner: { paddingHorizontal: 16, paddingBottom: 16 },
  sectionBody: { borderWidth: 1, borderRadius: 12, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingHorizontal: 14, paddingVertical: 12, minHeight: 50, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1, gap: 2 },
  rowLabel: { fontSize: 14, fontFamily: F.body },
  rowHint: { fontSize: 11, fontFamily: F.body },
  seg: { flexDirection: "row", borderWidth: 1, borderRadius: 10, overflow: "hidden" },
  segItem: { paddingHorizontal: 12, paddingVertical: 7 },
  segText: { fontSize: 12, fontFamily: F.body },
  stepper: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepBtn: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  stepGlyph: { fontSize: 18, lineHeight: 20 },
  stepValue: { fontSize: 14, fontFamily: F.body, minWidth: 54, textAlign: "center" },
});
