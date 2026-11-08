// The web's side of text size: the sizes and arithmetic live in core
// (lib/textSize.ts, shared with the phone app); this adds the CSS: fz() for a
// style's font size, and applyTextSize() to set --ts on <html>.
import { DEFAULT_TEXT_SIZE, TEXT_SIZES, share } from "@dueplanner/core/lib/textSize";
import type { TextSize } from "@dueplanner/core/lib/textSize";
export { DEFAULT_TEXT_SIZE, TEXT_SIZES, scaledPx, share, textSizeOf } from "@dueplanner/core/lib/textSize";
export type { TextSize } from "@dueplanner/core/lib/textSize";

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
