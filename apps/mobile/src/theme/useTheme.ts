import { useColorScheme } from "react-native";
import { THEMES } from "@dueplanner/core/themes";

// Same two themes as the web app, picked the way its "System" setting does.
// A light/dark/system choice of its own comes with Settings (M4).
export function useTheme() {
  return useColorScheme() === "light" ? THEMES.stealthLight : THEMES.stealth;
}
