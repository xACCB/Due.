// Puts firestore.rules back to an earlier version, for when a rules change
// turns out to break sign-in or sync for real users.
//
//   npm run rules:rollback                show what would be restored, change nothing
//   npm run rules:rollback -- --yes       restore the previous version and deploy it
//   npm run rules:rollback -- <commit> --yes   restore the version from that commit
//
// "Previous" means the version of firestore.rules before the last commit that
// changed it. The file in your working folder is replaced, so afterwards the
// rollback shows up as an ordinary change to review and commit. Deploying
// needs `npx firebase-tools login` first.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const wanted = args.find(a => !a.startsWith("--"));
const git = (...a) => execFileSync("git", a, { encoding: "utf8" });

const history = git("log", "--follow", "--date=short", "--format=%h %ad %s", "--", "firestore.rules").trim().split("\n");
if (history.length < 2 && !wanted) { console.error("firestore.rules has no earlier version to go back to."); process.exit(1); }
const target = wanted || history[1].split(" ")[0];

let restored;
try { restored = git("show", `${target}:firestore.rules`); }
catch { console.error(`No firestore.rules found at commit "${target}".`); process.exit(1); }
const current = readFileSync("firestore.rules", "utf8");
if (restored.replace(/\r\n/g, "\n") === current.replace(/\r\n/g, "\n")) { console.log(`firestore.rules already matches ${target}. Nothing to do.`); process.exit(0); }

console.log("Recent versions of firestore.rules (newest first):");
history.slice(0, 6).forEach((line, i) => console.log(`  ${line}${i === 0 ? "   <- latest change" : ""}${line.startsWith(target) ? "   <- would restore this" : ""}`));
console.log(`\nRestoring ${target} changes ${current.split("\n").length} lines to ${restored.split("\n").length}.`);

if (!yes) {
  console.log("\nNothing was changed. Run again with --yes to restore that version and deploy it:");
  console.log(`  npm run rules:rollback -- ${wanted ? wanted + " " : ""}--yes`);
  process.exit(0);
}

writeFileSync("firestore.rules", restored);
console.log(`\nfirestore.rules now holds the version from ${target}. Deploying...`);
const deploy = spawnSync("npx", ["firebase-tools", "deploy", "--only", "firestore:rules"], { stdio: "inherit", shell: process.platform === "win32" });
if (deploy.status !== 0) {
  console.error("\nThe deploy failed, so the live rules are unchanged. firestore.rules in this folder is the restored version;");
  console.error("run `git checkout firestore.rules` to undo that, or fix the problem and deploy again.");
  process.exit(deploy.status ?? 1);
}
console.log("\nRolled back and deployed. Now:");
console.log("  1. Add a line to firestore.rules.CHANGELOG.md saying what was rolled back and why.");
console.log("  2. Commit firestore.rules so the repository matches what is live.");
