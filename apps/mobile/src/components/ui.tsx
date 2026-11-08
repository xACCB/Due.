import type { ReactNode } from "react";
import { Pressable, StyleSheet, Switch, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { contrastColor, ink } from "@dueplanner/core/lib/format";
import type { Theme } from "../theme/types";
import { F } from "../theme/fonts";

// Small shared pieces, styled from the theme like the web's runtime css
// (.chip, buttons, settings rows). Components only: this file exports nothing else.

export function Chip({ label, onPress, T, selected, color, accessibilityLabel }: {
  label: string; onPress: () => void; T: Theme; selected?: boolean; color?: string; accessibilityLabel?: string;
}) {
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
      <Text style={[styles.chipText, { color: selected ? contrastColor(T.accent) : fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Button({ label, onPress, T, kind = "primary", disabled, accessibilityLabel, style }: {
  label: string; onPress: () => void; T: Theme; kind?: "primary" | "plain" | "danger"; disabled?: boolean; accessibilityLabel?: string; style?: StyleProp<ViewStyle>;
}) {
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
      <Text style={[styles.buttonText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

export function Section({ title, T, children }: { title: string; T: Theme; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: T.textMuted }]} accessibilityRole="header">{title.toUpperCase()}</Text>
      <View style={[styles.sectionBody, { backgroundColor: T.card, borderColor: T.border }]}>{children}</View>
    </View>
  );
}

export function Row({ label, T, children, hint }: { label: string; T: Theme; children?: ReactNode; hint?: string }) {
  return (
    <View style={[styles.row, { borderBottomColor: T.border }]}>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, { color: T.text }]}>{label}</Text>
        {!!hint && <Text style={[styles.rowHint, { color: T.textMuted }]}>{hint}</Text>}
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
            <Text style={[styles.segText, { color: on ? contrastColor(T.accent) : T.text }]}>{o.label}</Text>
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
  return (
    <View style={styles.stepper}>
      <Pressable onPress={() => onChange(Math.max(min, value - step))} disabled={value <= min} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Less ${label}`} style={[styles.stepBtn, { borderColor: T.border, opacity: value <= min ? 0.4 : 1 }]}>
        <Text style={[styles.stepGlyph, { color: T.text }]}>−</Text>
      </Pressable>
      <Text style={[styles.stepValue, { color: T.text }]} accessibilityLabel={`${label}: ${value}${unit ? " " + unit : ""}`}>{value}{unit ? ` ${unit}` : ""}</Text>
      <Pressable onPress={() => onChange(Math.min(max, value + step))} disabled={value >= max} hitSlop={6} accessibilityRole="button" accessibilityLabel={`More ${label}`} style={[styles.stepBtn, { borderColor: T.border, opacity: value >= max ? 0.4 : 1 }]}>
        <Text style={[styles.stepGlyph, { color: T.text }]}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipText: { fontSize: 13, fontFamily: F.body },
  button: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, alignItems: "center", justifyContent: "center" },
  buttonText: { fontSize: 14, fontFamily: F.bodyMedium },
  section: { marginBottom: 22 },
  sectionTitle: { fontSize: 11, fontFamily: F.body, letterSpacing: 1, marginBottom: 8, marginLeft: 4 },
  sectionBody: { borderWidth: 1, borderRadius: 14, overflow: "hidden" },
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
