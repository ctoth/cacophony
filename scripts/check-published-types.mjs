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
    `import { Cacophony, type RuntimeOptions, type BaseSound, type Playback, type Sound, type Group, type Synth, type PlayOptions, type SendGainOptions, type AudioSinkId, type DeviceChangeEvent, timeStretch } from "cacophony";

declare const playback: Playback;
const baseSound: BaseSound = playback;
const position = playback.position;
const isPlaying: boolean = playback.isPlaying;
const stretched: Float32Array = timeStretch(new Float32Array(8), 1);
declare const sound: Sound;
declare const group: Group;
declare const synth: Synth;
const options: PlayOptions = { volume: 0, playbackRate: 2, loopCount: 0, panType: "HRTF", position: [10, 0, 5], threeDOptions: { rolloffFactor: 0.1 } };
const voice: Playback = sound.play(options)[0];
const selected: Playback | undefined = group.playOrdered(true, options);
group.playRandom({ panType: "stereo", stereoPan: 0 });
group.play(options);
playback.play(options);
synth.play({ volume: 0.5, panType: "stereo", stereoPan: 0 });
const sendOptions: SendGainOptions = { duration: 250, type: "exponential" };
sound.routeTo("aux", 0.5, sendOptions);
group.routeTo("aux", 0, sendOptions);
synth.routeTo("aux", 0.2, sendOptions);
sound.removeSend("aux");
group.removeSend("aux");
synth.removeSend("aux");
const runtime: RuntimeOptions = { spatialSmoothingTau: 0.03, autoRecover: false };
const audio = new Cacophony(undefined, undefined, runtime);
const sinkId: AudioSinkId = { type: "none" };
const selection: Promise<void> = audio.setOutputDevice(sinkId);
const currentSink: AudioSinkId | undefined = audio.outputDevice;
audio.on("sinkChange", ({ sinkId }) => { const sink: AudioSinkId = sinkId; void sink; });
audio.on("devicechange", (event) => { const inventory: DeviceChangeEvent = event; void inventory; });
audio.on("interrupted", (event) => { const payload: undefined = event; void payload; });
audio.dispose();
audio.listenerSmoothingTau = 0.04;
const defaultTau: number = audio.spatialSmoothingTau;
sound.spatialSmoothingTau = 0.05;
synth.spatialSmoothingTau = 0.02;
playback.spatialSmoothingTau = 0.1;
const smoothedVoice: Playback = playback.clone({ spatialSmoothingTau: 0.02, position: [1, 2, 3] });
sound.clone({ spatialSmoothingTau: 0 });
synth.clone({ spatialSmoothingTau: 0.03 });

void [baseSound, position, isPlaying, stretched, voice, selected, defaultTau, smoothedVoice, selection, currentSink];
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
