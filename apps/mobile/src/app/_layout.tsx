import { useEffect } from "react";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import * as SplashScreen from "expo-splash-screen";
import { useTheme } from "../theme/useTheme";
import { FONT_FILES } from "../theme/fonts";

// The launch screen (app.json: the dp mark on black, like the web's #splash)
// stays up until the fonts are ready, so text never shows in a fallback font.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const T = useTheme();
  const [loaded, error] = useFonts(FONT_FILES);
  const ready = loaded || !!error; // a font that fails to load mustn't keep the app hidden

  useEffect(() => { if (ready) SplashScreen.hideAsync(); }, [ready]);

  if (!ready) return null;
  return (
    <>
      <StatusBar style={T.light ? "dark" : "light"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: T.bg } }} />
    </>
  );
}
