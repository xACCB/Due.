import { StyleSheet, Text } from "react-native";
import { useApp } from "../state/appContext";
import { F } from "../theme/fonts";

// A pushed screen's name (the web's header shows SCREEN_TITLES the same way:
// DM Serif Display, 26px). The system back button sits above it.
export function ScreenTitle({ title }: { title: string }) {
  const { T } = useApp();
  return <Text style={[styles.h1, { color: T.text }]} accessibilityRole="header">{title}</Text>;
}

const styles = StyleSheet.create({
  h1: { fontFamily: F.heading, fontSize: 26, lineHeight: 30, marginBottom: 10 },
});
