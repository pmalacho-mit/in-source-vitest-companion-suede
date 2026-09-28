# In-Source Companion: plan

Keep Vitest's [in-source tests](https://vitest.dev/guide/in-source.html) and the official Vitest VS Code extension. Add the three things they don't do: display pages, isolating a test into a standalone file, and a check that production builds really drop the tests.

This plan came out of an earlier project, `typescript-namespace-tests-suede`, which wrote tests as TypeScript types and printed them as Vitest code. Its printer, cache and per-test module forking are not carried over. Its display page renderer, value codec and code-pruning ideas are.

## What to build, and what not to

The official extension (`vitest.explorer`, checked at 1.52.1) already covers most of what an editor needs:

| Need | Where it comes from |
| --- | --- |
| Run, debug, see failure diffs | Official: Test Explorer, gutter, inline errors |
| See the module Vitest runs | Official: `vitest.openTransformedModule` |
| Run tests when opened | Official: `vitest.watchOnStartup` runs everything continuously. It isn't per file on open, but it's close. |
| Display pages | This project: feature A |
| Verified scrubbing | This project: feature B |
| Isolate a test | This project: feature C |

## Feature B: verify that the tests are scrubbed

Checking that a test block looks self-contained isn't enough. This file was built with Vite 8 and `define: { "import.meta.vitest": "undefined" }`:

```ts
import { formatCents } from "./money";
import { fixture } from "./helper";        // only the tests use this
const TEST_ONLY_TABLE = [[1, "$0.01"]];   // only the tests use this
export const receipt = (c: number) => formatCents(c);
if (import.meta.vitest) { /* uses fixture and TEST_ONLY_TABLE */ }
```

What shipped:

```js
//#region src/helper.ts
console.log("helper loaded");
//#endregion
//#region src/cart.ts
var receipt = (c) => formatCents(c);
```

The block and `TEST_ONLY_TABLE` were removed, but the side effect of an import only the tests use reached production. In a `.ts` file, the TypeScript transform drops an import whose bindings are unused, but it runs before `define`. So while the block exists, the import counts as used and survives. In a `.js` file the import is never dropped (checked: an unused named import in `.js` keeps its module's side effects, as does a bare `import "./x"`). Without the `define`, the whole block ships.

The same thing happened to this project's own extension. esbuild keeps `if (undefined) { … }` unless `minifySyntax` is on, so its in-source tests shipped in the bundle until `build.mjs` turned that on.

### The check

"Scrubbed" means: **the production build is identical to the build of the same code with the tests deleted.** The tests are the `if (import.meta.vitest)` blocks plus the top-level statements that only those blocks use.

1. Load the project's own Vite config and build it as configured, without writing anything. This is build A.
2. Build again with one extra plugin, run before every other transform, that deletes the tests. This is build B.
3. Compare every output file. They must be byte-identical.
4. If they differ, delete the tests one file at a time to find the files responsible.
5. In a responsible file, delete each test-only statement, together with the test-only statements that depend on it. A statement is reported only if its deletion changes build A. Pure code the bundler already drops (like `TEST_ONLY_TABLE`) is never reported.
6. Each reported statement comes with a quick fix: move it into the block. An import becomes `await import()`.

The candidates come from static analysis, but every report is confirmed by a build. The verdict uses the project's real config, including minification. Messages quote lines from an unminified build, so they're readable.

It runs as `in-source-companion check-scrub` in CI, where it exits non-zero, and in the extension on save, as diagnostics.

Two cases fail with a reason instead: a config without the `define`, where every block ships, and a project with no Vite config.

## Feature A: display pages

A test records its values with Vitest 5's `recordArtifact`:

```ts
if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  const { display } = await import("in-source-companion/display");

  test("histogram", async ({ task }) => {
    const actual = Array.from(histogram([1, 1, 1, 2, 3, 5, 8, 13], 4, 0, 16));
    await display(task, "./fixtures/histogram.html", { actual, expected: [5, 1, 1, 1] });
    expect(actual).toEqual([5, 1, 1, 1]);
  });
}
```

- **The helper stays out of builds.** It is imported inside the block, so it is removed along with the tests, and feature B confirms that.
- **A missing page fails the test**, at the `display(...)` line, naming where it looked.
- **Vitest records each artifact's location**, taken from the first stack frame in the test file. That is the line of the `display(...)` call, where the lens goes.
- **The official extension ignores custom artifacts.** Its bundle handles annotations, not `onTestArtifactRecord`. So the plugin adds a reporter that writes them to `.in-source-companion/displays.json` beside the Vitest root. That folder ignores itself in git.
- **The reporter survives command-line flags.** It is added in the plugin's `configureVitest` hook, which runs after `--reporter` from the command line is merged and before reporters are created. A reporter added in the `config` hook is replaced by `--reporter` on the command line.
- **The official extension keeps config reporters.** Its bundle arrayifies `test.reporters` and appends its own, so the display reporter should run inside its runs too. This has not been tried live yet.

## Feature C: isolate a test

Given a line inside a test, write a standalone test file beside the module. It contains:

- the test, inside any `describe` suites that hold it, with sibling tests removed;
- the test block's setup that the test reaches (hooks always stay), with the `import.meta.vitest` destructuring turned into `import { … } from "vitest"`;
- the module code the test reaches, found by name, with imports trimmed to the bindings used and `export` removed.

The file is named `<module>.<test name>.isolated.test.ts`, so Vitest's default `include` runs it. The code is copied rather than imported, because importing the module would register its in-source tests again.

Fresh module state per test (a `vi.resetModules()` helper) was the other meaning of "isolate". It is out of scope.

## Where it lives

```
in-source-companion/
  packages/in-source-companion/   one library package, with subpath exports:
    in-source-companion/display     display(): imported inside test blocks
    in-source-companion/vite        the plugin: adds the display reporter, warns when a build ships tests
    in-source-companion (bin)       check-scrub and isolate
  vscode-extension/               Display lens and panel, scrub diagnostics and quick fixes, Isolate Test
  examples/shop/                  a small project using all three
```

The plan originally had three packages. One package with subpath exports turned out simpler to install and to resolve from the extension.

## Milestones

| # | Milestone | Status |
| --- | --- | --- |
| 1 | `check-scrub` CLI with fixtures: clean, leaking, no `define`, no config | Done, tested |
| 2 | Does the official extension keep config reporters? | Answered from its bundle. Not yet confirmed live. |
| 3 | Display pages end to end: runtime, reporter, panel, lens, missing-page check | Done. Reporter tested end to end. Panel and lens not tried in a live editor. |
| 4 | Scrub diagnostics in the editor, with the move-into-block quick fix | Done. Not tried in a live editor. |
| 5 | Isolate: standalone file | Done, tested. Isolated demo tests run and pass. |

## Open questions

- Name and location of the repository.
- Is Vite the only bundler to check against? It is the one the Vitest config already describes.
- How to publish: the package's exports point at `.ts` sources, which Node runs directly (23.6+) but refuses inside `node_modules`. A compile step is needed before it can be installed from npm.
