// Ported from aaditisinghal/vouch-aaditi's vitest.config.mts (commit
// 55eedf7) — identical; tsconfig-paths resolves this repo's own @/* alias
// just the same.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    globals: true,
  },
});
