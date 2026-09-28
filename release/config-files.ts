import fs from "node:fs";
import path from "node:path";

const CONFIG_FILES = ["ts", "mts", "cts", "js", "mjs", "cjs"].map((ext) => `vite.config.${ext}`);

export const configIn = (dir: string) =>
  CONFIG_FILES.map((name) => path.join(dir, name)).find((file) => fs.existsSync(file)) ?? null;
