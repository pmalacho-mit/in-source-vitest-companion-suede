import { build } from "esbuild";

// in-source tests are dead code in a build; esbuild drops a dead branch only when minifying syntax
const scrubbingTests = { define: { "import.meta.vitest": "undefined" }, minifySyntax: true };

// a webview is handed JSON, and decodes it with the codec the test encoded with
await build({
  entryPoints: ["../packages/in-source-companion/src/codec.ts"],
  bundle: true,
  outfile: "dist/codec.js",
  platform: "browser",
  target: "es2022",
  format: "esm",
  ...scrubbingTests,
  logLevel: "info",
});

await build({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "dist/extension.js",
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["vscode"],
  ...scrubbingTests,
  sourcemap: true,
  logLevel: "info",
});
