import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Node environment, not jsdom: everything under test here is pure
// data-shaping (lib/memory-schema.ts), so there's no DOM to stand up and no
// need for the React/jsdom/testing-library stack the gmail-connector branch
// carries for its component tests.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["**/__tests__/**/*.test.ts"],
  },
});
