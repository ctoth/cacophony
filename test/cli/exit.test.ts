/**
 * Stage 4 lifecycle tests (NON-VISUAL): spawn the BUILT `bin/cacophony.mjs` as
 * a child process and assert each invocation EXITS within a timeout. A hang is
 * the failure mode we are guarding against — a real-time AudioContext holds a
 * keep-alive timer, so the process only exits if every path reaches
 * `context.close()` (`src/node.ts:11-14`). The DSP itself is already proven by
 * the render tests; here we only prove clean process lifecycle.
 *
 * These spawn real AudioContexts that briefly emit sound — expected on this
 * machine. Each test has a generous timeout and force-kills any orphan.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const bin = resolve(repoRoot, "bin", "cacophony.mjs");

interface SpawnResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  ms: number;
}

/**
 * Spawn the bin with `args`. If `afterMs`/`onTimer` are given, the callback runs
 * once after that delay (used to send SIGINT mid-playback). Rejects only if the
 * child does not exit before `killAfterMs` (the hang guard).
 */
function spawnBin(
  args: string[],
  opts: { stdin?: string; killAfterMs?: number; afterMs?: number; onTimer?: (child: ChildProcess) => void } = {},
): Promise<SpawnResult> {
  const killAfterMs = opts.killAfterMs ?? 8000;
  return new Promise<SpawnResult>((resolvePromise, reject) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [bin, ...args], {
      cwd: repoRoot,
      stdio: ["pipe", "ignore", "ignore"],
    });

    const hangGuard = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`process did not exit within ${killAfterMs}ms (HANG) for: cacophony ${args.join(" ")}`));
    }, killAfterMs);

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (opts.afterMs !== undefined && opts.onTimer) {
      timer = setTimeout(() => opts.onTimer?.(child), opts.afterMs);
    }

    child.on("error", (err) => {
      clearTimeout(hangGuard);
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(hangGuard);
      if (timer) clearTimeout(timer);
      resolvePromise({ code, signal, ms: Date.now() - t0 });
    });

    if (opts.stdin !== undefined) {
      child.stdin?.write(opts.stdin);
      child.stdin?.end();
    }
  });
}

describe("CLI process lifecycle (exit / SIGINT)", () => {
  it("synth --duration 0.3 exits 0", async () => {
    const r = await spawnBin(["synth", "440", "--duration", "0.3"]);
    expect(r.code).toBe(0);
  }, 15000);

  it("play test.ogg --duration 0.2 exits 0", async () => {
    const r = await spawnBin(["play", "test.ogg", "--duration", "0.2"]);
    expect(r.code).toBe(0);
  }, 15000);

  it("repl with piped `synth 440\\nexit\\n` exits 0", async () => {
    const r = await spawnBin(["repl"], { stdin: "synth 440\nexit\n" });
    expect(r.code).toBe(0);
  }, 15000);

  it("synth 440 (no duration) exits promptly on SIGINT", async () => {
    const r = await spawnBin(["synth", "440"], {
      afterMs: 600,
      onTimer: (child) => child.kill("SIGINT"),
    });
    // A clean exit 0 (graceful shutdown ran) OR a prompt signal-terminate is
    // acceptable per the brief; a HANG (rejection above) is the only failure.
    expect(r.code === 0 || r.signal === "SIGINT" || r.code !== null).toBe(true);
  }, 15000);
});

/**
 * Stage 5 end-to-end: drive the REPL over piped stdin to declare a synth + a
 * distortion fx + route, then `render` the session to a WAV (plan R5 replay).
 * Assert the file is a valid, non-silent WAV — proving the command-log replay
 * produced real audio through the built bin. Runs the BUILT bin (imports built
 * dist), so `npx vite build` must precede the test (the standing gate).
 */
describe("REPL render (R5 command-log replay, e2e via bin)", () => {
  const tmp = mkdtempSync(join(tmpdir(), "caco-cli-repl-"));
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  /** Parse a WAV's channel-0 peak (16-bit PCM). */
  function wavPeak(buf: Buffer): { riff: boolean; frames: number; peak: number } {
    const riff = buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE";
    const blockAlign = buf.readUInt16LE(32);
    const dataLen = buf.readUInt32LE(40);
    const frames = blockAlign > 0 ? dataLen / blockAlign : 0;
    let peak = 0;
    let off = 44;
    for (let i = 0; i < frames; i++) {
      const raw = buf.readInt16LE(off);
      const v = raw < 0 ? raw / 0x8000 : raw / 0x7fff;
      if (Math.abs(v) > peak) peak = Math.abs(v);
      off += blockAlign;
    }
    return { riff, frames, peak };
  }

  it("`render <out.wav>` from the REPL writes a valid non-silent WAV with the fx delta", async () => {
    const out = join(tmp, "repl-render.wav");
    const stdin = `synth 220 sawtooth\nfx add distortion drive=40 shape=tanh\nroute fx\nrender ${out}\nexit\n`;
    const r = await spawnBin(["repl"], { stdin, killAfterMs: 15000 });

    expect(r.code).toBe(0);
    expect(existsSync(out)).toBe(true);

    const parsed = wavPeak(readFileSync(out));
    expect(parsed.riff).toBe(true);
    expect(parsed.frames).toBeGreaterThan(0);
    // Distortion on a sawtooth → saturated, peaks at/near full scale (non-silent).
    expect(parsed.peak).toBeGreaterThan(0.5);
  }, 20000);
});
