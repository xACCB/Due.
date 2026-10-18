// Text size (Settings -> Looks; local-only). Most of the app's text was 10 to
// 12px, which people found too small. Every font size goes through fz(), which
// adds a share of itself on top, set by the --ts custom property on <html>:
// 0 is the original size ("Small"), 0.15 the default, 0.3 "Large".
//
// Small text gets the full share and large text less, down to none from 20px
// up: a 10px label needs the help, a 52px timer doesn't, and headings that
// grew as much as the labels would push the layout around.
export const TEXT_SIZES = {
  small:   { name: "Small",   extra: 0 },
  default: { name: "Default", extra: 0.15 },
  large:   { name: "Large",   extra: 0.3 },
} as const;
export type TextSize = keyof typeof TEXT_SIZES;
export const DEFAULT_TEXT_SIZE: TextSize = "default";

// A saved value that isn't one of the choices falls back to the default.
export function textSizeOf(saved: unknown): TextSize {
  return typeof saved === "string" && Object.prototype.hasOwnProperty.call(TEXT_SIZES, saved) ? (saved as TextSize) : DEFAULT_TEXT_SIZE;
}

const FULL_UP_TO = 12, NONE_FROM = 20;
// How much of the extra a size of `px` takes: all of it up to 12px, none from 20px.
export function share(px: number): number {
  if (px <= FULL_UP_TO) return 1;
  if (px >= NONE_FROM) return 0;
  return (NONE_FROM - px) / (NONE_FROM - FULL_UP_TO);
}
// The size in pixels a font of `px` is drawn at, for the given setting.
export function scaledPx(px: number, size: TextSize): number {
  return px + px * share(px) * TEXT_SIZES[size].extra;
}
// A font size for a style: the number itself where it never changes, else a
// calc() on --ts. The fallback is the default's, so text is the right size
// before the app has set the property.
export function fz(px: number): number | string {
  const grows = Math.round(px * share(px) * 100) / 100;
  return grows === 0 ? px : `calc(${px}px + ${grows}px * var(--ts, ${TEXT_SIZES[DEFAULT_TEXT_SIZE].extra}))`;
}
// Applies the setting to the page.
export function applyTextSize(size: TextSize): void {
  document.documentElement.style.setProperty("--ts", String(TEXT_SIZES[size].extra));
}
