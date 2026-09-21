// ─── THEMES ─────────────────────────────────────────────────────────────────
// Tesla app-inspired: their brand red (#E31937) as the one accent, and their
// dark navy-black text color (#171A20) instead of pure black -- both
// well-documented Tesla brand values, not guessed. bg is a very slightly
// softened white (#FAFAFA, not pure #FFFFFF) since pure white next to pure
// black previously read as too harsh/glaring. Reintroduces real gray steps
// (unlike the prior truly-black-and-white attempt) since a card-based app
// UI needs actual shade differences to show depth without drop shadows.
// Pure data (no JSX), split out from App.tsx so it can be imported by
// non-React contexts too -- e.g. scripts/check-theme-contrast.ts, which
// audits WCAG contrast ratios without needing to parse App.tsx.
export const THEMES = {
  tesla:     { light:true,  name:"Tesla",      emoji:"", bg:"#FAFAFA", card:"#FFFFFF", cardAlt:"#F5F5F5", border:"#E0E0E0", borderAccent:"#CCCCCC", text:"#171A20", textMuted:"#5C5E62", textFaint:"#A3A3A3", accent:"#E31937", surface:"#F5F5F5" },
  teslaDark: { light:false, name:"Tesla Dark", emoji:"", bg:"#171A20", card:"#21242B", cardAlt:"#292C33", border:"#393C43", borderAccent:"#4A4D54", text:"#FFFFFF", textMuted:"#A3A6AB", textFaint:"#6C6F75", accent:"#E31937", surface:"#21242B" },
} as const;
export type ThemeName = keyof typeof THEMES;
export type ThemeObj = Omit<typeof THEMES[ThemeName], "accent"> & { accent: string; accentGlow: string; gradientCard: string };
