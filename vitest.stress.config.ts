import { defineConfig } from "vitest/config";

// `npm run test:stress`: one account filled to the task cap on the emulator.
// Slow (thousands of writes), so it is not part of CI or `npm run test:rules`.
export default defineConfig({
  test: {
    include: ["tests/stress/*.stress.ts"],
    testTimeout: 900000,
    hookTimeout: 60000,
  },
});
