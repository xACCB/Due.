import { defineConfig } from "vitest/config";

// The default `npm test` run: the unit tests of the shared core and the web
// app, fast, no external services. The Firestore rules tests in tests/ need
// the emulator and run separately (`npm run test:rules`, vitest.rules.config.ts).
export default defineConfig({
  test: {
    projects: ["packages/core", "apps/web"],
  },
});
