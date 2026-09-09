import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import commonjs from "@rollup/plugin-commonjs";
import resolve from "@rollup/plugin-node-resolve";
import { rollup } from "rollup";

// Exercise the published ESM graph as a consumer, including runtime dependencies.
// Build the package first. Nothing is written to dist by these checks.
const entry = fileURLToPath(new URL("../dist/index.mjs", import.meta.url)).replaceAll("\\", "/");
const reportOnly = process.argv.includes("--report");

for (const name of ["AudioCache", "Cacophony", "ReverbEffect"]) {
  const bundle = await rollup({
    input: "\0consumer",
    external: ["hls.js", "standardized-audio-context", "node-web-audio-api", /^node:/],
    plugins: [
      {
        name: "consumer-fixture",
        resolveId(id) {
          if (id === "\0consumer") return id;
        },
        load(id) {
          if (id === "\0consumer") return `export { ${name} } from ${JSON.stringify(entry)};`;
        },
      },
      resolve({ browser: true, preferBuiltins: false }),
      commonjs(),
    ],
    onwarn(warning, warn) {
      if (warning.code === "UNRESOLVED_IMPORT") throw new Error(warning.message);
      if (warning.code !== "CIRCULAR_DEPENDENCY" && warning.code !== "THIS_IS_UNDEFINED") warn(warning);
    },
  });
  try {
    const { output } = await bundle.generate({ format: "es" });
    const chunks = output.filter((item) => item.type === "chunk");
    const initial = new Set();
    function visit(fileName) {
      if (initial.has(fileName)) return;
      const chunk = chunks.find((item) => item.fileName === fileName);
      if (!chunk) return; // External imports are not emitted chunks.
      initial.add(fileName);
      chunk.imports.forEach(visit);
    }
    chunks.filter((chunk) => chunk.isEntry).forEach((chunk) => visit(chunk.fileName));
    const initialChunks = chunks.filter((chunk) => initial.has(chunk.fileName));
    const code = initialChunks.map((chunk) => chunk.code).join("\n");
    const modules = initialChunks.flatMap((chunk) => Object.keys(chunk.modules));
    const mediaIsEager = modules.some((id) => id.replaceAll("\\", "/").includes("/mediabunny/"));
    const fftIsEager = modules.some((id) => id.replaceAll("\\", "/").includes("/fft.js/"));
    const workletsAreEager = /data:(?:text|application)\/javascript[^,]*;base64,/.test(code);
    console.log(
      JSON.stringify({
        fixture: name,
        initialBytes: Buffer.byteLength(code),
        initialGzipBytes: gzipSync(code).byteLength,
        lazyChunks: chunks.length - initialChunks.length,
        mediaIsEager,
        fftIsEager,
        workletsAreEager,
      }),
    );
    if (!reportOnly) {
      assert.equal(mediaIsEager, false, `${name} eagerly bundles MediaBunny`);
      assert.equal(workletsAreEager, false, `${name} eagerly bundles worklet payloads`);
      if (name !== "Cacophony") {
        assert.equal(fftIsEager, false, `${name} retains unrelated offline FFT code`);
        assert.ok(Buffer.byteLength(code) < 40_000, `${name} retains unrelated library code`);
      } else {
        assert.ok(
          chunks.some((chunk) => !initial.has(chunk.fileName) &&
            Object.keys(chunk.modules).some((id) => id.replaceAll("\\", "/").includes("/mediabunny/"))),
          "Streaming must retain MediaBunny in a lazy chunk",
        );
      }
    }
  } finally {
    await bundle.close();
  }
}

// CommonJS cannot be tree-shaken like ESM, but require() must still defer the
// media dependency and processor payloads. Check the actual emitted modules.
if (!reportOnly) {
  const require = createRequire(import.meta.url);
  const before = new Set(Object.keys(require.cache));
  assert.equal(typeof require("../dist/index.cjs").Cacophony, "function");
  const loaded = Object.keys(require.cache)
    .filter((id) => !before.has(id))
    .map((id) => id.replaceAll("\\", "/"));
  assert.ok(!loaded.some((id) => id.includes("/mediabunny/")), "CommonJS eagerly loads MediaBunny");
  assert.ok(!loaded.some((id) => id.includes("/dist/bundles/")), "CommonJS eagerly loads worklet payloads");
  const { ALL_WORKLETS } = require("../dist/worklets.cjs");
  for (const worklet of ALL_WORKLETS) {
    const url = await worklet.url();
    assert.match(url, /^data:(?:text|application)\/javascript[^,]*;base64,/, `${worklet.name} did not resolve a data URL`);
  }
  console.log("CommonJS lazy import and worklet URL checks passed.");
}
