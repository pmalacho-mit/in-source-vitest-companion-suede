#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { checkScrub } from "./check-scrub.ts";
import { describeReport, passed } from "./describe-report.ts";
import { isolate } from "./isolate.ts";

const USAGE = `Usage:
  in-source-companion check-scrub [--root <dir>] [--config <file>] [--json]
      Build the project twice, as configured and with its tests deleted, and
      fail if the two builds differ.
  in-source-companion isolate <file> --line <n> [--write] [--json]
      Print the test starting on line <n> as a standalone test file, holding
      only the code it reaches. --write puts it beside the module instead.`;

const EXIT = { ok: 0, failed: 1, usage: 2 } as const;

class UsageError extends Error {}

const relative = (file: string) => path.relative(process.cwd(), file) || ".";

async function checkScrubCommand(args: string[]) {
  const { values } = parseArgs({
    args,
    options: { root: { type: "string" }, config: { type: "string" }, json: { type: "boolean" } },
  });
  const root = path.resolve(values.root ?? ".");
  const report = await checkScrub(root, values.config ? path.resolve(values.config) : undefined);
  console.log(values.json ? JSON.stringify(report, null, 2) : describeReport(report, process.cwd()));
  return report.verdict === "no-config" ? EXIT.usage : passed(report) ? EXIT.ok : EXIT.failed;
}

function isolateCommand(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { line: { type: "string" }, write: { type: "boolean" }, json: { type: "boolean" } },
  });
  const [file] = positionals;
  const line = Number(values.line);
  if (!file || !Number.isInteger(line) || line < 1) throw new UsageError("isolate needs a file and --line <n>.");
  const absolute = path.resolve(file);
  const isolated = isolate(absolute, fs.readFileSync(absolute, "utf8"), line);
  if (values.write) fs.writeFileSync(isolated.file, isolated.text);
  if (values.json) console.log(JSON.stringify({ ...isolated, written: !!values.write }));
  else console.log(values.write ? relative(isolated.file) : isolated.text);
  return EXIT.ok;
}

const COMMANDS: Record<string, (args: string[]) => number | Promise<number>> = {
  "check-scrub": checkScrubCommand,
  isolate: isolateCommand,
};

async function main([name, ...args]: string[]) {
  const command = name ? COMMANDS[name] : undefined;
  if (!command) {
    console.log(USAGE);
    return name === undefined || name === "--help" ? EXIT.ok : EXIT.usage;
  }
  try {
    return await command(args);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof UsageError) console.error(`\n${USAGE}`);
    return error instanceof UsageError ? EXIT.usage : EXIT.failed;
  }
}

process.exitCode = await main(process.argv.slice(2));
