// Per-weight imports: the package roots would bundle every weight (8 files).
import { DMSerifDisplay_400Regular } from "@expo-google-fonts/dm-serif-display/400Regular";
import { DMMono_400Regular } from "@expo-google-fonts/dm-mono/400Regular";
import { DMMono_500Medium } from "@expo-google-fonts/dm-mono/500Medium";

// The web app's one pairing (core's FONT): DM Serif Display for headings,
// DM Mono for everything else. Loaded in _layout.tsx while the launch screen
// is up. With a custom family, iOS ignores fontWeight, so a heavier weight is
// its own family (bodyMedium), never `fontWeight` on `body`.
export const FONT_FILES = { DMSerifDisplay_400Regular, DMMono_400Regular, DMMono_500Medium };

export const F = {
  heading: "DMSerifDisplay_400Regular",
  body: "DMMono_400Regular",
  bodyMedium: "DMMono_500Medium",
} as const;
