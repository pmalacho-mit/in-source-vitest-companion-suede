import fs from "node:fs";
import * as vscode from "vscode";

import type { DisplayRecord, DisplaysFile } from "../../packages/in-source-companion/src/reporter.ts";

export type { DisplayRecord };

const DISPLAYS = "**/.in-source-companion/displays.json";

export const keyOf = (record: DisplayRecord) => `${record.file}:${record.line}:${record.column}`;

const readDisplays = (file: string): DisplayRecord[] => {
  try {
    return (JSON.parse(fs.readFileSync(file, "utf8")) as DisplaysFile).displays;
  } catch {
    return [];
  }
};

// every displays.json in the workspace, one per Vitest root, kept current
export function displayStore() {
  const byFile = new Map<string, DisplayRecord[]>();
  const changed = new vscode.EventEmitter<void>();

  const load = (uri: vscode.Uri) => {
    byFile.set(uri.fsPath, readDisplays(uri.fsPath));
    changed.fire();
  };
  const forget = (uri: vscode.Uri) => {
    byFile.delete(uri.fsPath);
    changed.fire();
  };

  const watcher = vscode.workspace.createFileSystemWatcher(DISPLAYS);
  watcher.onDidCreate(load);
  watcher.onDidChange(load);
  watcher.onDidDelete(forget);
  void vscode.workspace.findFiles(DISPLAYS, "**/node_modules/**").then((uris) => uris.forEach(load));

  const all = () => [...byFile.values()].flat();

  return {
    onDidChange: changed.event,
    all,
    inFile: (file: string) => all().filter((record) => record.file === file),
    byKey: (key: string) => all().find((record) => keyOf(record) === key),
    within: (file: string, range: vscode.Range) =>
      all().find((r) => r.file === file && range.start.line <= r.line - 1 && r.line - 1 <= range.end.line),
    dispose: () => vscode.Disposable.from(watcher, changed).dispose(),
  };
}

export type DisplayStore = ReturnType<typeof displayStore>;
