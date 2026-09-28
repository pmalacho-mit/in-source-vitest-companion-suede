import path from "node:path";

import { IMPORT_META_VITEST } from "./import-meta-vitest.ts";

import type { Finding, Leak, Report } from "./check-scrub.ts";

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

export const passed = (report: Report) => report.verdict === "scrubbed" || report.verdict === "no-tests";

type Relative = (file: string) => string;

const HEADLINES: Record<Report["verdict"], (report: Report, relative: Relative) => string> = {
  scrubbed: (r) => `✓ The production build is the same with every test deleted (${plural(r.testFiles.length, "file")} with tests).`,
  "no-tests": () => "✓ The production build has no in-source tests in it.",
  leaks: () => "✗ Tests leak into the production build.",
  "no-define": () => `✗ Every in-source test block ships: the Vite config does not define ${IMPORT_META_VITEST}.`,
  "no-config": (r, relative) => `✗ No vite.config.* in ${relative(r.root)}, so there is no build to check.`,
};

const leakLines = (leak: Leak, relative: Relative) => [
  `  ${leak.module ?? relative(leak.output)}`,
  ...leak.lines.map((line) => `    ${line.trim()}`),
];

const findingLine = (finding: Finding, relative: Relative) =>
  `${relative(finding.file)}:${finding.at.start.line + 1}:${finding.at.start.column + 1}  ${finding.message}`;

export function describeReport(report: Report, from: string): string {
  const relative = (file: string) => path.relative(from, file) || ".";
  return [
    HEADLINES[report.verdict](report, relative),
    ...(report.leaks.length
      ? ["", "What ships only because of the tests:", ...report.leaks.flatMap((leak) => leakLines(leak, relative))]
      : []),
    ...(report.findings.length ? ["", ...report.findings.map((f) => findingLine(f, relative))] : []),
  ].join("\n");
}
