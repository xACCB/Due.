import { useState, type ReactNode } from "react";
import { ActionSheetIOS, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { SymbolView } from "expo-symbols";
import { localDateStr } from "@dueplanner/core/lib/dates";
import { contrastColor, formatTime } from "@dueplanner/core/lib/format";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";

// The web's form fields as iPhone Safari draws them on the task page: a label
// in small capitals over a rounded box (T.surface, 1px border, radius 8). Text
// in the boxes is 16px, as the web sets for touch screens (.edit-field), so it
// reads the same. A dropdown opens the phone's own menu, a date or time field
// opens the system picker in a card.

export function FieldLabel({ children }: { children: string }) {
  const { T, fz } = useApp();
  return <Text style={[styles.label, { fontSize: fz(10), color: T.textMuted }]}>{children.toUpperCase()}</Text>;
}

function Box({ onPress, disabled, a11y, children }: { onPress: () => void; disabled?: boolean; a11y: string; children: ReactNode }) {
  const { T } = useApp();
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.box, { backgroundColor: T.surface, borderColor: T.border, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}>
      {children}
    </Pressable>
  );
}

// A web <select>: the chosen option's label, with Safari's up/down chevron.
export function SelectField<V extends string>({ label, value, options, onChange }: { label: string; value: V; options: { value: V; label: string }[]; onChange: (v: V) => void }) {
  const { T } = useApp();
  const [open, setOpen] = useState(false); // the list, where there's no system menu (Android)
  const shown = options.find(o => o.value === value)?.label ?? "";
  const pick = () => {
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions(
        { title: label, options: [...options.map(o => o.label), "Cancel"], cancelButtonIndex: options.length, userInterfaceStyle: T.light ? "light" : "dark" },
        i => { if (i < options.length) onChange(options[i].value); },
      );
    } else setOpen(o => !o);
  };
  return (
    <View>
      <FieldLabel>{label}</FieldLabel>
      <Box onPress={pick} a11y={`${label}: ${shown}`}>
        <Text numberOfLines={1} style={[styles.value, { color: T.text, flex: 1 }]}>{shown}</Text>
        <SymbolView name={{ ios: "chevron.up.chevron.down", android: "unfold_more" }} size={13} tintColor={T.text} />
      </Box>
      {open && (
        <View style={[styles.list, { backgroundColor: T.card, borderColor: T.border }]}>
          {options.map(o => (
            <Pressable key={o.value} onPress={() => { setOpen(false); onChange(o.value); }} accessibilityRole="button" accessibilityState={{ selected: o.value === value }}
              style={({ pressed }) => [styles.option, { backgroundColor: o.value === value ? T.cardAlt : pressed ? T.surface : "transparent" }]}>
              <Text style={[styles.value, { color: T.text }]}>{o.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const two = (n: number) => String(n).padStart(2, "0");
// Safari's way of showing a date input's value: "Nov 14, 2026".
const safariDate = (v: string) => new Date(v + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// A web <input type="date"> or <input type="time"> holding the web's text
// ("YYYY-MM-DD", "HH:MM", "" for none). A tap opens the system picker in a card;
// each change saves at once, as the web does on the page.
// `bare`: no label above it (the add card, where the question is the label).
export function DateField({ mode, label, value, onChange, disabled, bare }: { mode: "date" | "time"; label: string; value: string; onChange: (v: string) => void; disabled?: boolean; bare?: boolean }) {
  const { T, h24, fz } = useApp();
  const [open, setOpen] = useState(false);
  const shown = !value ? "" : mode === "date" ? safariDate(value) : formatTime(value, h24);
  const current = !value ? (mode === "date" ? new Date() : new Date(2000, 0, 1, 9, 0))
    : mode === "date" ? new Date(value + "T00:00:00") : new Date(`2000-01-01T${value}:00`);
  const toText = (d: Date) => (mode === "date" ? localDateStr(d) : `${two(d.getHours())}:${two(d.getMinutes())}`);
  return (
    <View>
      {!bare && <FieldLabel>{label}</FieldLabel>}
      <Box onPress={() => setOpen(true)} disabled={disabled} a11y={`${label}: ${shown || "none"}`}>
        <Text numberOfLines={1} style={[styles.value, { color: T.text, flex: 1 }]}>{shown}</Text>
      </Box>
      {open && Platform.OS !== "ios" && (
        <DateTimePicker value={current} mode={mode} is24Hour={h24}
          onValueChange={(_e, d) => { setOpen(false); onChange(toText(d)); }} onDismiss={() => setOpen(false)} />
      )}
      {open && Platform.OS === "ios" && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={styles.wrap} accessibilityViewIsModal>
            <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: "rgba(0,0,0,0.45)" }]} onPress={() => setOpen(false)} accessibilityLabel="Close" />
            <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
              <DateTimePicker value={current} mode={mode} display={mode === "date" ? "inline" : "spinner"}
                onValueChange={(_e, d) => { onChange(toText(d)); if (mode === "date") setOpen(false); }}
                themeVariant={T.light ? "light" : "dark"} accentColor={T.light ? "#000000" : "#ffffff"}
                minuteInterval={mode === "time" ? 5 : undefined} locale={mode === "time" ? (h24 ? "en_GB" : "en_US") : undefined} />
              <Pressable onPress={() => setOpen(false)} accessibilityRole="button" style={[styles.done, { backgroundColor: T.accent }]}>
                <Text style={{ fontFamily: F.body, fontSize: fz(13), color: contrastColor(T.accent) }}>Done</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

// A web text <input> in the same box (the estimate fields).
export function TextField({ label, ...input }: { label: string } & TextInputProps) {
  const { T } = useApp();
  return (
    <View style={{ flex: 1 }}>
      <FieldLabel>{label}</FieldLabel>
      <TextInput {...input} accessibilityLabel={label} placeholderTextColor={T.textFaint}
        style={[styles.box, styles.value, { backgroundColor: T.surface, borderColor: T.border, color: T.text }]} />
    </View>
  );
}

// The underlined links under the date and time ("No due date").
export function ClearLink({ label, onPress }: { label: string; onPress: () => void }) {
  const { T, fz } = useApp();
  return (
    <Pressable onPress={onPress} hitSlop={{ top: 4, bottom: 8, left: 4, right: 8 }} accessibilityRole="button" style={{ alignSelf: "flex-start", paddingTop: 6 }}>
      <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.textMuted, textDecorationLine: "underline" }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  label: { fontFamily: F.body, letterSpacing: 0.8, marginBottom: 4 },
  box: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, minHeight: 42 },
  value: { fontFamily: F.body, fontSize: 16 },
  list: { marginTop: 4, borderWidth: 1, borderRadius: 8, overflow: "hidden" },
  option: { paddingVertical: 10, paddingHorizontal: 10 },
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 16 },
  card: { width: "100%", maxWidth: 380, borderWidth: 1, borderRadius: 16, padding: 12, alignItems: "stretch" },
  done: { marginTop: 8, borderRadius: 9, paddingVertical: 10, alignItems: "center" },
});
