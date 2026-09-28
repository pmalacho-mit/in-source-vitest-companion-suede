import * as vscode from "vscode";

import { describeReport } from "../../packages/in-source-companion/src/describe-report.ts";
import { IMPORT_META_VITEST } from "../../packages/in-source-companion/src/import-meta-vitest.ts";
import { projectRootFor, runCompanion, setting } from "./companion.ts";

import type { Finding, Report } from "../../packages/in-source-companion/src/check-scrub.ts";
import type { Fix, Span } from "../../packages/in-source-companion/src/test-only.ts";

const SOURCE = "in-source-companion";

const STATUS: Record<Report["verdict"], string | null> = {
  scrubbed: "$(check) Tests scrubbed",
  leaks: "$(warning) Tests leak into build",
  "no-define": "$(warning) Tests ship in build",
  "no-tests": null,
  "no-config": null,
};

const rangeOf = ({ start, end }: Span) => new vscode.Range(start.line, start.column, end.line, end.column);

const severityOf = (finding: Finding) =>
  finding.kind === "block-ships" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;

const mentionsTests = (document: vscode.TextDocument) => document.getText().includes(IMPORT_META_VITEST);

const editFor = (uri: vscode.Uri, fix: Fix) => {
  const edit = new vscode.WorkspaceEdit();
  for (const span of fix.remove) edit.delete(uri, rangeOf(span));
  edit.insert(uri, new vscode.Position(fix.insert.line, fix.insert.column), fix.text);
  return edit;
};

const byFile = (findings: Finding[]) => {
  const grouped = new Map<string, Finding[]>();
  for (const finding of findings) grouped.set(finding.file, [...(grouped.get(finding.file) ?? []), finding]);
  return grouped;
};

const DEBOUNCE_MS = 1500;

export function scrubChecks(output: vscode.OutputChannel) {
  const diagnostics = vscode.languages.createDiagnosticCollection("inSourceCompanion.scrub");
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  status.command = "inSourceCompanion.checkScrub";
  const fixes = new WeakMap<vscode.Diagnostic, { fix: Fix; version: number | undefined }>();
  const reported = new Map<string, vscode.Uri[]>();
  const running = new Map<string, Promise<void>>();
  const rerun = new Set<string>();
  const timers = new Map<string, NodeJS.Timeout>();

  const versionOf = (file: string) =>
    vscode.workspace.textDocuments.find((d) => d.uri.fsPath === file)?.version;

  const diagnosticFor = (finding: Finding) => {
    const diagnostic = new vscode.Diagnostic(rangeOf(finding.at), finding.message, severityOf(finding));
    diagnostic.source = SOURCE;
    diagnostic.code = finding.kind;
    if (finding.fix) fixes.set(diagnostic, { fix: finding.fix, version: versionOf(finding.file) });
    return diagnostic;
  };

  const publish = (root: string, report: Report) => {
    for (const uri of reported.get(root) ?? []) diagnostics.delete(uri);
    const grouped = byFile(report.findings);
    for (const [file, findings] of grouped) diagnostics.set(vscode.Uri.file(file), findings.map(diagnosticFor));
    reported.set(root, [...grouped.keys()].map((file) => vscode.Uri.file(file)));
    const text = STATUS[report.verdict];
    if (text) {
      status.text = text;
      status.tooltip = `${describeReport(report, root)}\n\nClick to check again.`;
      status.show();
    } else status.hide();
  };

  const runOnce = async (root: string) => {
    status.text = "$(sync~spin) Checking the build…";
    status.show();
    const ran = await runCompanion(root, ["check-scrub", "--json"]);
    const report = JSON.parse(ran.stdout) as Report;
    output.appendLine(describeReport(report, root));
    publish(root, report);
  };

  // one check per project at a time; a save while it runs asks for one more afterwards
  const check = (root: string): Promise<void> => {
    const current = running.get(root);
    if (current) {
      rerun.add(root);
      return current;
    }
    const next = runOnce(root)
      .catch((error: unknown) => {
        output.appendLine(String(error instanceof Error ? error.message : error));
        status.hide();
      })
      .finally(() => {
        running.delete(root);
        if (rerun.delete(root)) void check(root);
      });
    running.set(root, next);
    return next;
  };

  const checkSoon = (document: vscode.TextDocument) => {
    if (!setting("checkScrubOnSave", true) || document.uri.scheme !== "file" || !mentionsTests(document)) return;
    const root = projectRootFor(document.uri.fsPath);
    if (!root) return;
    clearTimeout(timers.get(root));
    timers.set(root, setTimeout(() => void check(root), DEBOUNCE_MS));
  };

  const quickFixes: vscode.CodeActionProvider = {
    provideCodeActions: (document, _range, context) =>
      context.diagnostics.flatMap((diagnostic) => {
        const known = fixes.get(diagnostic);
        if (!known || known.version !== document.version) return [];
        const action = new vscode.CodeAction(known.fix.title, vscode.CodeActionKind.QuickFix);
        action.edit = editFor(document.uri, known.fix);
        action.diagnostics = [diagnostic];
        action.isPreferred = true;
        return [action];
      }),
  };

  const checkActive = async () => {
    const file = vscode.window.activeTextEditor?.document.uri.fsPath;
    const root = file ? projectRootFor(file) : null;
    if (!root) return void vscode.window.showWarningMessage("Open a file in a project with a vite.config.* to check its build.");
    output.show(true);
    await check(root);
  };

  return [
    diagnostics,
    status,
    vscode.workspace.onDidSaveTextDocument(checkSoon),
    vscode.languages.registerCodeActionsProvider(
      ["typescript", "typescriptreact", "javascript", "javascriptreact"].map((language) => ({ language, scheme: "file" })),
      quickFixes,
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] },
    ),
    vscode.commands.registerCommand("inSourceCompanion.checkScrub", checkActive),
  ];
}
