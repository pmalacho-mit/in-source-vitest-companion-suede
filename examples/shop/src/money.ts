export const formatCents = (cents: number) =>
  `${cents < 0 ? "-" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;

  test("formats dollars and cents", () => expect(formatCents(1234)).toBe("$12.34"));
  test("keeps the sign in front", () => expect(formatCents(-5)).toBe("-$0.05"));
}
