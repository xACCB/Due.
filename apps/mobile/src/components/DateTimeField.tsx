import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { localDateStr } from "@dueplanner/core/lib/dates";
import { formatDate, formatTime } from "@dueplanner/core/lib/format";
import type { Theme } from "../theme/types";
import { F } from "../theme/fonts";

// A due date ("YYYY-MM-DD") or due time ("HH:MM") picker, using the system's
// own: on iOS drawn in place (`display`), on Android a dialog opened by a tap.
// The value is the same text the web app stores; "" means none.

type Mode = "date" | "time";

const two = (n: number) => String(n).padStart(2, "0");

function toDate(mode: Mode, value: string, fallback: Date): Date {
  if (!value) return fallback;
  const d = mode === "date" ? new Date(value + "T00:00:00") : new Date(`2000-01-01T${value}:00`);
  return Number.isNaN(d.getTime()) ? fallback : d;
}
const fromDate = (mode: Mode, d: Date) => (mode === "date" ? localDateStr(d) : `${two(d.getHours())}:${two(d.getMinutes())}`);

export function DateTimeField({ mode, value, onChange, T, label, h24, display = "compact", fallback }: {
  mode: Mode; value: string; onChange: (v: string) => void; T: Theme; label: string; h24: boolean;
  display?: "compact" | "inline" | "spinner";
  // What the picker shows while there's no value (defaults to now / 9:00 AM).
  fallback?: Date;
}) {
  const [open, setOpen] = useState(false);
  const start = fallback ?? (mode === "time" ? new Date(2000, 0, 1, 9, 0) : new Date());
  const current = toDate(mode, value, start);

  if (Platform.OS === "ios") {
    return (
      <View accessibilityLabel={label}>
        <DateTimePicker
          value={current}
          mode={mode}
          display={display}
          onValueChange={(_e, d) => onChange(fromDate(mode, d))}
          themeVariant={T.light ? "light" : "dark"}
          accentColor={T.light ? "#000000" : "#ffffff"}
          minuteInterval={mode === "time" ? 5 : undefined}
          // Only the time picker follows 12h/24h; dates keep the phone's own order.
          locale={mode === "time" ? (h24 ? "en_GB" : "en_US") : undefined}
        />
      </View>
    );
  }

  const shown = value ? (mode === "date" ? formatDate(value) : formatTime(value, h24)) : mode === "date" ? "Pick a date" : "Pick a time";
  return (
    <View>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel={`${label}: ${shown}`} style={[styles.btn, { borderColor: T.border, backgroundColor: T.cardAlt }]}>
        <Text style={[styles.btnText, { color: value ? T.text : T.textMuted }]}>{shown}</Text>
      </Pressable>
      {open && (
        <DateTimePicker
          value={current}
          mode={mode}
          is24Hour={h24}
          onValueChange={(_e, d) => { setOpen(false); onChange(fromDate(mode, d)); }}
          onDismiss={() => setOpen(false)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  btn: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9 },
  btnText: { fontSize: 14, fontFamily: F.body },
});
