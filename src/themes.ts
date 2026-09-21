// ─── THEMES ─────────────────────────────────────────────────────────────────
// Truly black and white -- every field is literally #000000 or #FFFFFF, no
// gray of any kind (not even a lighter/darker step for borders or muted
// text). That means text hierarchy (textMuted/textFaint) has no color signal
// left at all -- size/weight/opacity in individual components are the only
// remaining way to de-emphasize something, matching the "state without
// colour" principle the brand guide itself argued for, just taken further
// than the guide's own nine-gray palette did. cardAlt == card == bg
// deliberately (not an inverse fill): it's used in several places as a plain
// chip/skeleton background paired with `color:T.text` (e.g. the subject and
// date/time quick-pick chips in the add-task flow) -- an inverted fill there
// would render text in the same color as its own background. The tradeoff is
// the loading-skeleton shimmer and the "gradientCard" highlight background
// both lose their visible effect (nothing to gradient between), leaving the
// border as the only remaining distinction for those.
// Pure data (no JSX), split out from App.tsx so it can be imported by
// non-React contexts too -- e.g. scripts/check-theme-contrast.ts, which
// audits WCAG contrast ratios without needing to parse App.tsx.
export const THEMES = {
  bw:     { light:true,  name:"Black & White",      emoji:"", bg:"#FFFFFF", card:"#FFFFFF", cardAlt:"#FFFFFF", border:"#000000", borderAccent:"#000000", text:"#000000", textMuted:"#000000", textFaint:"#000000", accent:"#000000", surface:"#FFFFFF" },
  bwDark: { light:false, name:"Black & White Dark", emoji:"", bg:"#000000", card:"#000000", cardAlt:"#000000", border:"#FFFFFF", borderAccent:"#FFFFFF", text:"#FFFFFF", textMuted:"#FFFFFF", textFaint:"#FFFFFF", accent:"#FFFFFF", surface:"#000000" },
} as const;
export type ThemeName = keyof typeof THEMES;
export type ThemeObj = Omit<typeof THEMES[ThemeName], "accent"> & { accent: string; accentGlow: string; gradientCard: string };
