import type { THEMES } from "@dueplanner/core/themes";

// One of the two themes (core's THEMES). Which one is active comes from
// useApp().T, following the Light/Dark/System setting.
export type Theme = (typeof THEMES)[keyof typeof THEMES];
