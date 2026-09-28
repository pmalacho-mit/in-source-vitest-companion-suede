export function histogram(xs: readonly number[], buckets: number, min: number, max: number): Uint32Array {
  const counts = new Uint32Array(buckets);
  const width = (max - min) / buckets;
  for (const x of xs) {
    const bucket = Math.min(buckets - 1, Math.max(0, Math.floor((x - min) / width)));
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  const { display } = await import("in-source-companion/display");

  test("spreads evenly", () => {
    expect(Array.from(histogram([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 5, 0, 10))).toEqual([2, 2, 2, 2, 2]);
  });

  test("clamps what falls outside", () => {
    expect(Array.from(histogram([-100, 100], 2, 0, 10))).toEqual([1, 1]);
  });

  test("shows a skewed distribution as bars", async ({ task }) => {
    const actual = Array.from(histogram([1, 1, 1, 2, 3, 5, 8, 13], 4, 0, 16));
    const expected = [5, 1, 1, 1];
    await display(task, "./fixtures/histogram.html", { actual, expected });
    expect(actual).toEqual(expected);
  });
}
