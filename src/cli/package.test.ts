import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
};

describe("CLI package metadata", () => {
  it("ships the Node Web Audio backend as a runtime dependency", () => {
    expect(pkg.dependencies).toHaveProperty("node-web-audio-api");
    expect(pkg.devDependencies).not.toHaveProperty("node-web-audio-api");
    expect(pkg.peerDependenciesMeta?.["node-web-audio-api"]?.optional).toBeUndefined();
  });
});
