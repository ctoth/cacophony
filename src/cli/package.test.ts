import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};

describe("CLI package metadata", () => {
  it("ships the Node Web Audio backend as an optional dependency", () => {
    // Loaded lazily via dynamic import in src/node.ts so browser-only consumers
    // never pull in the native package, and a failed native build degrades to
    // "Node backend unavailable" instead of bricking `npm i cacophony`.
    expect(pkg.optionalDependencies).toHaveProperty("node-web-audio-api");
    expect(pkg.dependencies).not.toHaveProperty("node-web-audio-api");
    expect(pkg.devDependencies).not.toHaveProperty("node-web-audio-api");
  });
});
