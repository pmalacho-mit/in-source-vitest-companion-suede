import { formatCents } from "./money.ts";

export class Cart {
  readonly lines: number[] = [];

  add(cents: number): this {
    this.lines.push(cents);
    return this;
  }

  get total(): number {
    return this.lines.reduce((sum, line) => sum + line, 0);
  }

  receipt(): string {
    return formatCents(this.total);
  }
}

if (import.meta.vitest) {
  const { test, expect, describe } = import.meta.vitest;
  const { lines } = await import("./fixtures/lines.ts");

  describe("Cart", () => {
    test("totals its lines", () => {
      const cart = new Cart();
      for (const line of lines) cart.add(line);
      expect(cart.total).toBe(1349);
    });

    test("prints a receipt", () => {
      expect(new Cart().add(1099).add(250).receipt()).toBe("$13.49");
    });
  });
}
