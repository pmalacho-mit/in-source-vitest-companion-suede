import { formatCents } from "./money";
import { fixture } from "./helper";

const TABLE = [[1099, "$10.99"]];

const seeded = () => {
  console.log("seeding");
  return [1, 2];
};

const SEEDED = seeded();

export const receipt = (lines: number[]) => formatCents(lines.reduce((a, b) => a + b, 0));

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  test("receipt", () => expect(receipt(fixture)).toBe("$13.49"));
  test("table", () => expect(receipt([TABLE[0]![0] as number])).toBe(TABLE[0]![1]));
  test("seeded", () => expect(SEEDED).toHaveLength(2));
}
