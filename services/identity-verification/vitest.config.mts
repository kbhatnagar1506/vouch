import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Node environment: everything under test is pure data-shaping and HMAC
// verification (lib/persona-schema.ts), so there's no DOM to stand up.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["**/__tests__/**/*.test.ts"],
  },
});
