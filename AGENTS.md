# Working on In-Source Companion

Read `PLAN.md` first for what this is and why. This file covers how the code is laid out, how to work on it, and where the first pass stops.

## Layout

| Path | What it is |
| --- | --- |
| `./release/blocks.ts` | Finding and deleting `if (import.meta.vitest)` blocks with the TypeScript parser |
| `…/test-only.ts` | Top-level statements only the tests use (transitively), with the quick fix that moves them into the block |
| `…/check-scrub.ts` | The build comparison: shipped vs. tests deleted, then per file, then per statement |
| `…/describe-report.ts` | A check report as text: shared by the CLI and the extension's output channel |
| `…/isolate.ts` | One test as a standalone file |
| `…/display.ts`, `artifact.ts`, `codec.ts` | The runtime `display()`, the artifact it records, and the encoding for values JSON can't carry |
| `…/reporter.ts`, `plugin.ts` | The reporter writing `.in-source-companion/displays.json`, and the plugin adding it |
| `…/cli.ts` | `check-scrub` and `isolate` |
| `…/config-files.ts`, `import-meta-vitest.ts` | Dependency-free pieces the extension also imports |
| `vscode-extension/src` | Display store, panels and lenses; scrub diagnostics and quick fixes; Isolate Test; the page renderer |
| `examples/shop` | A project using all three features. Its `check-scrub` passes. |

The extension never parses code. It runs the library's CLI in the project (`companion.ts`) and reads JSON. It imports only types and the dependency-free modules from the library, so its bundle stays around 20 KB.

## Commands

```sh
npm test               # every test: in-source ones in packages/*/src and vscode-extension/src, plus packages/*/test
npm run typecheck      # the library, the example, and the extension
npm run check-scrub    # the example project's build
cd vscode-extension && node build.mjs && node install.mjs   # build, package, install into code/codium
```

Tests are in-source wherever the code is pure. Anything that builds a fixture project or runs Vitest lives in `packages/in-source-companion/test/`.

## Conventions

The user's style guide applies to everything here:

- Keep functions short; about ten lines should reveal intent. Split into well-named functions whose call order documents the intent.
- Wherever a comment wants to go, put a name instead. A comment introducing a block is an extraction boundary.
- Split shape (parsing, pairing) from judgement (is it acceptable?).
- Building a message is not control flow. Move messages out, so what remains reads as the rule.
- Name a condition worth explaining as a predicate.
- Put helpers next to the data they interpret. Group related functions on an object rather than prefixing names, and avoid grab-bags.
- Two spellings of the same rule must call the same function.
- Hide bookkeeping (cursors, accumulators) in generators.
- Codify expectations (required parameters, thrown errors) instead of documenting them.
- Extract only when the name says more than the body.
- Comments are a liability: never describe how consumers use a module; keep them for a single surprising line.

Two traps specific to this repo:

- **Vitest collects any `includeSource` file whose text contains `import.meta.vitest`.** A module that merely mentions it, in a message or a search, is treated as a test file. Use `IMPORT_META_VITEST` from `import-meta-vitest.ts`.
- **esbuild drops a dead `if` only with `minifySyntax`.** `vscode-extension/build.mjs` sets it, or the extension's own in-source tests ship in its bundle.

## Verified, and not yet

Verified by tests or by running it:

- `check-scrub` on four fixtures: scrubbed, leaking (reports the helper import and a side-effecting declaration, not a pure constant), no `define`, no config. It also passes on `examples/shop`.
- A display end to end through a real Vitest run:
  - the recorded line;
  - the page resolved beside the test;
  - `Set` and metadata round-tripping through the codec;
  - a missing page failing its test;
  - the reporter surviving `--reporter` on the command line.
- Isolate: files isolated from the example, including one inside a `describe` and one using `display()`, run and pass under Vitest.
- The extension type-checks, builds, and activates against a stub `vscode` module, registering all three commands.

Not yet tried in a live editor:

- The Display lens and panel.
- The scrub diagnostics, quick fixes and status bar item.
- Isolate Test from the Test Explorer's context menu. This depends on the official extension's test items carrying a `range` that starts on the test's line.
- Whether the official extension's runs include the display reporter. Its bundle keeps config reporters, and ours is added in `configureVitest`, so they should.

## Known limits

- **The package can't be installed from npm yet.** Its exports point at `.ts` files. Node runs those directly, except inside `node_modules`. Publishing needs a compile step.
- **`check-scrub` does 2 + N + M builds** (N files responsible, M candidate statements in them), plus 2 unminified builds for readable messages. That's fine for small projects, but it needs a budget or caching for large ones. The extension debounces on save and runs one check per project at a time.
- **Test-only analysis is by name, not by symbol.** A shadowed name counts as a use, which can hide a candidate but never invents one. Every reported statement is confirmed by a build either way.
- **Isolate finds code by name too, and keeps top-level statements with side effects.** It handles `test`/`it` and `describe`/`suite`, including renamed destructuring. It does not handle `test.each` tables specially, and it rebuilds a suite's closing as `});`.
- **Quick-fix positions come from the last check.** They're offered only while the document is unchanged since then.

## Next steps

1. Install the extension (`node vscode-extension/install.mjs`) and try each item under "Not yet tried", on `examples/shop`.
2. Add a compile step (`tsc` with `rewriteRelativeImportExtensions`, or a bundler) so the package can be published.
3. Decide how `check-scrub` should scale: a file budget, reusing builds, or checking only the files changed since the last check.
