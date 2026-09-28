import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

import { runCompanion, workingDirectoryFor } from "./companion.ts";

import type { Isolated } from "../../packages/in-source-companion/src/isolate.ts";

type Target = { file: string; line: number };

// from the Test Explorer or the gutter a test item, from the editor the cursor
const targetOf = (from: vscode.TestItem | undefined): Target | null => {
  if (from?.uri && from.range) return { file: from.uri.fsPath, line: from.range.start.line + 1 };
  const editor = vscode.window.activeTextEditor;
  return editor ? { file: editor.document.uri.fsPath, line: editor.selection.active.line + 1 } : null;
};

const mayOverwrite = async (isolated: Isolated) => {
  if (!fs.existsSync(isolated.file) || fs.readFileSync(isolated.file, "utf8") === isolated.text) return true;
  const answer = await vscode.window.showWarningMessage(
    `${path.basename(isolated.file)} has changed since it was isolated.`,
    { modal: true },
    "Overwrite",
  );
  return answer === "Overwrite";
};

const openBeside = async (file: string) =>
  vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file), { viewColumn: vscode.ViewColumn.Beside });

export async function isolateTest(from: vscode.TestItem | undefined, output: vscode.OutputChannel) {
  const target = targetOf(from);
  if (!target) return;
  const ran = await runCompanion(workingDirectoryFor(target.file), ["isolate", target.file, "--line", String(target.line), "--json"]);
  if (ran.code !== 0) {
    output.appendLine(ran.stderr);
    return void vscode.window.showErrorMessage(ran.stderr.trim().split("\n")[0] ?? "Could not isolate the test.");
  }
  const isolated = JSON.parse(ran.stdout) as Isolated;
  if (await mayOverwrite(isolated)) fs.writeFileSync(isolated.file, isolated.text);
  await openBeside(isolated.file);
}
