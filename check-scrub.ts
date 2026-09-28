import fs from "node:fs";
import path from "node:path";
import { build, type Plugin } from "vite";

import { blanked, isScript, mentionsVitest, withoutTestBlocks } from "./blocks.ts";
import { configIn } from "./config-files.ts";
import { IMPORT_META_VITEST } from "./import-meta-vitest.ts";
import { scrubsTests } from "./plugin.ts";
import { testBlockHeaders, testOnlyStatements, type Candidate, type Fix, type Range, type Span } from "./test-only.ts";

export type Verdict = "scrubbed" | "leaks" | "no-define" | "no-tests" | "no-config";

export type Leak = { output: string; module: string | null; lines: string[] };

export type Finding = {
  file: string;
  kind: "test-only-import" | "test-only-declaration" | "block-leaks" | "block-ships";
  at: Span;
  names: string[];
  message: string;
  fix: Fix | null;
};

export type Report = {
  root: string;
  configFile: string | null;
  verdict: Verdict;
  testFiles: string[];
  leaks: Leak[];
  findings: Finding[];
};

type Output = Map<string, string>;

type Built = { output: Output; define: Record<string, unknown> | undefined };

type Rewrite = (file: string, code: string) => string | null;

const withoutQuery = (id: string) => id.split("?")[0] ?? id;

const isOwnScript = (file: string) => isScript(file) && !file.includes(`${path.sep}node_modules${path.sep}`);

// runs before every other transform, so it sees the source as written
const rewriting = (rewrite: Rewrite, seen?: Set<string>): Plugin => ({
  name: "in-source-companion:rewrite",
  enforce: "pre",
  transform(code, id) {
    const file = withoutQuery(id);
    if (!isOwnScript(file) || !mentionsVitest(code)) return null;
    if (seen && withoutTestBlocks(file, code) !== null) seen.add(file);
    const rewritten = rewrite(file, code);
    return rewritten === null ? null : { code: rewritten, map: null };
  },
});

const unchanged: Rewrite = () => null;

const blankedRanges = (code: string, ranges: readonly Range[]) =>
  ranges.reduce(
    (text, { start, end }) => text.slice(0, start) + blanked(text.slice(start, end)) + text.slice(end),
    code,
  );

// the tests are the blocks, and the statements outside them that only the blocks use
const withoutTests = (file: string, code: string) => {
  const statements = blankedRanges(code, testOnlyStatements(file, code).flatMap((c) => c.group));
  return withoutTestBlocks(file, statements) ?? statements;
};

const deletingTestsFrom =
  (only?: string): Rewrite =>
  (file, code) =>
    only === undefined || file === only ? withoutTests(file, code) : null;

const deletingGroup =
  (target: string, candidate: Candidate): Rewrite =>
  (file, code) =>
    file === target ? blankedRanges(code, candidate.group) : null;

type Item =
  | { type: "chunk"; name: string; facadeModuleId: string | null; code: string }
  | { type: "asset"; names?: string[]; fileName: string; source: string | Uint8Array };

const keyOf = (item: Item) =>
  item.type === "chunk" ? (item.facadeModuleId ?? item.name) : (item.names?.[0] ?? item.fileName);

const contentOf = (item: Item) =>
  item.type === "chunk"
    ? item.code
    : typeof item.source === "string"
      ? item.source
      : Buffer.from(item.source).toString("base64");

const outputOf = (result: unknown): Output => {
  const output: Output = new Map();
  for (const { output: items } of [result].flat() as { output: Item[] }[])
    for (const item of items) {
      let key = keyOf(item);
      while (output.has(key)) key += "'";
      output.set(key, contentOf(item));
    }
  return output;
};

type Project = { root: string; configFile: string };

async function bundle({ root, configFile }: Project, plugins: Plugin[], readable = false): Promise<Built> {
  let define: Record<string, unknown> | undefined;
  const result = await build({
    root,
    configFile,
    logLevel: "silent",
    plugins: [...plugins, { name: "in-source-companion:define", configResolved: (c) => void (define = c.define) }],
    build: { write: false, ...(readable ? { minify: false } : {}) },
  });
  return { output: outputOf(result), define };
}

const same = (a: Output, b: Output) =>
  a.size === b.size && [...a].every(([key, content]) => b.get(key) === content);

function* linesByModule(code: string): Generator<{ module: string | null; line: string }> {
  let module: string | null = null;
  for (const line of code.split("\n")) {
    const region = /^\/\/#region (.+)$/.exec(line);
    if (region) module = region[1] ?? null;
    else if (line.startsWith("//#endregion")) module = null;
    else if (line.trim()) yield { module, line };
  }
}

const countedLines = (code: string) => {
  const counts = new Map<string, number>();
  for (const line of code.split("\n")) counts.set(line, (counts.get(line) ?? 0) + 1);
  return counts;
};

const MOST_LINES_SHOWN = 12;

// lines the shipped build has that the build without tests does not, by the module they came from
function leaksBetween(shipped: Output, scrubbed: Output): Leak[] {
  const leaks = new Map<string, Leak>();
  for (const [output, code] of shipped) {
    const remaining = countedLines(scrubbed.get(output) ?? "");
    for (const { module, line } of linesByModule(code)) {
      const left = remaining.get(line) ?? 0;
      if (left > 0) {
        remaining.set(line, left - 1);
        continue;
      }
      const key = `${output}\0${module}`;
      const leak = leaks.get(key) ?? { output, module, lines: [] };
      if (leak.lines.length < MOST_LINES_SHOWN) leak.lines.push(line);
      leaks.set(key, leak);
    }
  }
  return [...leaks.values()];
}

const MOST_CHARACTERS_QUOTED = 80;

const quotedLines = (leaks: Leak[]) => {
  const leak = leaks.find((l) => l.lines.length);
  const first = leak?.lines[0]?.trim() ?? "code";
  const quoted = `\`${first.length > MOST_CHARACTERS_QUOTED ? `${first.slice(0, MOST_CHARACTERS_QUOTED)}…` : first}\``;
  return leak?.module ? `${quoted} (${leak.module})` : quoted;
};

const quotedNames = (names: string[]) => names.map((name) => `\`${name}\``).join(", ");

const message = {
  import: (names: string[], leaks: Leak[]) =>
    `Only the tests use ${quotedNames(names)}, but importing it here keeps ${quotedLines(leaks)} in the production build. Import it inside the test block instead.`,
  declaration: (names: string[], leaks: Leak[]) =>
    `Only the tests use ${quotedNames(names)}, but declaring it here keeps ${quotedLines(leaks)} in the production build. Declare it inside the test block instead.`,
  blockLeaks: (leaks: Leak[]) =>
    `Deleting this test block changes the production build (${quotedLines(leaks)}), and no statement outside it explains why.`,
  blockShips: (configFile: string) =>
    `${path.basename(configFile)} does not define ${IMPORT_META_VITEST} as undefined, so this test block ships in the production build.`,
};

const findingFor = (file: string, candidate: Candidate, leaks: Leak[]): Finding => ({
  file,
  kind: candidate.kind === "import" ? "test-only-import" : "test-only-declaration",
  at: candidate.statement,
  names: candidate.names,
  message: message[candidate.kind](candidate.names, leaks),
  fix: candidate.fix,
});

const blockFindings = (file: string, kind: Finding["kind"], text: string): Finding[] =>
  testBlockHeaders(file, fs.readFileSync(file, "utf8")).map((at) => ({
    file,
    kind,
    at,
    names: [],
    message: text,
    fix: null,
  }));

const contains = (outer: readonly Range[], inner: readonly Range[]) =>
  inner.every((range) => outer.some((o) => o.start === range.start && o.end === range.end));

// smallest groups first, so a statement is not reported again as part of a larger group
const smallestFirst = (candidates: Candidate[]) =>
  [...candidates].sort((a, b) => a.group.length - b.group.length);

// a statement is reported only when deleting it, with what depends on it, changes the build
type Builds = { shipped: Built; readable: Built };

// verified against the build as configured, explained with one that is not minified
async function findingsIn(project: Project, file: string, { shipped, readable }: Builds): Promise<Finding[]> {
  const findings: Finding[] = [];
  const reported: Candidate[] = [];
  for (const candidate of smallestFirst(testOnlyStatements(file, fs.readFileSync(file, "utf8")))) {
    if (reported.some((r) => contains(candidate.group, r.group))) continue;
    const without = await bundle(project, [rewriting(deletingGroup(file, candidate))]);
    if (same(shipped.output, without.output)) continue;
    reported.push(candidate);
    const readableWithout = await bundle(project, [rewriting(deletingGroup(file, candidate))], true);
    findings.push(findingFor(file, candidate, leaksBetween(readable.output, readableWithout.output)));
  }
  return findings.sort((a, b) => a.at.start.line - b.at.start.line);
}

async function responsibleFor(project: Project, testFiles: string[], shipped: Built) {
  const responsible: { file: string; leaks: Leak[] }[] = [];
  for (const file of testFiles) {
    const without = await bundle(project, [rewriting(deletingTestsFrom(file))]);
    if (!same(shipped.output, without.output))
      responsible.push({ file, leaks: leaksBetween(shipped.output, without.output) });
  }
  return responsible;
}

async function explained(project: Project, testFiles: string[], builds: Builds): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const { file, leaks } of await responsibleFor(project, testFiles, builds.shipped)) {
    const statements = await findingsIn(project, file, builds);
    findings.push(...(statements.length ? statements : blockFindings(file, "block-leaks", message.blockLeaks(leaks))));
  }
  return findings;
}

async function readableBuilds(project: Project) {
  const shipped = await bundle(project, [rewriting(unchanged)], true);
  const scrubbed = await bundle(project, [rewriting(deletingTestsFrom())], true);
  return { readable: shipped, leaks: leaksBetween(shipped.output, scrubbed.output) };
}

const reportOf = (root: string, configFile: string | null, verdict: Verdict, rest: Partial<Report> = {}): Report => ({
  root,
  configFile,
  verdict,
  testFiles: [],
  leaks: [],
  findings: [],
  ...rest,
});

export async function checkScrub(root: string, configFile = configIn(root)): Promise<Report> {
  if (!configFile) return reportOf(root, null, "no-config");
  const project = { root, configFile };
  const seen = new Set<string>();
  const shipped = await bundle(project, [rewriting(unchanged, seen)]);
  const testFiles = [...seen].sort();
  if (!testFiles.length) return reportOf(root, configFile, "no-tests");
  const scrubbed = await bundle(project, [rewriting(deletingTestsFrom())]);
  if (same(shipped.output, scrubbed.output)) return reportOf(root, configFile, "scrubbed", { testFiles });
  const { readable, leaks } = await readableBuilds(project);
  if (!scrubsTests(shipped.define)) {
    const findings = testFiles.flatMap((file) => blockFindings(file, "block-ships", message.blockShips(configFile)));
    return reportOf(root, configFile, "no-define", { testFiles, leaks, findings });
  }
  const findings = await explained(project, testFiles, { shipped, readable });
  return reportOf(root, configFile, "leaks", { testFiles, leaks, findings });
}
