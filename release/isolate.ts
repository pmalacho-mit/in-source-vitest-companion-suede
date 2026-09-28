import path from "node:path";
import ts from "typescript";

import { childrenOf, isImportMetaVitest, isInside, parse, testBlocksIn, type TestBlock } from "./blocks.ts";

export const ISOLATED_SUFFIX = ".isolated.test";

export type Isolated = { file: string; test: string; text: string };

const TESTS = new Set(["test", "it"]);
const SUITES = new Set(["describe", "suite"]);

const HEADER = "// in-source-companion: isolated from";

export const isIsolated = (text: string) => text.startsWith(HEADER);

// `const { test, it: spec } = import.meta.vitest` binds local names to Vitest's
function vitestBindings(blocks: readonly TestBlock[]) {
  const bindings = new Map<string, string>();
  for (const statement of blocks.flatMap(bodyOf))
    for (const declaration of ts.isVariableStatement(statement) ? statement.declarationList.declarations : [])
      if (declaration.initializer && isImportMetaVitest(declaration.initializer) && ts.isObjectBindingPattern(declaration.name))
        for (const element of declaration.name.elements)
          bindings.set(element.name.getText(), element.propertyName?.getText() ?? element.name.getText());
  return bindings;
}

const bodyOf = (block: TestBlock): ts.Statement[] =>
  ts.isBlock(block.thenStatement) ? [...block.thenStatement.statements] : [block.thenStatement];

const rootOf = (callee: ts.Expression): ts.Expression =>
  ts.isPropertyAccessExpression(callee) || ts.isCallExpression(callee)
    ? rootOf(ts.isCallExpression(callee) ? callee.expression : callee.expression)
    : callee;

type Kind = "test" | "suite" | null;

const kindOf = (node: ts.Node, bindings: Map<string, string>): Kind => {
  if (!ts.isCallExpression(node)) return null;
  const root = rootOf(node.expression);
  if (!ts.isIdentifier(root)) return null;
  const name = bindings.get(root.text) ?? root.text;
  return TESTS.has(name) ? "test" : SUITES.has(name) ? "suite" : null;
};

// its own lines, as if it started in the first column
const dedented = (node: ts.Node) => {
  const source = node.getSourceFile();
  const column = source.getLineAndCharacterOfPosition(node.getStart()).character;
  const margin = new RegExp(`^ {0,${column}}`);
  return node
    .getText()
    .split("\n")
    .map((line, i) => (i === 0 ? line : line.replace(margin, "")))
    .join("\n");
};

const callOf = (statement: ts.Statement) =>
  ts.isExpressionStatement(statement) ? statement.expression : statement;

const lineOf = (source: ts.SourceFile, node: ts.Node) =>
  source.getLineAndCharacterOfPosition(node.getStart()).line + 1;

const endLineOf = (source: ts.SourceFile, node: ts.Node) =>
  source.getLineAndCharacterOfPosition(node.end).line + 1;

function* callsIn(node: ts.Node): Generator<ts.CallExpression> {
  if (ts.isCallExpression(node)) yield node;
  for (const child of childrenOf(node)) yield* callsIn(child);
}

function testAt(source: ts.SourceFile, blocks: TestBlock[], bindings: Map<string, string>, line: number) {
  const tests = blocks.flatMap((block) => [...callsIn(block)]).filter((call) => kindOf(call, bindings) === "test");
  const outermost = tests.filter((call) => !tests.some((other) => other !== call && isInside(call, [other])));
  return (
    outermost.find((call) => lineOf(source, call) === line) ??
    outermost.find((call) => lineOf(source, call) <= line && line <= endLineOf(source, call))
  );
}

const nameOf = (call: ts.CallExpression) => {
  const first = call.arguments[0];
  return first && ts.isStringLiteralLike(first) ? first.text : (first?.getText() ?? "test");
};

// a suite keeps its setup and the one path to the test; its other tests and suites go
function pathTo(test: ts.CallExpression, statements: readonly ts.Statement[], bindings: Map<string, string>): string[] {
  const kept: string[] = [];
  for (const statement of statements) {
    const call = callOf(statement);
    const kind = kindOf(call, bindings);
    if (!kind || call === test) kept.push(dedented(statement));
    else if (kind === "suite" && isInside(test, [call])) kept.push(suiteAround(test, call as ts.CallExpression, bindings));
  }
  return kept;
}

const callbackOf = (suite: ts.CallExpression) => {
  const last = suite.arguments[suite.arguments.length - 1];
  return last && (ts.isArrowFunction(last) || ts.isFunctionExpression(last)) && ts.isBlock(last.body) ? last : null;
};

const indented = (text: string) =>
  text
    .split("\n")
    .map((line) => (line ? `  ${line}` : line))
    .join("\n");

function suiteAround(test: ts.CallExpression, suite: ts.CallExpression, bindings: Map<string, string>): string {
  const callback = callbackOf(suite);
  if (!callback) return dedented(suite);
  const body = pathTo(test, (callback.body as ts.Block).statements, bindings);
  const opening = suite.getText().slice(0, callback.body.getStart() - suite.getStart() + 1);
  return `${opening}\n${body.map(indented).join("\n")}\n});`;
}

const isOnPathTo = (test: ts.CallExpression, statement: ts.Statement, bindings: Map<string, string>) => {
  const call = callOf(statement);
  return call === test || (kindOf(call, bindings) === "suite" && isInside(test, [call]));
};

// the block's declarations the test reaches; its other statements, like hooks, always run
function setupReachedFrom(test: ts.CallExpression, body: ts.Statement[], bindings: Map<string, string>) {
  const path = pathTo(test, body.filter((s) => isOnPathTo(test, s, bindings)), bindings);
  const used = identifiersInText(test.getSourceFile().fileName, path.join("\n"));
  const declarations = body.filter(ts.isVariableStatement);
  const kept = new Set<ts.Statement>();
  for (let grew = true; grew; ) {
    grew = false;
    for (const declaration of declarations)
      if (!kept.has(declaration) && [...declaredBy(declaration)].some((name) => used.has(name))) {
        kept.add(declaration);
        for (const name of identifiersIn(declaration)) used.add(name);
        grew = true;
      }
  }
  return body.filter((s) => !ts.isVariableStatement(s) || kept.has(s));
}

const isVitestDestructuring = (statement: ts.Statement) =>
  ts.isVariableStatement(statement) &&
  statement.declarationList.declarations.some((d) => d.initializer && isImportMetaVitest(d.initializer));

const vitestImport = (bindings: Map<string, string>) => {
  const names = [...bindings].map(([local, vitest]) => (local === vitest ? local : `${vitest} as ${local}`));
  return `import { ${names.join(", ")} } from "vitest";`;
};

type Declared = Map<string, ts.Statement>;

function* declaredBy(statement: ts.Statement): Generator<string> {
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    if (clause?.name) yield clause.name.text;
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) yield bindings.name.text;
    if (bindings && ts.isNamedImports(bindings)) for (const e of bindings.elements) yield e.name.text;
  } else if (ts.isVariableStatement(statement)) {
    for (const d of statement.declarationList.declarations)
      for (const id of identifiersOf(d.name)) yield id;
  } else {
    const name = (statement as { name?: ts.Node }).name;
    if (name && ts.isIdentifier(name)) yield name.text;
  }
}

const identifiersOf = (name: ts.BindingName): string[] =>
  ts.isIdentifier(name)
    ? [name.text]
    : name.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : identifiersOf(e.name)));

function* identifiersIn(node: ts.Node): Generator<string> {
  if (ts.isIdentifier(node)) yield node.text;
  for (const child of childrenOf(node)) yield* identifiersIn(child);
}

const identifiersInText = (file: string, text: string) => new Set(identifiersIn(parse(file, text)));

// by name, not by symbol: an extra statement kept is harmless, a missing one is not
function reachedFrom(names: Set<string>, declared: Declared): Set<ts.Statement> {
  const kept = new Set<ts.Statement>();
  const queue = [...names];
  for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
    const statement = declared.get(name);
    if (!statement || kept.has(statement)) continue;
    kept.add(statement);
    if (!ts.isImportDeclaration(statement)) queue.push(...identifiersIn(statement));
  }
  return kept;
}

function trimmedImport(statement: ts.ImportDeclaration, used: Set<string>): string | null {
  const clause = statement.importClause;
  if (!clause) return statement.getText();
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) return used.has(bindings.name.text) ? statement.getText() : null;
  const named = bindings && ts.isNamedImports(bindings) ? [...bindings.elements] : [];
  const wanted = named.filter((e) => used.has(e.name.text));
  const byDefault = clause.name && used.has(clause.name.text) ? clause.name.text : null;
  if (!byDefault && !wanted.length) return null;
  const parts = [byDefault, wanted.length ? `{ ${wanted.map((e) => e.getText()).join(", ")} }` : null].filter(Boolean);
  return `import ${clause.isTypeOnly ? "type " : ""}${parts.join(", ")} from ${statement.moduleSpecifier.getText()};`;
}

const withoutExport = (text: string) =>
  text.replace(/^export (default )?(?=(async |abstract |declare )*(const|let|var|function|class|interface|type|enum) )/, "");

// module-level code the test cannot reach by name still runs, so it is kept
const isEffect = (statement: ts.Statement) =>
  ts.isExpressionStatement(statement) || (ts.isImportDeclaration(statement) && !statement.importClause);

function moduleCode(source: ts.SourceFile, blocks: TestBlock[], used: Set<string>): string[] {
  const outside = source.statements.filter((s) => !isInside(s, blocks) && !ts.isExportDeclaration(s));
  const declared: Declared = new Map(outside.flatMap((s) => [...declaredBy(s)].map((name) => [name, s] as const)));
  const effects = outside.filter(isEffect);
  const kept = reachedFrom(new Set([...used, ...effects.flatMap((s) => [...identifiersIn(s)])]), declared);
  const code = [...kept].filter((s) => !ts.isImportDeclaration(s));
  const everyName = new Set([...used, ...code.flatMap((s) => [...identifiersIn(s)])]);
  return outside
    .filter((s) => kept.has(s) || isEffect(s))
    .map((s) => (ts.isImportDeclaration(s) ? trimmedImport(s, everyName) : withoutExport(s.getText())))
    .filter((text): text is string => text !== null);
}

const slugOf = (name: string) => name.replace(/[^\w-]+/g, "_").replace(/^_+|_+$/g, "") || "test";

export const isolatedPathFor = (file: string, testName: string) => {
  const ext = path.extname(file);
  const stem = path.basename(file, ext);
  return path.join(path.dirname(file), `${stem}.${slugOf(testName)}${ISOLATED_SUFFIX}${ext}`);
};

const headerFor = (file: string, test: string, line: number) =>
  `${HEADER} ./${path.basename(file)}, test "${test}" (line ${line}). Regenerate it with Isolate Test.`;

export class NoTestAtLine extends Error {
  constructor(file: string, line: number) {
    super(`No in-source test is on line ${line} of ${file}.`);
  }
}

export function isolate(file: string, code: string, line: number): Isolated {
  const source = parse(file, code);
  const blocks = [...testBlocksIn(source)];
  const bindings = vitestBindings(blocks);
  const test = testAt(source, blocks, bindings, line);
  if (!test) throw new NoTestAtLine(file, line);
  const block = blocks.find((b) => isInside(test, [b]))!;
  const body = bodyOf(block).filter((s) => !isVitestDestructuring(s));
  const tests = pathTo(test, setupReachedFrom(test, body, bindings), bindings);
  const used = identifiersInText(file, tests.join("\n"));
  const text = [
    headerFor(file, nameOf(test), line),
    vitestImport(bindings.size ? bindings : new Map([["test", "test"], ["expect", "expect"]])),
    ...moduleCode(source, blocks, used),
    "",
    ...tests,
    "",
  ].join("\n");
  return { file: isolatedPathFor(file, nameOf(test)), test: nameOf(test), text };
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;

  const code = [
    'import { formatCents, parseCents } from "./money";',
    'import type { Line } from "./types";',
    "const TAX = 0.2;",
    "const unrelated = () => parseCents('1');",
    "export class Cart {",
    "  lines: Line[] = [];",
    "  total() { return formatCents(this.lines.length * (1 + TAX)); }",
    "}",
    "if (import.meta.vitest) {",
    "  const { it: spec, expect, describe } = import.meta.vitest;",
    "  const fresh = () => new Cart();",
    "  const unused = await import('./fixtures');",
    "  spec('unrelated', () => expect(unrelated()).toBe(1));",
    "  describe('Cart', () => {",
    "    spec('other', () => unused);",
    "    spec('totals', () => {",
    "      expect(fresh().total()).toBe('$0.00');",
    "    });",
    "  });",
    "}",
  ].join("\n");

  const isolated = isolate("/p/cart.ts", code, 16);

  test("the file is named after the test, beside the module", () => {
    expect(isolated.file).toBe("/p/cart.totals.isolated.test.ts");
  });

  test("it imports from Vitest what the block took from import.meta.vitest", () => {
    expect(isolated.text).toContain('import { it as spec, expect, describe } from "vitest";');
  });

  test("it keeps the code the test reaches, and nothing else", () => {
    expect(isolated.text).toContain("class Cart {");
    expect(isolated.text).toContain("const TAX = 0.2;");
    expect(isolated.text).toContain('import { formatCents } from "./money";');
    expect(isolated.text).toContain('import type { Line } from "./types";');
    expect(isolated.text).not.toContain("unrelated");
    expect(isolated.text).not.toContain("other");
  });

  test("the test keeps its suite, and the block the setup it uses", () => {
    expect(isolated.text).toContain("const fresh = () => new Cart();");
    expect(isolated.text).not.toContain("unused");
    expect(isolated.text).toContain("describe('Cart', () => {\n  spec('totals', () => {");
  });

  test("a line inside a test's body finds that test", () => {
    expect(isolate("/p/cart.ts", code, 17).test).toBe("totals");
  });

  test("a line with no test on it is an error, not an empty file", () => {
    expect(() => isolate("/p/cart.ts", code, 1)).toThrow(NoTestAtLine);
  });
}
