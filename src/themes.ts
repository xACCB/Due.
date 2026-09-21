// ─── THEMES ─────────────────────────────────────────────────────────────────
// Notion-themed: colors taken from Notion's actual documented palette (warm
// off-black/off-white, not the app's earlier stark monochrome pure white/black
// grays), not guessed. Light mode's text (#37352F), secondary text (#787774),
// tertiary text (#9B9A97), sidebar/card surface (#F7F6F3), and accent
// ("Notion Blue" #2EAADC) are Notion's own values. Dark mode's page background
// (#191919), panel/hover (#202020), menu/popover (#252525), body text
// (#F0EFED), and secondary text (#ADA9A3) are likewise Notion's current dark
// theme; border/borderAccent/accentGlow shades for dark mode aren't
// individually documented anywhere, so those are interpolated to fit the same
// hierarchy.
// Pure data (no JSX), split out from App.tsx so it can be imported by
// non-React contexts too -- e.g. scripts/check-theme-contrast.ts, which
// audits WCAG contrast ratios without needing to parse App.tsx.
export const THEMES = {
  notion:     { light:true,  name:"Notion",      emoji:"", bg:"#FFFFFF", card:"#F7F6F3", cardAlt:"#EFEEEB", border:"#E9E9E7", borderAccent:"#DEDDDA", text:"#37352F", textMuted:"#787774", textFaint:"#9B9A97", accent:"#2EAADC", surface:"#F7F6F3" },
  notionDark: { light:false, name:"Notion Dark", emoji:"", bg:"#191919", card:"#202020", cardAlt:"#252525", border:"#2F2F2F", borderAccent:"#3F3F3F", text:"#F0EFED", textMuted:"#ADA9A3", textFaint:"#6F6E69", accent:"#2EAADC", surface:"#202020" },
} as const;
export type ThemeName = keyof typeof THEMES;
export type ThemeObj = Omit<typeof THEMES[ThemeName], "accent"> & { accent: string; accentGlow: string; gradientCard: string };
