import { defineConfig } from "vitest/config";

// The phone app's unit tests: only its plain-TypeScript files (no React
// Native), run in Node as part of the root `npm test`.
export default defineConfig({
  test: { name: "mobile", include: ["src/**/*.test.ts"] },
});
