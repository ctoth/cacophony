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
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

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
