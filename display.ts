import fs from "node:fs";
import path from "node:path";
import { recordArtifact } from "vitest";

import { DISPLAY } from "./artifact.ts";
import { encode } from "./codec.ts";

import type { TestContext } from "vitest";

export type DisplayValues = { actual: unknown; expected?: unknown; meta?: unknown };

type Task = TestContext["task"];

export const pageFor = (testFile: string, page: string) =>
  path.resolve(path.dirname(testFile), page);

const missingPage = (task: Task, page: string) =>
  new Error(
    `No display page at ${page}. A page is found relative to the test file, ${path.basename(task.file.filepath)}.`,
  );

export async function display(
  task: Task,
  page: string,
  { actual, expected, meta }: DisplayValues,
): Promise<void> {
  const resolved = pageFor(task.file.filepath, page);
  if (!fs.existsSync(resolved)) throw missingPage(task, page);
  await recordArtifact(task, {
    type: DISPLAY,
    page: resolved,
    actual: encode(actual),
    expected: encode(expected),
    meta: encode(meta ?? null),
  });
}
