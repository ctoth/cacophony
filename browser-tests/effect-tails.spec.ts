import { expect, test } from "@playwright/test";

type Window2 = { left: number; right: number };
type TailRender = { ended: Window2; before: Window2; after: Window2; late: Window2 };

declare global {
  interface Window {
    renderEffectTail(
      kind: "fdn" | "reverb" | "delay",
    ): Promise<{ supported: false } | { supported: true; render: TailRender | null }>;
  }
}

async function renderTail(
  page: import("@playwright/test").Page,
  browserName: string,
  kind: "fdn" | "reverb" | "delay",
): Promise<TailRender | undefined> {
  await page.goto("/browser-tests/effect-tails.html");
  const result = await page.evaluate((kind) => window.renderEffectTail(kind), kind);
  test.skip(
    !result.supported && process.platform === "win32" && browserName !== "chromium",
    "OfflineAudioContext unavailable in this browser",
  );
  expect(result.supported).toBe(true);
  if (!result.supported) return undefined;
  test.skip(result.render === null && browserName !== "chromium", "This engine does not expose offline suspend/resume");
  expect(result.render).not.toBeNull();
  return result.render ?? undefined;
}

// Every effect that carries a tail must keep rendering it once its input has
// ended and been disconnected (#255). Add new tail-bearing effects here.
for (const kind of ["fdn", "reverb", "delay"] as const) {
  test(`${kind} tail keeps decaying after its input is disconnected`, async ({ page, browserName }) => {
    const render = await renderTail(page, browserName, kind);
    if (!render) return;
    for (const channel of ["left", "right"] as const) {
      if (render.before[channel] === 0) continue; // this effect leaves that channel silent throughout
      // No truncation and no jump across the disconnect: adjacent 50 ms windows
      // of a decaying tail differ by its decay only.
      const acrossCleanup = render.after[channel] / render.before[channel];
      expect(acrossCleanup).toBeGreaterThan(0.1);
      expect(acrossCleanup).toBeLessThan(1.5);
      expect(render.late[channel]).toBeGreaterThan(0);
      expect(render.late[channel]).toBeLessThan(render.after[channel] * 1.5);
    }
    expect(render.before.left + render.before.right).toBeGreaterThan(0);
  });
}

test("fdn reverb is diffuse for a hard-panned input", async ({ page, browserName }) => {
  const render = await renderTail(page, browserName, "fdn");
  if (!render) return;
  for (const name of ["ended", "before", "after", "late"] as const) {
    const balance = render[name].right / render[name].left;
    expect(balance).toBeGreaterThan(0.5);
    expect(balance).toBeLessThan(2);
  }
});
