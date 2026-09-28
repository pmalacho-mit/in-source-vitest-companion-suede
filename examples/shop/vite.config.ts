import { defineConfig } from "vitest/config";
import inSourceCompanion from "in-source-companion/vite";

export default defineConfig({
  plugins: [inSourceCompanion()],
  define: { "import.meta.vitest": "undefined" },
  build: { lib: { entry: "src/index.ts", formats: ["es"], fileName: "shop" } },
  test: { includeSource: ["src/**/*.ts"] },
});
