// ─── FONT ─────────────────────────────────────────────────────────────────────
// Down to exactly one -- the original DM Serif Display/DM Mono pairing -- with
// every other option removed, so there's no per-user Font picker/state
// anymore (same treatment THEMES got when it went down to two).
// `google` is the Google Fonts family query; index.html's font <link>s use the
// same string, so change both together.
export const FONT = { name:"DM Serif", heading:"'DM Serif Display', serif", body:"'DM Mono', monospace", google:"DM+Serif+Display:ital@0;1&family=DM+Mono:wght@400;500" } as const;
