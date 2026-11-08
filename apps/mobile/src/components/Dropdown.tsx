import { useState, type ReactNode } from "react";
import { LayoutAnimation, Pressable, StyleSheet, Text, View } from "react-native";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";

// A section as a dropdown (the web's SettingsSection, used by its Inbox and
// Import/Export): the header row toggles it, and the body is only rendered
// while open. Starts closed, and isn't remembered, as on the web.
export function Dropdown({ title, children, gap = 0 }: { title: string; children: ReactNode; gap?: number }) {
  const { T, fz } = useApp();
  const [open, setOpen] = useState(false);
  return (
    <View style={[styles.box, { backgroundColor: T.card, borderColor: T.border }]}>
      <Pressable
        onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.create(200, "easeOut", "opacity")); setOpen(o => !o); }}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={title}
        style={styles.head}
      >
        <Text style={[styles.title, { fontSize: fz(10), color: T.textMuted }]}>{title.toUpperCase()}</Text>
        <Text style={{ fontSize: fz(13), color: T.textMuted, transform: [{ rotate: open ? "180deg" : "0deg" }] }}>⌄</Text>
      </Pressable>
      {open && <View style={[styles.body, { gap }]}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 12 },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 16 },
  title: { fontFamily: F.body, letterSpacing: 0.8 },
  body: { paddingHorizontal: 16, paddingBottom: 16 },
});
