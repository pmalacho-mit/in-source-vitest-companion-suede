# In-Source Companion

Tools for Vitest's [in-source tests](https://vitest.dev/guide/in-source.html) that the official Vitest extension doesn't provide:

- **Display pages.** A test hands its values to an HTML page of your own, such as a chart, shown beside the code.
- **A build-verified scrub check.** It builds your project twice, once as configured and once with the tests deleted, and fails if the two builds differ. It then names the statement responsible and offers a quick fix.
- **Isolate Test.** It writes one test out as a standalone Vitest file, holding only the code that test reaches.

Use it alongside the official Vitest extension, which runs and debugs the tests.

## Set up

```ts
// vite.config.ts
import { defineConfig } from "vitest/config";
import inSourceCompanion from "in-source-companion/vite";

export default defineConfig({
  plugins: [inSourceCompanion()],
  define: { "import.meta.vitest": "undefined" },
  test: { includeSource: ["src/**/*.ts"] },
});
```

The plugin adds the reporter that collects display pages. It also warns when a build would ship your tests.

## Display pages

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

The page is found relative to the test file. If it isn't there, the test fails. Import `display` inside the test block, as above, so it's removed from builds with the tests.

In the editor, a **Display** lens appears on the `display(...)` line once the test has run. The page is shown as the webview's own document. It receives:

```js
window.addEventListener("message", ({ data }) => {
  if (data?.type !== "in-source-companion:result") return;
  // data.actual, data.expected, data.meta: decoded, so a Map is a Map and a bigint a bigint
  // data.passed, data.message
});
```

A page may also post `{ type: "in-source-companion:ready" }` when it's ready. Otherwise the values arrive once it has loaded.

## Check that the tests are scrubbed

```sh
npx in-source-companion check-scrub            # in the folder with vite.config.*
npx in-source-companion check-scrub --json     # the full report
```

```
✗ Tests leak into the production build.

What ships only because of the tests:
  src/helper.ts
    console.log("helper loaded");

src/cart.ts:2:1  Only the tests use `fixture`, but importing it here keeps `console.log("helper loaded");` (src/helper.ts) in the production build. Import it inside the test block instead.
```

It exits with 0 when the builds match, 1 when they don't, and 2 when there's no Vite config. In the editor, the same check runs when you save a file with in-source tests. Its findings appear as diagnostics, each with a quick fix that moves the statement into the test block.

## Isolate a test

Right-click a test in the Test Explorer or its gutter icon, or right-click inside a test in the editor, and choose **Isolate Test**. From a terminal:

```sh
npx in-source-companion isolate src/cart.ts --line 31          # print it
npx in-source-companion isolate src/cart.ts --line 31 --write  # write src/cart.prints_a_receipt.isolated.test.ts
```

## Requirements

Vite 8+, Vitest 5+, and Node 23.6+. The package currently ships TypeScript sources, which Node runs directly.

## Developing

```sh
npm install
npm test                   # the library's and the extension's tests, in-source and in test/
npm run typecheck
npm run check-scrub        # check the example project's build
npm run -w in-source-companion-vscode install-extension
```
