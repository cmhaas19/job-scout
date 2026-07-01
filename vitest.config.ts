import { defineConfig } from "vitest/config";

export default defineConfig({
  // Native resolution of the `@/*` alias from tsconfig.json so tests import
  // the same way app code does (no manual moduleNameMapper).
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/*.test.ts", "src/lib/database.types.ts"],
    },
  },
});
