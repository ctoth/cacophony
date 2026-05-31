/**
 * {@link LoudnessMeter} — a main-thread handle over the `loudness-meter`
 * AudioWorkletProcessor (ITU-R BS.1770-5 momentary / short-term / integrated
 * loudness + true-peak).
 *
 * The meter taps a target node's OUTPUT as a BRANCH: it connects the target to
 * the metering worklet's input without disturbing the target's existing forward
 * edge, so inserting a meter never alters the audible path. The worklet itself
 * is pass-through, but its output is left unconnected (a dead-end sink), so the
 * branch is silent.
 *
 * Readings arrive ~10×/s over the MessagePort and are cached on this handle
 * ({@link momentary} / {@link shortTerm} / {@link integrated} / {@link truePeak});
 * an optional {@link onUpdate} callback fires on each report.
 *
 * @see https://www.itu.int/rec/R-REC-BS.1770-5-202311-I/en
 */
import type { AudioNode, AudioWorkletNode } from "../context";

/** A single set of loudness readings posted by the worklet. */
export interface LoudnessReading {
  /** Momentary loudness over the last 400 ms, in LKFS (LUFS). */
  momentary: number;
  /** Short-term loudness over the last 3 s, in LKFS (LUFS). */
  shortTerm: number;
  /** Gated integrated loudness since the last reset, in LKFS (LUFS). */
  integrated: number;
  /** Running true-peak level since the last reset, in dBTP. */
  truePeak: number;
}

interface LoudnessMessage extends LoudnessReading {
  type: "loudness";
}

export class LoudnessMeter {
  private readonly node: AudioWorkletNode;
  private readonly source: AudioNode;
  private latest: LoudnessReading = {
    momentary: -Infinity,
    shortTerm: -Infinity,
    integrated: -Infinity,
    truePeak: -Infinity,
  };

  /**
   * Invoked on every report from the worklet (~10×/s) with the latest readings.
   * Assign a function to observe live loudness; leave undefined to poll the
   * cached getters instead.
   */
  onUpdate?: (reading: LoudnessReading) => void;

  /**
   * @param node The constructed `loudness-meter` AudioWorkletNode.
   * @param source The node whose output is being metered. Its output is
   *   branched into `node` here; the source's existing connections are
   *   untouched (the audible path is preserved).
   */
  constructor(node: AudioWorkletNode, source: AudioNode) {
    this.node = node;
    this.source = source;
    this.node.port.addEventListener("message", this.handleMessage);
    // Some MessagePort implementations require an explicit start when using
    // addEventListener rather than onmessage.
    this.node.port.start?.();
    // Branch tap: source.output → meter (in ADDITION to source's existing edges).
    this.source.connect(this.node);
  }

  private readonly handleMessage = (event: MessageEvent): void => {
    const data = event.data as LoudnessMessage | undefined;
    if (!data || data.type !== "loudness") {
      return;
    }
    this.latest = {
      momentary: data.momentary,
      shortTerm: data.shortTerm,
      integrated: data.integrated,
      truePeak: data.truePeak,
    };
    this.onUpdate?.(this.latest);
  };

  /** Latest momentary loudness (400 ms) in LKFS. */
  get momentary(): number {
    return this.latest.momentary;
  }

  /** Latest short-term loudness (3 s) in LKFS. */
  get shortTerm(): number {
    return this.latest.shortTerm;
  }

  /** Latest gated integrated loudness (since last reset) in LKFS. */
  get integrated(): number {
    return this.latest.integrated;
  }

  /** Latest true-peak level (since last reset) in dBTP. */
  get truePeak(): number {
    return this.latest.truePeak;
  }

  /** A snapshot of all current readings. */
  get reading(): LoudnessReading {
    return { ...this.latest };
  }

  /** The underlying metering worklet node (for advanced wiring). */
  get workletNode(): AudioWorkletNode {
    return this.node;
  }

  /**
   * Resets the integrated-loudness gate accumulator and the true-peak hold on
   * the worklet (momentary/short-term keep sliding). Use to start a fresh
   * integrated measurement of a new programme.
   */
  reset(): void {
    this.node.port.postMessage({ command: "reset" });
  }

  /**
   * Stops metering: removes the branch tap from the source and detaches the
   * message listener. The audible path (the source's other edges) is untouched.
   */
  disconnect(): void {
    this.node.port.removeEventListener?.("message", this.handleMessage);
    try {
      this.source.disconnect(this.node);
    } catch {
      // Already disconnected — ignore.
    }
  }
}
