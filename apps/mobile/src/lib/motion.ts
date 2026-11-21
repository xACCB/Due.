// The web's motion standard (CLAUDE.md, "Motion standard"): 0.2s, ease-out, a
// few pixels of travel, no overshoot. Pass durations through useApp().ms so
// they follow Animation speed. Reanimated's entering animations follow the
// phone's Reduce Motion setting on their own.
import { Easing, FadeIn, FadeInDown } from "react-native-reanimated";

export const EASE_OUT = Easing.bezier(0, 0, 0.58, 1); // CSS ease-out

// .fade-in: opacity only (the undo toast, the timer pill).
export const fadeIn = (ms: number) => FadeIn.duration(ms).easing(EASE_OUT);

// .sec-body: settles from 4px above (dropdowns, panels).
export const settleIn = (ms: number) =>
  FadeInDown.duration(ms).easing(EASE_OUT).withInitialValues({ opacity: 0, transform: [{ translateY: -4 }] });
