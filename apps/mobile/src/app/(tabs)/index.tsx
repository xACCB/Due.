import { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { filterTasks, sortTasks } from "@dueplanner/core/lib/taskViews";
import { contrastColor } from "@dueplanner/core/lib/format";
import { useApp } from "../../state/appContext";
import { F } from "../../theme/fonts";
import type { Theme } from "../../theme/types";
import { TaskRow } from "../../components/TaskRow";
import { Chip } from "../../components/ui";
import { AddSheet } from "../../components/AddSheet";
import { UndoToast } from "../../components/UndoToast";

// The web's filter chips (taskViews' filterTasks).
const FILTERS = [{ key: "all", label: "All" }, { key: "pending", label: "Pending" }, { key: "done", label: "Done" }, { key: "archived", label: "Archived" }];

// Home: the task list (open tasks in manual order, then finished ones), the
// filter chips, adding, and undo/redo. What each action does comes from core.
export default function Home() {
  const app = useApp();
  const { T, h24 } = app;
  const { showDone, colorCodeUrgency, subjectColors } = app.settings;
  const [filter, setFilter] = useState("all");
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const hideToast = useCallback(() => setToast(null), []);

  const say = (text: string) => setToast(prev => ({ text, n: (prev?.n ?? 0) + 1 }));
  const list = filterTasks(sortTasks(app.tasks, []), { filter, subject: null, showDone, justDone: [] });
  const open = app.tasks.filter(t => !t.done && !t.archived).length;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: T.bg }]} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <View>
          <Text style={[styles.h1, { color: T.accent }]} accessibilityRole="header">Home</Text>
          <Text style={[styles.sub, { color: T.textMuted }]}>{open === 1 ? "1 task open" : `${open} tasks open`}</Text>
        </View>
        <View style={styles.headerBtns}>
          <HeaderLink T={T} label="Undo" disabled={!app.canUndo} onPress={() => { app.undo(); hideToast(); }} />
          <HeaderLink T={T} label="Redo" disabled={!app.canRedo} onPress={() => { app.redo(); hideToast(); }} />
        </View>
      </View>

      <View style={styles.filters}>
        {FILTERS.map(f => <Chip key={f.key} label={f.label} T={T} selected={filter === f.key} onPress={() => setFilter(f.key)} />)}
      </View>

      <FlatList
        data={list}
        keyExtractor={t => String(t.id)}
        contentContainerStyle={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={
          <Pressable onPress={() => setAdding(true)} accessibilityRole="button" accessibilityLabel="Add homework" style={({ pressed }) => [styles.addBtn, { backgroundColor: T.accent, opacity: pressed ? 0.8 : 1 }]}>
            <Text style={[styles.addText, { color: contrastColor(T.accent) }]}>+ Add homework</Text>
          </Pressable>
        }
        renderItem={({ item }) => (
          <TaskRow
            task={item}
            T={T}
            h24={h24}
            colorCode={colorCodeUrgency}
            subjectColor={subjectColors[item.subject]}
            onOpen={() => router.push(`/task/${item.id}`)}
            onToggle={() => {
              app.toggle(item.id);
              if (!item.done) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
              say(item.done ? "Marked not done" : "Completed");
            }}
            onDelete={() => { app.remove(item.id); say("Deleted"); }}
          />
        )}
      />

      {toast && <UndoToast text={toast.text} n={toast.n} T={T} onHide={hideToast} onUndo={() => { app.undo(); hideToast(); }} />}
      <AddSheet visible={adding} onClose={() => setAdding(false)} />
    </SafeAreaView>
  );
}

function HeaderLink({ label, disabled, onPress, T }: { label: string; disabled: boolean; onPress: () => void; T: Theme }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={10} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}>
      <Text style={[styles.headerBtn, { color: disabled ? T.textFaint : T.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12 },
  h1: { fontSize: 34, fontFamily: F.heading },
  sub: { fontSize: 12, marginTop: 2, fontFamily: F.body },
  headerBtns: { flexDirection: "row", gap: 18, paddingBottom: 6 },
  headerBtn: { fontSize: 14, fontFamily: F.body },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingBottom: 12 },
  list: { paddingHorizontal: 16, paddingBottom: 140 },
  addBtn: { borderRadius: 12, paddingVertical: 13, alignItems: "center", marginBottom: 12 },
  addText: { fontSize: 14, fontFamily: F.bodyMedium },
});
