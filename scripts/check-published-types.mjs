import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const tempRoot = mkdtempSync(join(tmpdir(), "cacophony-package-types-"));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: packageRoot,
    encoding: "utf8",
    shell: process.platform === "win32" && command.endsWith(".cmd"),
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    throw new Error(`${command} exited with status ${result.status}`);
  }
  return result.stdout;
}

try {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const packOutput = run(npm, ["pack", "--dry-run", "--ignore-scripts", "--json"]);
  const [manifest] = JSON.parse(packOutput);
  if (!manifest?.files?.length) {
    throw new Error("npm pack did not report any package files");
  }

  const installedPackage = join(tempRoot, "node_modules", "cacophony");
  for (const { path: packedPath } of manifest.files) {
    const source = resolve(packageRoot, packedPath);
    const sourceRelative = relative(packageRoot, source);
    if (isAbsolute(sourceRelative) || sourceRelative.startsWith(`..${sep}`) || sourceRelative === "..") {
      throw new Error(`npm pack reported a path outside the package: ${packedPath}`);
    }
    const destination = join(installedPackage, packedPath);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }

  writeFileSync(join(tempRoot, "package.json"), JSON.stringify({ private: true, type: "module" }));
  writeFileSync(
    join(tempRoot, "index.ts"),
    `import { type BaseSound, type Playback, timeStretch } from "cacophony";

declare const playback: Playback;
const baseSound: BaseSound = playback;
const position = playback.position;
const isPlaying: boolean = playback.isPlaying;
const stretched: Float32Array = timeStretch(new Float32Array(8), 1);

void [baseSound, position, isPlaying, stretched];
`,
  );
  writeFileSync(
    join(tempRoot, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        lib: ["ESNext", "DOM"],
        module: "ESNext",
        moduleResolution: "Bundler",
        noEmit: true,
        skipLibCheck: false,
        strict: true,
        target: "ESNext",
      },
      files: ["index.ts"],
    }),
  );

  const tsc = join(packageRoot, "node_modules", "typescript", "bin", "tsc");
  const result = spawnSync(process.execPath, [tsc, "--project", join(tempRoot, "tsconfig.json")], {
    cwd: tempRoot,
    encoding: "utf8",
  });
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`packed-package type consumer failed with status ${result.status}`);
  }

  console.log(`Packed-package type consumer passed (${manifest.files.length} files).`);
} finally {
  const resolvedTemp = resolve(tempRoot);
  const resolvedTempParent = `${resolve(tmpdir())}${sep}`;
  if (!resolvedTemp.startsWith(resolvedTempParent)) {
    throw new Error(`Refusing to remove unexpected temporary directory: ${resolvedTemp}`);
  }
  rmSync(resolvedTemp, { recursive: true, force: true });
}
