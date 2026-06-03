import { resolve } from "path";
import dts from "vite-plugin-dts";
import { configDefaults, defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  test: {
    // Stale agent worktrees under .claude/ (gitignored) hold old copies of the
    // test suite; without this, vitest discovers and runs them too.
    exclude: [...configDefaults.exclude, "**/.claude/**"],
  },
  build: {
    sourcemap: true,
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        node: resolve(__dirname, "src/node.ts"),
      },
      name: "cacophony",
      formats: ["es", "cjs"],
      fileName: (format, entryName) => {
        switch (format) {
          case "es":
            return `${entryName}.mjs`;
          case "cjs":
            return `${entryName}.cjs`;
          default:
            return `${entryName}.${format}.js`;
        }
      },
    },
    rollupOptions: {
      // node-web-audio-api is a native, optional peer dep — it must never be
      // bundled (and it isn't in pkg.dependencies, so add it explicitly).
      external: [...Object.keys(pkg.dependencies), "node-web-audio-api", /^node:.*/],
    },
    target: "esnext",
  },
  plugins: [dts()],
});
