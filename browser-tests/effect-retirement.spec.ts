import { expect, test } from "@playwright/test";

for (const kind of ["fdn", "reverb", "delay"]) {
  test(`${kind} removal permanently stops its processor`, async ({ page }) => {
    await page.goto("/browser-tests/effect-retirement.html");
    const result = await page.evaluate(async (kind) => {
      const fixture = window as unknown as {
        testEffectRetirement(kind: string): Promise<{ retainedFilters: number; retiredPeak: number }>;
      };
      return fixture.testEffectRetirement(kind);
    }, kind);
    expect(result.retainedFilters).toBe(0);
    expect(result.retiredPeak).toBe(0);
  });
}
