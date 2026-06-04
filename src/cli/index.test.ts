import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run } from "./index";

const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string };

describe("CLI dispatch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints the package version for --version", async () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);

    await expect(run(["--version"])).resolves.toBe(0);

    expect(write).toHaveBeenCalledWith(`${pkg.version}\n`);
  });
});
