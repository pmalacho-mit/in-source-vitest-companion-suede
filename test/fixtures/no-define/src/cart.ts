import { formatCents } from "./money";

export const receipt = (lines: number[]) => formatCents(lines.reduce((a, b) => a + b, 0));

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  const { fixture } = await import("./helper");
  test("receipt", () => expect(receipt(fixture)).toBe("$13.49"));
}
