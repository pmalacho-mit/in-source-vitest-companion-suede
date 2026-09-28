import * as vscode from "vscode";

import { keyOf, type DisplayRecord, type DisplayStore } from "./displays.ts";

const STATE_ICONS: Record<DisplayRecord["state"], string> = {
  passed: "$(pass)",
  failed: "$(error)",
  skipped: "$(circle-slash)",
  pending: "$(clock)",
};

const lensFor = (record: DisplayRecord) =>
  new vscode.CodeLens(new vscode.Range(record.line - 1, 0, record.line - 1, 0), {
    title: `$(graph) Display ${STATE_ICONS[record.state]}`,
    command: "inSourceCompanion.showDisplay",
    arguments: [keyOf(record)],
  });

export const displayLenses = (store: DisplayStore) =>
  vscode.languages.registerCodeLensProvider(
    [{ scheme: "file", language: "typescript" }, { scheme: "file", language: "typescriptreact" }, { scheme: "file", language: "javascript" }, { scheme: "file", language: "javascriptreact" }],
    {
      onDidChangeCodeLenses: store.onDidChange,
      provideCodeLenses: (document) => store.inFile(document.uri.fsPath).map(lensFor),
    },
  );
