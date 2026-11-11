import { useEffect } from "react";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { AppProvider } from "../state/AppState";
import { useApp } from "../state/appContext";
import { FONT_FILES, F } from "../theme/fonts";
import { startDevRemote } from "../lib/devRemote";

// The launch screen (app.json: the dp mark on black, like the web's #splash)
// stays up until the fonts are ready, so text never shows in a fallback font.
SplashScreen.preventAutoHideAsync();

// Anything that throws while rendering lands here instead of a blank screen
// (the web's app-wide ErrorBoundary, in its fixed dark colours, since the
// theme lives inside what failed). Reload renders the app again.
export function ErrorBoundary({ retry, error }: ErrorBoundaryProps) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <View style={styles.crash}>
      <Text style={[styles.crashTitle, { fontFamily: F.body }]}>Something went wrong.</Text>
      <Text style={[styles.crashText, { fontFamily: F.body }]}>Your data is safe. Reloading should fix it.</Text>
      <Pressable onPress={() => { retry().catch(() => {}); }} accessibilityRole="button" style={styles.crashBtn}>
        <Text style={[styles.crashBtnText, { fontFamily: F.body }]}>Reload</Text>
      </Pressable>
    </View>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts(FONT_FILES);
  const ready = loaded || !!error; // a font that fails to load mustn't keep the app hidden

  useEffect(() => { if (ready) SplashScreen.hideAsync(); }, [ready]);
  useEffect(() => (__DEV__ ? startDevRemote() : undefined), []);

  if (!ready) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppProvider>
        <Screens />
      </AppProvider>
    </GestureHandlerRootView>
  );
}

// The tabs, with the task page and the menu's screens pushed over them (back
// reads "Home", like the web's "‹ Home"), and the menu, Search and Time left
// as sheets over the current screen.
function Screens() {
  const { T } = useApp();
  return (
    <>
      <StatusBar style={T.light ? "dark" : "light"} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: T.bg },
          headerStyle: { backgroundColor: T.bg },
          headerTintColor: T.accent,
          headerTitleStyle: { fontFamily: F.body, color: T.text },
          headerShadowVisible: false,
        }}
      >
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="task/[id]" options={{ headerShown: true, title: "Task", headerBackTitle: "Back" }} />
        <Stack.Screen name="inbox" options={{ headerShown: true, title: "", headerBackTitle: "Home" }} />
        <Stack.Screen name="history" options={{ headerShown: true, title: "", headerBackTitle: "Home" }} />
        <Stack.Screen name="import" options={{ headerShown: true, title: "", headerBackTitle: "Home" }} />
        <Stack.Screen name="menu" options={{ presentation: "formSheet", sheetGrabberVisible: true, sheetAllowedDetents: [0.8, 1], contentStyle: { backgroundColor: T.bg } }} />
        <Stack.Screen name="time-left" options={{ presentation: "formSheet", sheetGrabberVisible: true, sheetAllowedDetents: [0.6, 1], contentStyle: { backgroundColor: T.bg } }} />
        <Stack.Screen name="search" options={{ presentation: "transparentModal", animation: "fade" }} />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  crash: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24, backgroundColor: "#0a0a0a" },
  crashTitle: { fontSize: 18, color: "#cccccc", textAlign: "center" },
  crashText: { fontSize: 13, color: "#7c7c7c", textAlign: "center" },
  crashBtn: { backgroundColor: "#ffffff", borderRadius: 10, paddingVertical: 10, paddingHorizontal: 20 },
  crashBtnText: { fontSize: 14, color: "#000000" },
});
