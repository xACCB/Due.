// ─── THEMES ─────────────────────────────────────────────────────────────────
// Strictly monochrome, per the DuePlanner brand guide (v1.0, Sep 2026): nine
// named grays (Ink/Graphite/Stone/Ash/Smoke/Fog/Mist/Paper/White), no accent
// colors. Two entries -- light and its "Inverse" (the guide's own term for
// the dark surface: Ink fill, White text) -- reusing the same nine tokens in
// opposite roles, so appearance mode (light/dark/auto) still works exactly
// as before without reintroducing per-theme color choice.
// Pure data (no JSX), split out from App.tsx so it can be imported by
// non-React contexts too -- e.g. scripts/check-theme-contrast.ts, which
// audits WCAG contrast ratios without needing to parse App.tsx.
export const THEMES = {
  dueplanner:     { light:true,  name:"DuePlanner",      emoji:"", bg:"#FFFFFF", card:"#FFFFFF", cardAlt:"#F5F5F5", border:"#E5E5E5", borderAccent:"#D4D4D4", text:"#0A0A0A", textMuted:"#525252", textFaint:"#737373", accent:"#0A0A0A", surface:"#F5F5F5" },
  dueplannerDark: { light:false, name:"DuePlanner Dark", emoji:"", bg:"#0A0A0A", card:"#262626", cardAlt:"#262626", border:"#525252", borderAccent:"#737373", text:"#FFFFFF", textMuted:"#A3A3A3", textFaint:"#737373", accent:"#FFFFFF", surface:"#262626" },
} as const;
export type ThemeName = keyof typeof THEMES;
export type ThemeObj = Omit<typeof THEMES[ThemeName], "accent"> & { accent: string; accentGlow: string; gradientCard: string };
