import ts from "typescript";

import { childrenOf, isInside, parse, testBlocksIn, type TestBlock } from "./blocks.ts";

export type Position = { line: number; column: number };
export type Span = { start: Position; end: Position };
export type Range = { start: number; end: number };

export type Fix = { title: string; remove: Span[]; insert: Position; text: string };

// `group` is the statement and every test-only statement that uses it: they move, and are deleted, together
export type Candidate = {
  kind: "import" | "declaration";
  names: string[];
  statement: Span;
  group: Range[];
  fix: Fix | null;
};

type Located = ts.ImportDeclaration | ts.VariableStatement;

function* identifiersIn(node: ts.Node): Generator<ts.Identifier> {
  if (ts.isIdentifier(node)) yield node;
  for (const child of childrenOf(node)) yield* identifiersIn(child);
}

function* boundNames(name: ts.BindingName): Generator<ts.Identifier> {
  if (ts.isIdentifier(name)) yield name;
  else
    for (const element of name.elements)
      if (!ts.isOmittedExpression(element)) yield* boundNames(element.name);
}

function* importedNames(statement: ts.ImportDeclaration): Generator<ts.Identifier> {
  const clause = statement.importClause;
  if (!clause || clause.isTypeOnly) return;
  if (clause.name) yield clause.name;
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) yield bindings.name;
  if (bindings && ts.isNamedImports(bindings))
    for (const element of bindings.elements) if (!element.isTypeOnly) yield element.name;
}

const declaredNames = (statement: Located) =>
  ts.isImportDeclaration(statement)
    ? [...importedNames(statement)]
    : statement.declarationList.declarations.flatMap((d) => [...boundNames(d.name)]);

// a name after a dot, or a key in an object, is not a reference to a binding
const isReference = (identifier: ts.Identifier) => {
  const parent = identifier.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === identifier) return false;
  if (ts.isQualifiedName(parent) && parent.right === identifier) return false;
  if (
    (ts.isPropertyAssignment(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodDeclaration(parent)) &&
    parent.name === identifier
  )
    return false;
  if ((ts.isImportSpecifier(parent) || ts.isBindingElement(parent)) && parent.propertyName === identifier)
    return false;
  return true;
};

const isExported = (statement: ts.Statement) =>
  ts.canHaveModifiers(statement) &&
  !!ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);

const isCandidateStatement = (statement: ts.Statement): statement is Located =>
  !isExported(statement) &&
  ((ts.isImportDeclaration(statement) && !statement.importClause?.isTypeOnly) ||
    ts.isVariableStatement(statement));

type Uses = { inside: number; outside: number };

type Analysis = {
  source: ts.SourceFile;
  blocks: TestBlock[];
  statements: Located[];
  names: Map<Located, string[]>;
  references: ts.Identifier[];
};

function analyse(file: string, code: string): Analysis {
  const source = parse(file, code);
  const blocks = [...testBlocksIn(source)];
  const statements = source.statements.filter(isCandidateStatement).filter((s) => !isInside(s, blocks));
  const declarations = new Set(statements.flatMap(declaredNames));
  const references = [...identifiersIn(source)].filter((id) => !declarations.has(id) && isReference(id));
  const names = new Map(statements.map((s) => [s, declaredNames(s).map((id) => id.text)]));
  return { source, blocks, statements, names, references };
}

const usesWithin = ({ references }: Analysis, within: readonly ts.Node[]) => {
  const uses = new Map<string, Uses>();
  for (const identifier of references) {
    const counted = uses.get(identifier.text) ?? { inside: 0, outside: 0 };
    if (isInside(identifier, within)) counted.inside++;
    else counted.outside++;
    uses.set(identifier.text, counted);
  }
  return uses;
};

const onlyTheTestsUse = (uses: Map<string, Uses>, names: readonly string[]) =>
  names.length > 0 &&
  names.every((name) => uses.get(name)?.outside === 0 && (uses.get(name)?.inside ?? 0) > 0);

// a statement used only by the tests, or by other statements only the tests use
function testOnlySet(analysis: Analysis): Set<Located> {
  let testOnly = new Set<Located>();
  for (;;) {
    const uses = usesWithin(analysis, [...analysis.blocks, ...testOnly]);
    const next = analysis.statements.filter((s) => onlyTheTestsUse(uses, analysis.names.get(s)!));
    if (next.length === testOnly.size) return testOnly;
    testOnly = new Set(next);
  }
}

const usesAnyOf = (analysis: Analysis, user: Located, names: readonly string[]) =>
  analysis.references.some((id) => isInside(id, [user]) && names.includes(id.text));

function groupOf(analysis: Analysis, testOnly: ReadonlySet<Located>, statement: Located): Located[] {
  const group = new Set([statement]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const user of testOnly)
      if (!group.has(user) && [...group].some((s) => usesAnyOf(analysis, user, analysis.names.get(s)!))) {
        group.add(user);
        grew = true;
      }
  }
  return [...group].sort((a, b) => a.pos - b.pos);
}

const positionOf = (source: ts.SourceFile, offset: number): Position => {
  const { line, character } = source.getLineAndCharacterOfPosition(offset);
  return { line, column: character };
};

// whole lines, so moving a statement leaves no blank indentation behind
const linesOf = (source: ts.SourceFile, node: ts.Node): Span => {
  const start = positionOf(source, node.getStart());
  const end = positionOf(source, node.end);
  return { start: { line: start.line, column: 0 }, end: { line: end.line + 1, column: 0 } };
};

const spanOf = (source: ts.SourceFile, node: ts.Node): Span => ({
  start: positionOf(source, node.getStart()),
  end: positionOf(source, node.end),
});

const specifierOf = (statement: ts.ImportDeclaration) => statement.moduleSpecifier.getText();

const destructured = (statement: ts.ImportDeclaration) => {
  const clause = statement.importClause!;
  const parts: string[] = [];
  if (clause.name) parts.push(`default: ${clause.name.text}`);
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamedImports(bindings))
    for (const element of bindings.elements) {
      if (element.isTypeOnly) continue;
      const imported = element.propertyName?.getText() ?? element.name.text;
      parts.push(imported === element.name.text ? imported : `${imported}: ${element.name.text}`);
    }
  return parts;
};

export const dynamicImportOf = (statement: ts.ImportDeclaration) => {
  const bindings = statement.importClause?.namedBindings;
  const load = `await import(${specifierOf(statement)})`;
  const lines: string[] = [];
  if (bindings && ts.isNamespaceImport(bindings)) lines.push(`const ${bindings.name.text} = ${load};`);
  const parts = destructured(statement);
  if (parts.length) lines.push(`const { ${parts.join(", ")} } = ${load};`);
  return lines;
};

const asBlockStatements = (statement: Located) =>
  ts.isImportDeclaration(statement) ? dynamicImportOf(statement) : [statement.getText()];

const indentationIn = (block: ts.Block, source: ts.SourceFile) => {
  const first = block.statements[0];
  return first ? " ".repeat(positionOf(source, first.getStart()).column) : "  ";
};

const fixTitle = (statement: Located) =>
  ts.isImportDeclaration(statement)
    ? `Import ${specifierOf(statement)} inside the test block`
    : "Move this declaration into the test block";

// only a block at the top level can hold what the module's top level held
function moveInto(source: ts.SourceFile, block: TestBlock, group: Located[]): Fix | null {
  if (!ts.isBlock(block.thenStatement) || block.parent !== source) return null;
  const body = block.thenStatement;
  const indent = indentationIn(body, source);
  return {
    title: fixTitle(group[0]!),
    remove: group.map((statement) => linesOf(source, statement)),
    insert: { line: positionOf(source, body.getStart()).line + 1, column: 0 },
    text: group.flatMap(asBlockStatements).map((line) => `${indent}${line}\n`).join(""),
  };
}

export function testOnlyStatements(file: string, code: string): Candidate[] {
  const analysis = analyse(file, code);
  const first = analysis.blocks[0];
  if (!first) return [];
  const testOnly = testOnlySet(analysis);
  return analysis.statements
    .filter((statement) => testOnly.has(statement))
    .map((statement) => {
      const group = groupOf(analysis, testOnly, statement);
      return {
        kind: ts.isImportDeclaration(statement) ? "import" : "declaration",
        names: analysis.names.get(statement)!,
        statement: spanOf(analysis.source, statement),
        group: group.map((s) => ({ start: s.getStart(), end: s.end })),
        fix: moveInto(analysis.source, first, group),
      };
    });
}

// `if (import.meta.vitest)`, the part of a block worth underlining
export const testBlockHeaders = (file: string, code: string): Span[] => {
  const source = parse(file, code);
  return [...testBlocksIn(source)].map((block) => ({
    start: positionOf(source, block.getStart()),
    end: positionOf(source, block.expression.end + 1),
  }));
};

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;

  const code = [
    'import { formatCents } from "./money";',
    'import { fixture, other as renamed } from "./helper";',
    'import type { Shape } from "./shapes";',
    "const TABLE = [[1, fixture[0]]];",
    "export const receipt = (c: number): Shape => formatCents(c);",
    "export const EXPORTED_BUT_TESTED = 1;",
    "if (import.meta.vitest) {",
    "  const { test } = import.meta.vitest;",
    "  test('r', () => receipt(TABLE[0][0] + renamed + EXPORTED_BUT_TESTED));",
    "}",
  ].join("\n");

  const [helper, table] = testOnlyStatements("cart.ts", code);

  test("a statement only the tests use is a candidate, even through another test-only statement", () => {
    expect([helper?.names, table?.names]).toEqual([["fixture", "renamed"], ["TABLE"]]);
  });

  test("what the module exports or uses itself is not", () => {
    expect(testOnlyStatements("cart.ts", code)).toHaveLength(2);
  });

  test("a statement moves with the test-only statements that use it, in source order", () => {
    expect(helper?.fix?.text).toBe(
      '  const { fixture, other: renamed } = await import("./helper");\n  const TABLE = [[1, fixture[0]]];\n',
    );
    expect(helper?.fix?.remove.map((span) => span.start.line)).toEqual([1, 3]);
    expect(helper?.fix?.insert).toEqual({ line: 7, column: 0 });
  });

  test("a statement no other depends on moves alone", () => {
    expect(table?.group).toHaveLength(1);
    expect(table?.fix?.text).toBe("  const TABLE = [[1, fixture[0]]];\n");
  });

  test("a namespace and a default import keep their shapes", () => {
    const source = parse("a.ts", 'import d, * as ns from "./m";');
    expect(dynamicImportOf(source.statements[0] as ts.ImportDeclaration)).toEqual([
      'const ns = await import("./m");',
      'const { default: d } = await import("./m");',
    ]);
  });

  test("a property with the same name is not a use", () => {
    const shadowed = [
      'import { fixture } from "./helper";',
      "export const read = (o: { fixture: number }) => o.fixture;",
      "if (import.meta.vitest) { fixture; }",
    ].join("\n");
    expect(testOnlyStatements("a.ts", shadowed).map((c) => c.names)).toEqual([["fixture"]]);
  });
}
