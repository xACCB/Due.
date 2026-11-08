import { useState, type ReactNode } from "react";
import { LayoutAnimation, Pressable, StyleSheet, Switch, Text, View, type StyleProp, type ViewStyle } from "react-native";
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
export function Section({ title, T, children }: { title: string; T: Theme; children: ReactNode }) {
  const { fz } = useApp();
  // Development only: the "dev-open-section" key opens one section, so a
  // screenshot can show it (see lib/devRemote.ts).
  const [open, setOpen] = useState(() => __DEV__ && readJSON<string | null>("dev-open-section", null) === title);
  return (
    <View style={[styles.sectionBody, styles.section, { backgroundColor: T.card, borderColor: T.border }]}>
      <Pressable
        onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.create(200, "easeOut", "opacity")); setOpen(o => !o); }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        style={styles.sectionHead}
      >
        <Text style={[styles.sectionTitle, { fontSize: fz(10), color: T.textMuted }]}>{title.toUpperCase()}</Text>
        <Text style={{ fontSize: fz(13), color: T.textMuted, transform: [{ rotate: open ? "180deg" : "0deg" }] }}>⌄</Text>
      </Pressable>
      {open && <View style={[styles.sectionInner, { borderTopColor: T.border }]}>{children}</View>}
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
      <Pressable onPress={() => onChange(Math.max(min, value - step))} disabled={value <= min} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Less ${label}`} style={[styles.stepBtn, { borderColor: T.border, opacity: value <= min ? 0.4 : 1 }]}>
        <Text style={[styles.stepGlyph, { color: T.text }]}>−</Text>
      </Pressable>
      <Text style={[styles.stepValue, { fontSize: fz(14), color: T.text }]} accessibilityLabel={`${label}: ${value}${unit ? " " + unit : ""}`}>{value}{unit ? ` ${unit}` : ""}</Text>
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
  section: { marginBottom: 8 },
  sectionHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  sectionTitle: { fontFamily: F.body, letterSpacing: 0.8 },
  sectionInner: { borderTopWidth: StyleSheet.hairlineWidth },
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
