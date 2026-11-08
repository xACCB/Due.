import { useEffect, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { filterTasks, sortTasks } from "@dueplanner/core/lib/taskViews";
import { LIMITS } from "@dueplanner/core/lib/limits";
import { contrastColor } from "@dueplanner/core/lib/format";
import { useTheme } from "../theme/useTheme";
import { F } from "../theme/fonts";
import { useTasks } from "../state/useTasks";
import { TaskRow } from "../components/TaskRow";

const TOAST_MS = 4000;

// Home: the task list (open tasks in manual order, then finished ones), an add
// field, and undo/redo. Everything a task action does comes from core.
export default function Home() {
  const T = useTheme();
  const insets = useSafeAreaInsets();
  const s = useTasks();
  const [draft, setDraft] = useState("");
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  const say = (text: string) => setToast(prev => ({ text, n: (prev?.n ?? 0) + 1 }));
  const list = filterTasks(sortTasks(s.tasks, []), { filter: "all", subject: null, showDone: true, justDone: [] });
  const open = s.tasks.filter(t => !t.done && !t.archived).length;

  const submit = () => {
    if (!draft.trim()) return;
    s.add(draft);
    setDraft("");
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: T.bg }]} edges={["top", "left", "right"]}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <View>
            <Text style={[styles.h1, { color: T.accent }]} accessibilityRole="header">Home</Text>
            <Text style={[styles.sub, { color: T.textMuted }]}>{open === 1 ? "1 task open" : `${open} tasks open`}</Text>
          </View>
          <View style={styles.headerBtns}>
            <HeaderBtn label="Undo" disabled={!s.canUndo} T={T} onPress={() => { s.undo(); setToast(null); }} />
            <HeaderBtn label="Redo" disabled={!s.canRedo} T={T} onPress={() => { s.redo(); setToast(null); }} />
          </View>
        </View>

        <FlatList
          data={list}
          keyExtractor={t => String(t.id)}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <TaskRow
              task={item}
              T={T}
              onToggle={() => { s.toggle(item.id); say(item.done ? "Marked not done" : "Completed"); }}
              onDelete={() => { s.remove(item.id); say("Deleted"); }}
            />
          )}
        />

        {toast && (
          <View style={[styles.toast, { backgroundColor: T.cardAlt, borderColor: T.borderAccent }]} accessibilityLiveRegion="polite">
            <Text style={[styles.toastText, { color: T.text }]}>{toast.text}</Text>
            <Pressable onPress={() => { s.undo(); setToast(null); }} hitSlop={10} accessibilityRole="button" accessibilityLabel="Undo">
              <Text style={[styles.toastBtn, { color: T.accent }]}>Undo</Text>
            </Pressable>
          </View>
        )}

        <View style={[styles.addBar, { paddingBottom: Math.max(12, insets.bottom), borderTopColor: T.border, backgroundColor: T.surface }]}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={submit}
            submitBehavior="submit"
            placeholder="Add homework..."
            placeholderTextColor={T.textMuted}
            maxLength={LIMITS.title}
            returnKeyType="done"
            accessibilityLabel="New task title"
            style={[styles.input, { color: T.text, backgroundColor: T.card, borderColor: T.border }]}
          />
          <Pressable
            onPress={submit}
            disabled={!draft.trim()}
            accessibilityRole="button"
            accessibilityLabel="Add task"
            style={[styles.addBtn, { backgroundColor: T.accent, opacity: draft.trim() ? 1 : 0.4 }]}
          >
            <Text style={[styles.addBtnText, { color: contrastColor(T.accent) }]}>Add</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function HeaderBtn({ label, disabled, onPress, T }: { label: string; disabled: boolean; onPress: () => void; T: ReturnType<typeof useTheme> }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={8} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}>
      <Text style={[styles.headerBtn, { color: disabled ? T.textFaint : T.text }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12 },
  h1: { fontSize: 34, fontFamily: F.heading },
  sub: { fontSize: 12, marginTop: 2, fontFamily: F.body },
  headerBtns: { flexDirection: "row", gap: 18, paddingBottom: 4 },
  headerBtn: { fontSize: 14, fontFamily: F.body },
  list: { paddingHorizontal: 16, paddingBottom: 16 },
  toast: { position: "absolute", left: 16, right: 16, bottom: 84, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12 },
  toastText: { fontSize: 13, fontFamily: F.body },
  toastBtn: { fontSize: 13, fontFamily: F.bodyMedium },
  addBar: { flexDirection: "row", gap: 10, padding: 12, borderTopWidth: 1 },
  input: { flex: 1, fontSize: 16, fontFamily: F.body, borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10 },
  addBtn: { borderRadius: 10, paddingHorizontal: 18, justifyContent: "center" },
  addBtnText: { fontSize: 14, fontFamily: F.bodyMedium },
});
