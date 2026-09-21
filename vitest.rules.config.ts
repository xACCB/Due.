import { defineConfig } from "vitest/config";

// Only the Firestore rules tests -- run against the emulator via
// `npm run test:rules`, never as part of the default `npm test`.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
