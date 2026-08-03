import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import rollupConfigs from "../rollup.config.js";
import { WORKLETS } from "./worklets";

describe("build hygiene", () => {
  it("bundles exactly the processors registered in WORKLETS", () => {
    const expectedInputs = Object.values(WORKLETS).map(({ name }) => `src/processors/${name}.ts`);
    const actualInputs = rollupConfigs.map(({ input }) => input);

    expect(actualInputs).toEqual(expectedInputs);
  });

  it("uses a relative import for BasePlayback in the playback container", () => {
    const containerSource = readFileSync(join(process.cwd(), "src", "container.ts"), "utf8");

    expect(containerSource).toContain('from "./basePlayback"');
    expect(containerSource).not.toContain('from "basePlayback"');
  });

  it("keeps generated worklet bundles out of version control", () => {
    const gitignore = readFileSync(join(process.cwd(), ".gitignore"), "utf8");

    expect(gitignore.split(/\r?\n/)).toContain("src/bundles/");
  });
});
