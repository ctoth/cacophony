/**
 * Live-mode runner for the one-shot `play` / `synth` subcommands.
 *
 * Builds a real-time graph with {@link createNodeCacophony}, starts the source,
 * and keeps the process alive until exactly ONE of the exit triggers fires:
 *
 *   - `--duration` expiry (a `setTimeout`),
 *   - the source's `ended` event (natural end of a non-looping sound),
 *   - `SIGINT` (Ctrl-C),
 *
 * all funnelled through one idempotent {@link shutdown} (a `closed` guard) that
 * `await context.close()`s — WITHOUT which the keep-alive timer of a real-time
 * `AudioContext` hangs the process forever (`src/node.ts:11-14`).
 */
import { createNodeCacophony } from "../node";
import { buildFxBus, buildSource, type FxSpec } from "./commands";
import { filteringLogger } from "./logging";

/** Parameters for a one-shot live run. */
export interface LiveParams {
  /** Source spec: `synth:<freq>[:<wave>]` or a file path. */
  source: string;
  /** Linear gain applied to the source. */
  volume?: number;
  /** Loop the source (count or `"infinite"`) — file sources only. */
  loop?: number | "infinite";
  /** Effect chain, applied in order on an anonymous bus the source routes to. */
  fx?: readonly FxSpec[];
  /** Stop and exit after this many seconds. Omit to run until `ended`/SIGINT. */
  durationSec?: number;
}

/**
 * Run a one-shot live playback. Resolves (with the process having been kept
 * alive in the meantime) once the graph has been torn down and the context
 * closed. The returned promise settles after `context.close()`; the caller
 * should treat resolution as "done, safe to exit 0".
 */
export async function runLive(params: LiveParams): Promise<void> {
  const { cacophony, context } = createNodeCacophony({ logger: filteringLogger });

  let closed = false;
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  // The ONE idempotent shutdown path. Every exit trigger calls this.
  let durationTimer: ReturnType<typeof setTimeout> | undefined;
  const onSigint = () => {
    void shutdown();
  };
  async function shutdown(): Promise<void> {
    if (closed) return;
    closed = true;
    if (durationTimer !== undefined) clearTimeout(durationTimer);
    process.off("SIGINT", onSigint);
    await context.close();
    resolveDone();
  }

  process.on("SIGINT", onSigint);

  try {
    const handle = await buildSource(
      cacophony,
      context as unknown as Parameters<typeof buildSource>[1],
      params.source,
      { volume: params.volume, loop: params.loop },
    );

    if (params.fx && params.fx.length > 0) {
      const { bus } = await buildFxBus(cacophony, params.fx);
      handle.source.routeTo(bus);
    }

    // Natural end of a non-looping source -> shutdown. Both Sound and Synth
    // emit `"ended"`; the union of their overloaded `on` signatures is not
    // directly callable, so address the shared subscriber shape explicitly.
    const onEnded = handle.source as { on(event: "ended", listener: () => void): unknown };
    onEnded.on("ended", () => {
      void shutdown();
    });

    handle.play();

    if (params.durationSec !== undefined) {
      durationTimer = setTimeout(() => {
        void shutdown();
      }, params.durationSec * 1000);
    }
  } catch (err) {
    // Make sure a build/playback failure still closes the context and exits.
    await shutdown();
    throw err;
  }

  await done;
}
