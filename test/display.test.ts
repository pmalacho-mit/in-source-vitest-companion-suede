import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { decode } from "../src/codec.ts";
import { displaysFile, type DisplayRecord } from "../src/reporter.ts";

const root = path.join(import.meta.dirname, "fixtures", "display");
const vitest = path.join(import.meta.dirname, "..", "..", "..", "node_modules", "vitest", "vitest.mjs");

type JsonReport = { testResults: { assertionResults: { title: string; failureMessages: string[] }[] }[] };

let displays: DisplayRecord[] = [];
let report: JsonReport;

const reportFile = path.join(root, ".in-source-companion", "report.json");

// one test fails on purpose, so a non-zero exit is expected
const runVitest = () =>
  promisify(execFile)(process.execPath, [vitest, "run", "--reporter=json", `--outputFile=${reportFile}`], { cwd: root }).catch(
    () => undefined,
  );

const clean = () => fs.rmSync(path.join(root, ".in-source-companion"), { recursive: true, force: true });

afterAll(clean);

beforeAll(async () => {
  clean();
  await runVitest();
  report = JSON.parse(fs.readFileSync(reportFile, "utf8")) as JsonReport;
  displays = JSON.parse(fs.readFileSync(displaysFile(root), "utf8")).displays;
}, 60_000);

describe("a display, recorded by a test and collected by the plugin's reporter", () => {
  test("is found at the line that recorded it, with the page resolved beside the test", () => {
    expect(displays).toHaveLength(1);
    expect(displays[0]).toMatchObject({ name: "squares", line: 9, state: "passed" });
    expect(displays[0]?.page).toBe(path.join(root, "src", "pages", "bars.html"));
  });

  test("carries values JSON alone could not", () => {
    expect(decode(displays[0]!.expected)).toEqual(new Set([0, 1, 4, 9]));
    expect(decode(displays[0]!.meta)).toEqual({ unit: "px" });
  });

  test("a missing page fails the test that names it, saying where it looked", () => {
    const results = report.testResults.flatMap((file) => file.assertionResults);
    const missing = results.find((r) => r.title === "a page that is not there fails the test");
    expect(missing?.failureMessages[0]).toContain("No display page at ./pages/missing.html");
  });

  test("the reporter keeps its output out of version control", () => {
    expect(fs.readFileSync(path.join(root, ".in-source-companion", ".gitignore"), "utf8")).toBe("*\n");
  });
});
