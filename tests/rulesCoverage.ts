import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

// After the rules tests: ask the emulator which parts of firestore.rules the
// tests actually evaluated, and write a short summary to
// coverage/rules/summary.txt listing any line no test reached. (The emulator's
// own HTML report embeds every value it saw, which runs to hundreds of
// megabytes for these suites, so only the hit/miss per expression is kept.)
// CI uploads the summary as the "firestore-rules-coverage" artifact.
// Best effort: a missing report never fails the run.
const PROJECTS = ["dueplanner-rules-test", "dueplanner-rules-tight", "dueplanner-counter-a", "dueplanner-counter-b"];

type Node = { sourcePosition?: { line?: number; column?: number; endOffset?: number; currentOffset?: number }; values?: unknown[]; children?: Node[] };

export default function setup() {
  return async function teardown() {
    const host = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
    const lines = readFileSync("firestore.rules", "utf8").split(/\r?\n/);
    // line number -> was any expression starting on it evaluated, in any project
    const seen = new Map<number, boolean>();
    let reports = 0;
    for (const project of PROJECTS) {
      try {
        const res = await fetch(`http://${host}/emulator/v1/projects/${project}:ruleCoverage`);
        if (!res.ok) continue;
        const data = await res.json() as { report?: Node[] };
        const walk = (n: Node) => {
          const line = n.sourcePosition?.line;
          if (typeof line === "number") seen.set(line, (seen.get(line) || false) || (Array.isArray(n.values) && n.values.length > 0));
          (n.children || []).forEach(walk);
        };
        (data.report || []).forEach(walk);
        reports++;
      } catch { /* emulator already gone, or no report for this project */ }
    }
    if (!reports) return;
    const missed = [...seen].filter(([, hit]) => !hit).map(([line]) => line).sort((a, b) => a - b);
    const out = [
      `firestore.rules coverage, from ${reports} test project${reports === 1 ? "" : "s"} (${PROJECTS.join(", ")})`,
      `${seen.size - missed.length} of ${seen.size} lines with rule expressions were evaluated by the tests.`,
      missed.length ? "Lines no test evaluated:" : "Every line with a rule expression was evaluated.",
      ...missed.map(n => `  ${String(n).padStart(4)}  ${(lines[n - 1] || "").trim()}`),
      "",
    ].join("\n");
    mkdirSync("coverage/rules", { recursive: true });
    writeFileSync("coverage/rules/summary.txt", out);
    console.log("\n" + out);
  };
}
