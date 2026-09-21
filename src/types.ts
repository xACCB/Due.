// Small shared types used by both App.tsx and the pure lib/ modules -- kept
// here (rather than duplicated) so lib/ functions like getPriority/advanceDate
// don't need to import from App.tsx itself.
export type Priority = "high"|"medium"|"low";
export type Recurrence = "none"|"daily"|"weekly"|"monthly";
