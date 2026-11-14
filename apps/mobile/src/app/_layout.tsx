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
import { SidebarHost } from "../components/Sidebar";

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

// The main screens ((tabs), switched in place), the task page over them
// (fading in, with the web's header and "‹ Home"), the task sheet, and Search
// over the current screen. The sidebar drawer wraps all of it.
function Screens() {
  const { T } = useApp();
  return (
    <>
      <StatusBar style={T.light ? "dark" : "light"} />
      <SidebarHost>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: T.bg } }}>
          <Stack.Screen name="(tabs)" />
          {/* No swipe back: a swipe in from the left edge opens the sidebar, as on the web. */}
          <Stack.Screen name="task/[id]" options={{ animation: "fade", animationDuration: 200, gestureEnabled: false }} />
          {/* The web's task sheet: slides up over the screen, pulled down to close. */}
          <Stack.Screen name="task-sheet/[id]" options={{ presentation: "modal", contentStyle: { backgroundColor: T.bg } }} />
          <Stack.Screen name="search" options={{ presentation: "transparentModal", animation: "fade", contentStyle: { backgroundColor: "transparent" } }} />
        </Stack>
      </SidebarHost>
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
