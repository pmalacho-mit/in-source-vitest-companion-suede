import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import * as vscode from "vscode";

import { configIn } from "../../packages/in-source-companion/src/config-files.ts";

export const setting = <T>(name: string, fallback: T) =>
  vscode.workspace.getConfiguration("inSourceCompanion").get<T>(name, fallback);

const folderFor = (file: string) =>
  vscode.workspace.getWorkspaceFolder(vscode.Uri.file(file))?.uri.fsPath ?? path.parse(file).root;

function* ancestorsOf(file: string, stopAt: string): Generator<string> {
  for (let dir = path.dirname(file); ; dir = path.dirname(dir)) {
    yield dir;
    if (dir === stopAt || dir === path.dirname(dir)) return;
  }
}

// the nearest folder with a Vite config: the project whose build the file is part of
export const projectRootFor = (file: string) => {
  for (const dir of ancestorsOf(file, folderFor(file))) if (configIn(dir)) return dir;
  return null;
};

export const workingDirectoryFor = (file: string) => projectRootFor(file) ?? path.dirname(file);

const binOf = (manifestFile: string) => {
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as { bin: Record<string, string> };
  return path.join(path.dirname(manifestFile), manifest.bin["in-source-companion"]!);
};

const cliFor = (root: string) => {
  const configured = setting("cliPath", "");
  if (configured) return path.resolve(root, configured);
  try {
    return binOf(createRequire(path.join(root, "package.json")).resolve("in-source-companion/package.json"));
  } catch {
    return null;
  }
};

export class NoCompanion extends Error {
  constructor(root: string) {
    super(`The in-source-companion package is not installed in ${root}. Install it, or set inSourceCompanion.cliPath.`);
  }
}

export type Ran = { code: number; stdout: string; stderr: string };

export function runCompanion(root: string, args: string[]): Promise<Ran> {
  const cli = cliFor(root);
  if (!cli) return Promise.reject(new NoCompanion(root));
  return new Promise((resolve, reject) => {
    const child = spawn(setting("nodePath", "node"), [cli, ...args], { cwd: root });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
  });
}
