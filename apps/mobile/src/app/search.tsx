import { useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { SymbolView } from "expo-symbols";
import type { Task } from "@dueplanner/core/types";
import { searchTasks } from "@dueplanner/core/lib/taskViews";
import { daysUntil, getPriority, ink } from "@dueplanner/core/lib/format";
import { priColor } from "@dueplanner/core/constants";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";

// Search (the web's SearchOverlay): a title, subject or tag; archived tasks
// left out, open ones first, 50 at most (core's searchTasks). Return opens
// the first result; tapping one opens its task page.
export default function Search() {
  const app = useApp();
  const { T, fz } = app;
  const { subjectColors, colorCodeUrgency } = app.settings;
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const results = searchTasks(app.tasks, q);
  const open = (t: Task) => router.replace(`/task/${t.id}`);

  const highlight = (title: string) => {
    const at = q ? title.toLowerCase().indexOf(q) : -1;
    if (at < 0) return title;
    return (
      <>
        {title.slice(0, at)}
        <Text style={{ backgroundColor: T.light ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.18)" }}>{title.slice(at, at + q.length)}</Text>
        {title.slice(at + q.length)}
      </>
    );
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: T.light ? "rgba(245,245,245,0.97)" : "rgba(0,0,0,0.94)" }]} edges={["top", "left", "right"]}>
      <View style={[styles.bar, { backgroundColor: T.card, borderColor: T.border }]}>
        <SymbolView name={{ ios: "magnifyingglass", android: "search" }} size={16} tintColor={T.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          autoFocus
          placeholder="Search tasks..."
          placeholderTextColor={T.textFaint}
          accessibilityLabel="Search tasks"
          returnKeyType="search"
          autoCorrect={false}
          onSubmitEditing={() => { if (results[0]) open(results[0]); }}
          style={[styles.input, { color: T.text, fontSize: fz(16) }]}
        />
        <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Cancel">
          <Text style={[styles.cancel, { fontSize: fz(11), color: T.textMuted }]}>Cancel</Text>
        </Pressable>
      </View>
      <FlatList
        data={results}
        keyExtractor={t => String(t.id)}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        contentContainerStyle={styles.list}
        renderItem={({ item: t }) => {
          const pr = getPriority(t.dueDate, t.estMins, t.priorityOverride);
          const sc = subjectColors[t.subject] || T.accent;
          return (
            <Pressable onPress={() => open(t)} accessibilityRole="button" accessibilityLabel={`${t.title}${t.done ? ", done" : ""}${t.subject ? `, ${t.subject}` : ""}`}
              style={({ pressed }) => [styles.row, { backgroundColor: pressed ? T.cardAlt : T.card, borderColor: T.border }]}>
              <View style={[styles.dot, { backgroundColor: t.done ? T.textFaint : priColor(pr, colorCodeUrgency) }]} />
              <Text numberOfLines={1} style={[styles.title, { fontSize: fz(14), color: t.done ? T.textFaint : T.text, textDecorationLine: t.done ? "line-through" : "none" }]}>{highlight(t.title)}</Text>
              {!!t.subject && <Text style={[styles.pill, { fontSize: fz(10), backgroundColor: sc + "22", color: ink(sc, T.light) }]}>{t.subject}</Text>}
              {!t.done && !!t.dueDate && <Text style={[styles.due, { fontSize: fz(10), color: ink(priColor(pr, colorCodeUrgency), T.light) }]}>{daysUntil(t.dueDate)}</Text>}
            </Pressable>
          );
        }}
        ListFooterComponent={
          <Text style={[styles.note, { fontSize: fz(11), color: T.textMuted }]} accessibilityLiveRegion="polite">
            {!q ? "Type a title, subject or tag" : results.length === 0 ? `No tasks match "${query.trim()}"` : `${results.length} ${results.length === 1 ? "task" : "tasks"} found`}
          </Text>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  bar: { flexDirection: "row", alignItems: "center", gap: 9, height: 54, borderWidth: 1, borderRadius: 12, paddingLeft: 15, paddingRight: 8, marginTop: 24 },
  input: { flex: 1, fontFamily: F.body, paddingVertical: 9 },
  cancel: { fontFamily: F.body, padding: 6 },
  list: { paddingTop: 10, gap: 6, paddingBottom: 40 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: 10, paddingVertical: 11, paddingHorizontal: 13 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  title: { flex: 1, fontFamily: F.heading },
  pill: { fontFamily: F.body, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: "hidden" },
  due: { fontFamily: F.body },
  note: { textAlign: "center", fontFamily: F.body, paddingVertical: 6 },
});
