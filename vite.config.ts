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
      entry: resolve(__dirname, "src/index.ts"),
      name: "cacophony",
      formats: ["es", "cjs"],
      fileName: (format) => {
        switch (format) {
          case "es":
            return "index.mjs";
          case "cjs":
            return "index.cjs";
          default:
            return `index.${format}.js`;
        }
      },
    },
    rollupOptions: {
      external: [...Object.keys(pkg.dependencies), /^node:.*/],
    },
    target: "esnext",
  },
  plugins: [dts()],
});
