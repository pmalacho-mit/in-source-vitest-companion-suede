import { defineConfig } from "vitest/config";

import inSourceCompanion from "../../../src/plugin.ts";

export default defineConfig({
  plugins: [inSourceCompanion()],
  test: { includeSource: ["src/**/*.ts"] },
});
