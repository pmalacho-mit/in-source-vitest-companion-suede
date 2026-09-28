const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const nonce = (random = Math.random) =>
  random().toString(36).slice(2).padEnd(8, "0").slice(0, 8);

export type Sources = { base: string; csp: string; codec: string };

export const MESSAGES = {
  ready: "in-source-companion:ready",
  encoded: "in-source-companion:encoded",
  result: "in-source-companion:result",
} as const;

// an editor in a browser hides `window.parent` from a webview; a page announcing
// itself through it is pointed at its own window, where the bootstrap listens
const giveEveryPageAParent = `
  if (!window.parent) {
    try { window.parent = window; } catch {}
    if (!window.parent)
      try { Object.defineProperty(window, "parent", { value: window, configurable: true }); } catch {}
  }`;

const announceReadyOnce = `
  let announced = false;
  const announce = () => {
    if (announced) return;
    announced = true;
    vscode.postMessage({ type: "ready" });
  };`;

// only JSON crosses into a webview, so a `Map` or a `bigint` arrives encoded
const decodeWhatArrives = `
  window.addEventListener("message", async ({ data }) => {
    if (data?.type === "${MESSAGES.ready}") announce();
    else if (data?.type === "${MESSAGES.encoded}") {
      const { decode } = await codec;
      window.postMessage(
        { ...data, type: "${MESSAGES.result}", actual: decode(data.actual), expected: decode(data.expected), meta: decode(data.meta) },
        "*",
      );
    }
  });`;

const scriptString = (text: string) => JSON.stringify(text).replace(/</g, "\\u003c");

const bootstrap = (codec: string) => `(() => {${giveEveryPageAParent}
  const vscode = acquireVsCodeApi();
  const codec = import(${scriptString(codec)});${announceReadyOnce}${decodeWhatArrives}
  window.addEventListener("load", announce);
})();`;

const policy = ({ csp }: Sources, id: string) =>
  [
    "default-src 'none'",
    `img-src ${csp} data: https:`,
    `font-src ${csp}`,
    `style-src 'unsafe-inline' ${csp}`,
    `script-src 'nonce-${id}' ${csp}`,
    `connect-src ${csp}`,
  ].join("; ");

const asFolder = (url: string) => (url.endsWith("/") ? url : `${url}/`);

const head = (sources: Sources, id: string) =>
  [
    `<meta http-equiv="Content-Security-Policy" content="${policy(sources, id)}" />`,
    `<base href="${escape(asFolder(sources.base))}" />`,
    `<script nonce="${id}">${bootstrap(sources.codec)}</script>`,
  ].join("\n");

const trustingItsScripts = (page: string, id: string) =>
  page.replace(/<script\b(?![^>]*\bnonce=)/gi, `<script nonce="${id}"`);

const doctypeOf = (page: string) => /^\s*<!doctype[^>]*>/i.exec(page)?.[0] ?? "";

// a policy binds only what follows it, but the doctype must stay first
export function render(page: string, sources: Sources, id = nonce()): string {
  const trusted = trustingItsScripts(page, id);
  const doctype = doctypeOf(trusted);
  return `${doctype}\n${head(sources, id)}\n${trusted.slice(doctype.length)}`;
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;

  const page = '<!doctype html>\n<div id="chart"></div>\n<script>window.addEventListener("message", () => {});</script>';
  const html = render(page, { base: "https://r/pages", csp: "https://r", codec: "https://r/codec.js" }, "abc123");

  test("the doctype stays first, so the page is not rendered in quirks mode", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });

  test("the page's relative URLs resolve against its own folder", () => {
    expect(html).toContain('<base href="https://r/pages/" />');
  });

  test("its own scripts run by the nonce they are given, and nothing else may", () => {
    expect(html).toContain('<script nonce="abc123">window.addEventListener');
    expect(html).toContain("script-src 'nonce-abc123' https://r;");
  });

  test("a base that would break out of its attribute cannot", () => {
    const hostile = render("<p></p>", { base: '"><script>alert(1)</script>', csp: "x", codec: "x" }, "abc123");
    expect(hostile).not.toContain("<script>alert(1)");
  });
}
