import fs from "node:fs";
import path from "node:path";

import { DISPLAY, type DisplayArtifact } from "./artifact.ts";

import type { Reporter, TestCase, TestModule, Vitest } from "vitest/node";

export const OUTPUT_DIR = ".in-source-companion";

export const displaysFile = (root: string) => path.join(root, OUTPUT_DIR, "displays.json");

export type DisplayRecord = {
  id: string;
  file: string;
  name: string;
  line: number;
  column: number;
  page: string;
  state: "passed" | "failed" | "skipped" | "pending";
  message: string | null;
  actual: DisplayArtifact["actual"];
  expected: DisplayArtifact["expected"];
  meta: DisplayArtifact["meta"];
};

export type DisplaysFile = { displays: DisplayRecord[] };

const isDisplay = (artifact: { type: string }): artifact is DisplayArtifact =>
  artifact.type === DISPLAY;

const recordsOf = (testCase: TestCase): DisplayRecord[] => {
  const result = testCase.result();
  return testCase.artifacts().filter(isDisplay).map((artifact) => ({
    id: testCase.id,
    file: testCase.module.moduleId,
    name: testCase.fullName,
    line: artifact.location?.line ?? testCase.location?.line ?? 1,
    column: artifact.location?.column ?? 1,
    page: artifact.page,
    state: result.state,
    message: result.errors?.[0]?.message ?? null,
    actual: artifact.actual,
    expected: artifact.expected,
    meta: artifact.meta,
  }));
};

const readDisplays = (file: string): DisplayRecord[] => {
  try {
    return (JSON.parse(fs.readFileSync(file, "utf8")) as DisplaysFile).displays;
  } catch {
    return [];
  }
};

const ensureOutputDir = (root: string) => {
  const dir = path.join(root, OUTPUT_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(dir, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n");
};

// written whole and renamed into place, so a reader never sees half a file
const writeAtomically = (file: string, text: string) => {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, text);
  fs.renameSync(temporary, file);
};

// a run of some tests replaces what those tests recorded, and keeps the rest
export class DisplayReporter implements Reporter {
  private root = process.cwd();
  private readonly ran = new Set<string>();
  private readonly recorded: DisplayRecord[] = [];

  onInit(vitest: Vitest) {
    this.root = vitest.config.root;
  }

  onTestCaseResult(testCase: TestCase) {
    this.ran.add(testCase.id);
    this.recorded.push(...recordsOf(testCase));
  }

  onTestRunEnd(_modules: ReadonlyArray<TestModule>) {
    const file = displaysFile(this.root);
    if (!this.ran.size || (!this.recorded.length && !fs.existsSync(file))) return;
    const kept = readDisplays(file).filter((record) => !this.ran.has(record.id));
    ensureOutputDir(this.root);
    writeAtomically(file, JSON.stringify({ displays: [...kept, ...this.recorded] }, null, 2));
    this.ran.clear();
    this.recorded.length = 0;
  }
}
