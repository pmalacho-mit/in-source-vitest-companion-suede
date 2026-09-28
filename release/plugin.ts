import { DisplayReporter } from "./reporter.ts";

import type { Plugin } from "vitest/config";
import type { Vitest } from "vitest/node";

const SCRUBBING_DEFINES = new Set(["undefined", "void 0", "false", "null"]);

export const scrubsTests = (define: Record<string, unknown> | undefined) => {
  const value = define?.["import.meta.vitest"];
  return typeof value === "string" && SCRUBBING_DEFINES.has(value.trim());
};

const shipsTests = (configFile: string | undefined) =>
  `${configFile ?? "The Vite config"} does not define import.meta.vitest as undefined, so every in-source test block ships in this build. Add define: { "import.meta.vitest": "undefined" }.`;

// once per project, after --reporter from the command line, and before the reporters are created
const addDisplayReporter = ({ vitest }: { vitest: Vitest }) => {
  const reporters = vitest.config.reporters as unknown[];
  if (!reporters.some((reporter) => reporter instanceof DisplayReporter)) reporters.push(new DisplayReporter());
};

export default function inSourceCompanion(): Plugin {
  return {
    name: "in-source-companion",
    configureVitest: addDisplayReporter,
    configResolved(config) {
      if (config.command === "build" && !scrubsTests(config.define))
        config.logger.warn(shipsTests(config.configFile));
    },
  };
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;

  test("the define Vitest documents scrubs the tests, in any of its spellings", () => {
    expect(scrubsTests({ "import.meta.vitest": "undefined" })).toBe(true);
    expect(scrubsTests({ "import.meta.vitest": "false" })).toBe(true);
    expect(scrubsTests({})).toBe(false);
    expect(scrubsTests(undefined)).toBe(false);
  });
}
