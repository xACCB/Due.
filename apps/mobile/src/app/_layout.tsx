import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useTheme } from "../theme/useTheme";

export default function RootLayout() {
  const T = useTheme();
  return (
    <>
      <StatusBar style={T.light ? "dark" : "light"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: T.bg } }} />
    </>
  );
}
