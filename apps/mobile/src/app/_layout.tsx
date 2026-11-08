import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { AppProvider } from "../state/AppState";
import { useApp } from "../state/appContext";
import { FONT_FILES, F } from "../theme/fonts";

// The launch screen (app.json: the dp mark on black, like the web's #splash)
// stays up until the fonts are ready, so text never shows in a fallback font.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [loaded, error] = useFonts(FONT_FILES);
  const ready = loaded || !!error; // a font that fails to load mustn't keep the app hidden

  useEffect(() => { if (ready) SplashScreen.hideAsync(); }, [ready]);

  if (!ready) return null;
  return (
    <AppProvider>
      <Screens />
    </AppProvider>
  );
}

// The tabs, with the task page pushed over them.
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
      </Stack>
    </>
  );
}
