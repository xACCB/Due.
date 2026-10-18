import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

// The web app's unit tests (part of the root `npm test`, see vitest.config.ts there).
export default mergeConfig(viteConfig, defineConfig({
  test: {
    name: "web",
  },
}));
