import { resolve } from "path";
import dts from "vite-plugin-dts";
import { configDefaults, defineConfig } from "vitest/config";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  test: {
    // Stale agent worktrees under .claude/ (gitignored) hold old copies of the
    // test suite; without this, vitest discovers and runs them too.
    exclude: [...configDefaults.exclude, "**/.claude/**", "browser-tests/**"],
  },
  build: {
    sourcemap: true,
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        node: resolve(__dirname, "src/node.ts"),
        "cli/index": resolve(__dirname, "src/cli/index.ts"),
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
      // Never bundle runtime deps. Optional dependencies and peers are loaded
      // only by the feature paths that need them, so externalize those keys too.
      external: [
        ...Object.keys(pkg.dependencies),
        ...Object.keys(pkg.optionalDependencies ?? {}),
        ...Object.keys(pkg.peerDependencies ?? {}),
        /^node:.*/,
      ],
    },
    target: "esnext",
  },
  plugins: [
    dts({
      // Worklet processor sources are not declaration inputs, but every public
      // module exported from src/index.ts must be emitted into the package.
      include: [
        "src/*.ts",
        "src/cli/**/*.ts",
        "src/meters/**/*.ts",
        "src/spatial/**/*.ts",
        "src/processors/timestretch-core.ts",
      ],
      exclude: ["src/**/*.test.ts", "src/setupTests.ts"],
    }),
  ],
});
