import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

// The default `npm test` run -- fast, no external services. The Firestore
// rules tests live in tests/ and need the emulator running, so they're
// excluded here and run separately via `npm run test:rules`
// (see vitest.rules.config.ts).
export default mergeConfig(viteConfig, defineConfig({
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/.{idea,git,cache,output,temp}/**", "tests/**"],
  },
}));
