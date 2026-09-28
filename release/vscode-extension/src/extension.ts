import * as vscode from "vscode";

import { displayStore, keyOf, type DisplayRecord, type DisplayStore } from "./displays.ts";
import { isolateTest } from "./isolate.ts";
import { displayLenses } from "./lenses.ts";
import { displayPanels } from "./panels.ts";
import { scrubChecks } from "./scrub.ts";

const NOTHING_RECORDED =
  "No display recorded yet. Run a test that calls display(task, page, values) from in-source-companion/display.";

const pickDisplay = async (store: DisplayStore) => {
  const picked = await vscode.window.showQuickPick(
    store.all().map((record) => ({
      label: record.name,
      description: `${vscode.workspace.asRelativePath(record.file)}:${record.line}`,
      key: keyOf(record),
    })),
    { placeHolder: "Which test's display?" },
  );
  return picked ? store.byKey(picked.key) : undefined;
};

// from a lens a key, from the Test Explorer a test item, from the palette a choice
const displayFor = async (store: DisplayStore, from: string | vscode.TestItem | undefined) => {
  if (typeof from === "string") return store.byKey(from);
  if (from?.uri && from.range) return store.within(from.uri.fsPath, from.range);
  return pickDisplay(store);
};

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel("In-Source Companion");
  const store = displayStore();
  const panels = displayPanels(context.extensionUri, store);

  const showDisplay = async (from?: string | vscode.TestItem) => {
    const record: DisplayRecord | undefined = await displayFor(store, from);
    if (record) panels.open(record);
    else if (!store.all().length || from) void vscode.window.showInformationMessage(NOTHING_RECORDED);
  };

  context.subscriptions.push(
    output,
    store,
    panels,
    displayLenses(store),
    ...scrubChecks(output),
    vscode.commands.registerCommand("inSourceCompanion.showDisplay", showDisplay),
    vscode.commands.registerCommand("inSourceCompanion.isolateTest", (from?: vscode.TestItem) =>
      isolateTest(from, output),
    ),
  );
}

export function deactivate(): void {}
