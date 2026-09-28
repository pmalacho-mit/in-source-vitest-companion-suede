import { defineConfig } from "vitest/config";

import inSourceCompanion from "./packages/in-source-companion/src/plugin.ts";

export default defineConfig({
  plugins: [inSourceCompanion()],
  test: {
    includeSource: ["packages/*/src/**/*.ts", "vscode-extension/src/**/*.ts"],
    include: ["packages/*/test/**/*.test.ts"],
  },
});
