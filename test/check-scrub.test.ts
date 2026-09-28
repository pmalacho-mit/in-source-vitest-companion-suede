import path from "node:path";
import { describe, expect, test } from "vitest";

import { checkScrub } from "../src/check-scrub.ts";

const fixture = (name: string) => path.join(import.meta.dirname, "fixtures", name);

describe("check-scrub", () => {
  test("tests imported inside their block leave the build untouched", async () => {
    const report = await checkScrub(fixture("scrubbed"));
    expect(report.verdict).toBe("scrubbed");
    expect(report.testFiles.map((file) => path.basename(file))).toEqual(["cart.ts"]);
  });

  test("without the define, every block ships, and says so", async () => {
    const report = await checkScrub(fixture("no-define"));
    expect(report.verdict).toBe("no-define");
    expect(report.findings.map((f) => f.kind)).toEqual(["block-ships"]);
    expect(report.leaks.flatMap((leak) => leak.lines).join("\n")).toContain("receipt");
  });

  test("a leak is traced to the statements that cause it, and only those", async () => {
    const report = await checkScrub(fixture("leaky"));
    expect(report.verdict).toBe("leaks");
    expect(report.findings.map((f) => [f.kind, f.names])).toEqual([
      ["test-only-import", ["fixture"]],
      ["test-only-declaration", ["SEEDED"]],
    ]);
    expect(report.leaks.flatMap((leak) => leak.lines)).toContain('console.log("helper loaded");');
  });

  test("a project with no Vite config has no build to check", async () => {
    expect((await checkScrub(import.meta.dirname)).verdict).toBe("no-config");
  });
}, 60_000);
