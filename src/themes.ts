// ─── THEMES ─────────────────────────────────────────────────────────────────
// Down to exactly two -- Stealth (dark) and Stealth Light (its per-channel
// RGB inversion) -- with every other look removed. Since there's now exactly
// one theme per light/dark category, `themeName` in App.tsx is a plain
// derived const rather than independent state; see the comment there.
// Pure data (no JSX), split out from App.tsx so it can be imported by
// non-React contexts too -- e.g. scripts/check-theme-contrast.mjs, which
// audits every theme's WCAG contrast ratios without needing to parse App.tsx.
export const THEMES = {
  stealth:     { light:false, name:"Stealth",     bg:"#0a0a0a", card:"#111111", cardAlt:"#1a1a1a", border:"#222222", borderAccent:"#2a2a2a", text:"#cccccc", textMuted:"#7c7c7c", textFaint:"#606060", accent:"#ffffff", surface:"#0f0f0f" },
  stealthLight:{ light:true,  name:"Stealth Light", bg:"#f5f5f5", card:"#eeeeee", cardAlt:"#e5e5e5", border:"#dddddd", borderAccent:"#d5d5d5", text:"#333333", textMuted:"#6a6a6a", textFaint:"#888888", accent:"#000000", surface:"#f0f0f0" },
} as const;
export type ThemeName = keyof typeof THEMES;
// The surface tokens are widened to plain strings because App.tsx swaps them
// for translucent rgba() "liquid glass" values at runtime when that setting is
// on; solidBorder keeps the original opaque hex border for the few places that
// need a real hex (e.g. contrastColor(), which parses one), and borderFaint is
// a lighter divider that works in either mode (a hex+alpha suffix can't be
// appended to an rgba() value).
type GlassTokens = "accent"|"card"|"cardAlt"|"surface"|"border"|"borderAccent";
export type ThemeObj = Omit<typeof THEMES[ThemeName], GlassTokens> & { accent: string; card: string; cardAlt: string; surface: string; border: string; borderAccent: string; solidBorder: string; borderFaint: string; accentGlow: string; gradientCard: string };
