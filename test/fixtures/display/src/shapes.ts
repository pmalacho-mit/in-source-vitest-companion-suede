export const squares = (n: number) => Array.from({ length: n }, (_, i) => i * i);

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  const { display } = await import("../../../../src/display.ts");

  test("squares", async ({ task }) => {
    const actual = squares(4);
    await display(task, "./pages/bars.html", { actual, expected: new Set([0, 1, 4, 9]), meta: { unit: "px" } });
    expect(actual).toEqual([0, 1, 4, 9]);
  });

  test("a page that is not there fails the test", async ({ task }) => {
    await display(task, "./pages/missing.html", { actual: 1 });
  });
}
