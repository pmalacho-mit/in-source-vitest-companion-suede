import ts from "typescript";

import { IMPORT_META_VITEST } from "./import-meta-vitest.ts";

const scriptKindOf = (file: string) => {
  if (/\.[cm]?tsx$/.test(file)) return ts.ScriptKind.TSX;
  if (/\.jsx$/.test(file)) return ts.ScriptKind.JSX;
  if (/\.[cm]?js$/.test(file)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
};

export const parse = (file: string, text: string) =>
  ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKindOf(file));

export const isScript = (file: string) => /\.[cm]?[jt]sx?$/.test(file);

export const mentionsVitest = (code: string) => code.includes(IMPORT_META_VITEST);

const isImportMeta = (node: ts.Expression) =>
  ts.isMetaProperty(node) &&
  node.keywordToken === ts.SyntaxKind.ImportKeyword &&
  node.name.text === "meta";

export const isImportMetaVitest = (node: ts.Node): boolean =>
  ts.isParenthesizedExpression(node)
    ? isImportMetaVitest(node.expression)
    : ts.isPropertyAccessExpression(node) &&
      node.name.text === "vitest" &&
      isImportMeta(node.expression);

export type TestBlock = ts.IfStatement;

export const isTestBlock = (node: ts.Node): node is TestBlock =>
  ts.isIfStatement(node) && isImportMetaVitest(node.expression);

export const childrenOf = (node: ts.Node) => {
  const children: ts.Node[] = [];
  ts.forEachChild(node, (child) => {
    children.push(child);
  });
  return children;
};

export function* testBlocksIn(node: ts.Node): Generator<TestBlock> {
  for (const child of childrenOf(node)) {
    if (isTestBlock(child)) yield child;
    else yield* testBlocksIn(child);
  }
}

export const isInside = (node: ts.Node, containers: readonly ts.Node[]) =>
  containers.some((container) => node.pos >= container.pos && node.end <= container.end);

type Edit = { start: number; end: number; text: string };

const splice = (code: string, edits: readonly Edit[]) => {
  let out = "";
  let last = 0;
  for (const { start, end, text } of edits) {
    out += code.slice(last, start) + text;
    last = end;
  }
  return out + code.slice(last);
};

// blanked, not removed: every line and column after it stays where it was
export const blanked = (text: string) => text.replace(/[^\n]/g, " ");

// `if (import.meta.vitest) A else B` without its tests is `B`
const deletion = (code: string, block: TestBlock): Edit => {
  const start = block.getStart();
  const end = block.elseStatement ? block.elseStatement.getStart() : block.end;
  return { start, end, text: blanked(code.slice(start, end)) };
};

export function withoutTestBlocks(file: string, code: string): string | null {
  if (!mentionsVitest(code)) return null;
  const blocks = [...testBlocksIn(parse(file, code))];
  if (!blocks.length) return null;
  return splice(code, blocks.map((block) => deletion(code, block)));
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;

  test("a test block is deleted, and the lines after it keep their numbers", () => {
    const code = [
      "export const one = 1;",
      "if (import.meta.vitest) {",
      "  test('one', () => {});",
      "}",
      "export const two = 2;",
    ].join("\n");
    const deleted = withoutTestBlocks("a.ts", code)!;
    expect(deleted.split("\n")).toHaveLength(5);
    expect(deleted.split("\n")[4]).toBe("export const two = 2;");
    expect(deleted).not.toContain("test(");
  });

  test("an else branch is what remains", () => {
    const code = "if (import.meta.vitest) { a(); } else { b(); }";
    expect(withoutTestBlocks("a.ts", code)!.trim()).toBe("{ b(); }");
    expect(withoutTestBlocks("a.ts", code)).toHaveLength(code.length);
  });

  test("a mention outside an if is not a block", () => {
    expect(withoutTestBlocks("a.ts", "const v = import.meta.vitest;")).toBeNull();
  });

  test("parentheses around the condition do not hide a block", () => {
    const code = "if ((import.meta.vitest)) { a(); }";
    expect(withoutTestBlocks("a.ts", code)!.trim()).toBe("");
  });
}
