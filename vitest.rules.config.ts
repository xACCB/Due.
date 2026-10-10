import { defineConfig } from "vitest/config";

// Only the Firestore rules tests -- run against the emulator via
// `npm run test:rules`, never as part of the default `npm test`.
// tests/stress/ and tests/e2e/ have their own commands (test:stress, test:e2e).
export default defineConfig({
  test: {
    include: ["tests/*.test.ts"],
    // Saves the emulator's rules coverage reports to coverage/rules/ afterwards.
    globalSetup: ["tests/rulesCoverage.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
