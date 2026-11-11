import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SymbolView } from "expo-symbols";
import { formatDate } from "@dueplanner/core/lib/format";
import { localDateStr } from "@dueplanner/core/lib/dates";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";
import { ScreenTitle } from "../components/ScreenTitle";

// History (the web's History screen): undo and redo, and Recently deleted
// (kept 30 days) with Restore and Empty.
export default function History() {
  const app = useApp();
  const { T, fz } = app;
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const trash = [...app.trash].sort((a, b) => b.deletedAt - a.deletedAt);

  const stepBtn = (label: "Undo" | "Redo", enabled: boolean, what: string | null, onPress: () => void) => (
    <Pressable onPress={onPress} disabled={!enabled} accessibilityRole="button" accessibilityState={{ disabled: !enabled }}
      accessibilityLabel={enabled ? `${label}: ${what}` : `Nothing to ${label.toLowerCase()}`}
      style={({ pressed }) => [styles.step, { backgroundColor: T.cardAlt, borderColor: T.border, opacity: !enabled ? 0.4 : pressed ? 0.7 : 1 }]}>
      {label === "Undo" && <SymbolView name={{ ios: "arrow.uturn.backward", android: "undo" }} size={14} tintColor={T.text} />}
      <Text style={[styles.stepText, { fontSize: fz(12), color: T.text }]}>{label}</Text>
      {label === "Redo" && <SymbolView name={{ ios: "arrow.uturn.forward", android: "redo" }} size={14} tintColor={T.text} />}
    </Pressable>
  );

  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={styles.body}>
      <ScreenTitle title="History" />
      <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
        <View style={styles.steps}>
          {stepBtn("Undo", app.canUndo, app.undoLabel, app.undo)}
          {stepBtn("Redo", app.canRedo, app.redoLabel, app.redo)}
        </View>
        <Text style={[styles.hint, { fontSize: fz(10), color: T.textFaint }]}>
          {app.undoLabel ? `Undo: ${app.undoLabel}` : "Nothing to undo"}{app.redoLabel ? `   ·   Redo: ${app.redoLabel}` : ""}
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: T.card, borderColor: T.border }]}>
        <View style={styles.trashHead}>
          <Text style={[styles.kicker, { fontSize: fz(11), color: T.textMuted }]} accessibilityRole="header">RECENTLY DELETED{trash.length ? ` (${trash.length})` : ""}</Text>
          {trash.length > 0 && (
            <Pressable
              onPress={() => { if (confirmEmpty) { app.emptyTrash(); setConfirmEmpty(false); } else setConfirmEmpty(true); }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityHint={confirmEmpty ? "Tap again to delete these for good" : "Delete everything here for good"}
              style={[styles.empty, confirmEmpty && { backgroundColor: "#FF475722" }]}
            >
              <Text style={{ fontFamily: F.body, fontSize: fz(11), color: confirmEmpty ? "#FF4757" : T.textFaint }}>{confirmEmpty ? "Delete for good?" : "Empty"}</Text>
            </Pressable>
          )}
        </View>
        {trash.length === 0
          ? <Text style={[styles.none, { fontSize: fz(11), color: T.textFaint }]}>Nothing here. Deleted tasks stay for 30 days.</Text>
          : trash.map(e => (
            <View key={e.task.id} style={[styles.trashRow, { backgroundColor: T.surface }]}>
              <View style={styles.trashText}>
                <Text numberOfLines={1} style={{ fontFamily: F.body, fontSize: fz(12), color: T.text }}>{e.task.title}</Text>
                <Text style={{ fontFamily: F.body, fontSize: fz(10), color: T.textFaint }}>Deleted {formatDate(localDateStr(new Date(e.deletedAt)))}</Text>
              </View>
              <Pressable onPress={() => app.restore(e.task.id)} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Restore ${e.task.title}`}
                style={({ pressed }) => [styles.restore, { borderColor: T.border, opacity: pressed ? 0.6 : 1 }]}>
                <Text style={{ fontFamily: F.body, fontSize: fz(11), color: T.text }}>Restore</Text>
              </Pressable>
            </View>
          ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 48, gap: 8 },
  card: { borderWidth: 1, borderRadius: 12, padding: 14 },
  steps: { flexDirection: "row", gap: 8 },
  step: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderRadius: 9, paddingVertical: 9 },
  stepText: { fontFamily: F.body },
  hint: { fontFamily: F.body, marginTop: 8 },
  trashHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  kicker: { fontFamily: F.body, letterSpacing: 0.7 },
  empty: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  none: { fontFamily: F.body },
  trashRow: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 8, marginBottom: 4 },
  trashText: { flex: 1, minWidth: 0 },
  restore: { borderWidth: 1, borderRadius: 7, paddingHorizontal: 10, paddingVertical: 4 },
});
