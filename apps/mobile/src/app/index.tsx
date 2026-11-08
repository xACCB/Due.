import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { todayISO } from "@dueplanner/core/lib/dates";
import { longDate } from "@dueplanner/core/lib/format";
import { WHATS_NEW } from "@dueplanner/core/whatsNew";
import { useTheme } from "../theme/useTheme";

// Placeholder Home screen (M2 replaces it with the task list). Everything on
// it comes from @dueplanner/core, which proves the shared package loads here.
export default function Home() {
  const T = useTheme();
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: T.bg }]}>
      <View style={styles.body}>
        <Text style={[styles.title, { color: T.accent }]}>DuePlanner</Text>
        <Text style={[styles.line, { color: T.text }]}>{longDate(todayISO())}</Text>
        <Text style={[styles.small, { color: T.textMuted }]}>
          Shared code loaded: {WHATS_NEW.length} updates in the feed.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10, padding: 24 },
  title: { fontSize: 34, fontWeight: "600" },
  line: { fontSize: 16 },
  small: { fontSize: 13, textAlign: "center" },
});
