import fs from "node:fs";
import path from "node:path";
import * as vscode from "vscode";

import { keyOf, type DisplayRecord, type DisplayStore } from "./displays.ts";
import { MESSAGES, render } from "./render.ts";

type Open = { panel: vscode.WebviewPanel; record: DisplayRecord };

const folderOf = (file: string) => vscode.Uri.file(path.dirname(file));

export function displayPanels(extensionUri: vscode.Uri, store: DisplayStore) {
  const open = new Map<string, Open>();
  const dist = vscode.Uri.joinPath(extensionUri, "dist");

  // read afresh, so an edited page shows, and a page that appends starts clean
  const show = ({ panel, record }: Open) => {
    const { webview } = panel;
    webview.html = render(fs.readFileSync(record.page, "utf8"), {
      base: webview.asWebviewUri(folderOf(record.page)).toString(),
      csp: webview.cspSource,
      codec: webview.asWebviewUri(vscode.Uri.joinPath(dist, "codec.js")).toString(),
    });
  };

  const send = async (key: string) => {
    const shown = open.get(key);
    if (!shown) return;
    const { record } = shown;
    await shown.panel.webview.postMessage({
      type: MESSAGES.encoded,
      actual: record.actual,
      expected: record.expected,
      meta: record.meta,
      passed: record.state === "passed",
      message: record.message,
    });
  };

  const createPanel = (key: string, record: DisplayRecord) => {
    const panel = vscode.window.createWebviewPanel(
      "inSourceCompanion.display",
      record.name,
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [folderOf(record.page), dist] },
    );
    panel.onDidDispose(() => open.delete(key));
    // the page announces itself once it is ready for the values
    panel.webview.onDidReceiveMessage(() => void send(key));
    return panel;
  };

  const redraw = () => {
    for (const [key, shown] of open) {
      const record = store.byKey(key);
      if (!record) continue;
      shown.record = record;
      show(shown);
    }
  };

  const subscription = store.onDidChange(redraw);

  return {
    open(record: DisplayRecord) {
      const key = keyOf(record);
      const shown = { panel: open.get(key)?.panel ?? createPanel(key, record), record };
      open.set(key, shown);
      show(shown);
      shown.panel.reveal(shown.panel.viewColumn, true);
    },
    dispose: () => {
      subscription.dispose();
      for (const { panel } of open.values()) panel.dispose();
    },
  };
}

export type DisplayPanels = ReturnType<typeof displayPanels>;
