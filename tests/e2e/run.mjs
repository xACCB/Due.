// Starts the app's dev server in emulator mode, runs the end-to-end test
// against it, and stops the server. Meant to run inside
// `firebase emulators:exec --only auth,firestore` (see `npm run test:e2e`),
// which provides the emulators and stops them afterwards.
import { spawn, spawnSync } from "node:child_process";

const PORT = 5199;
const APP_URL = `http://localhost:${PORT}/`;
const isWindows = process.platform === "win32";

const server = spawn("npx", ["vite", "apps/web", "--port", String(PORT), "--strictPort"], {
  env: { ...process.env, VITE_FIREBASE_EMULATORS: "1" }, stdio: "ignore", shell: isWindows, detached: !isWindows,
});
const stopServer = () => {
  try {
    // Synchronous, so the whole process tree is gone before this script exits.
    if (isWindows) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    else process.kill(-server.pid, "SIGTERM");
  } catch { /* already gone */ }
};

let up = false;
for (let i = 0; i < 120 && !up; i++) {
  await new Promise(r => setTimeout(r, 500));
  try { up = (await fetch(APP_URL)).ok; } catch { /* not yet */ }
}
if (!up) { stopServer(); console.error("The dev server didn't start on " + APP_URL); process.exit(1); }

const test = spawn(process.execPath, ["tests/e2e/sync.e2e.mjs"], { env: { ...process.env, APP_URL }, stdio: "inherit" });
test.on("exit", code => { stopServer(); process.exit(code ?? 1); });
