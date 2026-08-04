import type { FadeType } from "./cacophony";
import type { AudioNode, AudioParam, AudioWorkletNode } from "./context";
import type { BuiltEffect } from "./effects";
import { isBuiltEffect, isBuiltEffectGraph } from "./effects";

interface EffectChainEntry {
  handle: AudioNode;
  input: AudioNode;
  output: AudioNode;
  params?: Readonly<Record<string, AudioParam>>;
  dispose?: () => void;
}

interface EffectChainReservation {
  readonly reservation: symbol;
}

type EffectChainSlot = EffectChainEntry | EffectChainReservation;

/**
 * Incrementally reconciles a series of built effects between two caller-owned
 * endpoint nodes.
 */
export class EffectChain {
  private readonly entries: EffectChainSlot[] = [];
  private readonly bypassed = new Set<AudioNode>();
  private readonly edges: Array<readonly [AudioNode, AudioNode]> = [];
  private destroyed = false;

  constructor(
    private input: AudioNode,
    private output: AudioNode,
    private readonly diagnosticScope = "EffectChain",
  ) {
    this.connectEdge(input, output);
  }

  get nodes(): readonly AudioNode[] {
    return this.entries.filter(this.isEntry).map((entry) => entry.handle);
  }

  has(node: AudioNode): boolean {
    return this.entries.some((entry) => this.isEntry(entry) && entry.handle === node);
  }

  setEndpoints(input: AudioNode, output: AudioNode): void {
    if (input === this.input && output === this.output) {
      return;
    }
    this.disconnectEdges();
    this.input = input;
    this.output = output;
    this.refresh();
  }

  add(built: BuiltEffect, index = this.entries.length): AudioNode {
    if (this.destroyed) {
      throw this.guardError("cannot add an effect to a destroyed chain");
    }
    const entry = this.normalize(built);
    if (this.has(entry.handle)) {
      entry.dispose?.();
      throw this.guardError("cannot add the same effect node twice");
    }
    this.entries.splice(index, 0, entry);
    this.refresh();
    return entry.handle;
  }

  /** Reserve a declaration-order position for an asynchronously built effect. */
  reserve(): symbol {
    if (this.destroyed) {
      throw this.guardError("cannot reserve an effect on a destroyed chain");
    }
    const reservation = Symbol("effect-chain-reservation");
    this.entries.push({ reservation });
    return reservation;
  }

  /** Replace a reservation with its built effect while retaining its position. */
  resolve(reservation: symbol, built: BuiltEffect): AudioNode {
    const entry = this.normalize(built);
    if (this.destroyed) {
      entry.dispose?.();
      return entry.handle;
    }
    const index = this.entries.findIndex(
      (candidate) => !this.isEntry(candidate) && candidate.reservation === reservation,
    );
    if (index === -1) {
      entry.dispose?.();
      throw this.guardError("cannot resolve an unknown effect-chain reservation");
    }
    if (this.has(entry.handle)) {
      this.entries.splice(index, 1);
      entry.dispose?.();
      throw this.guardError("cannot add the same effect node twice");
    }
    this.entries[index] = entry;
    this.refresh();
    return entry.handle;
  }

  cancel(reservation: symbol): void {
    const index = this.entries.findIndex(
      (candidate) => !this.isEntry(candidate) && candidate.reservation === reservation,
    );
    if (index !== -1) {
      this.entries.splice(index, 1);
    }
  }

  remove(node: AudioNode): void {
    const index = this.entries.findIndex((entry) => this.isEntry(entry) && entry.handle === node);
    if (index === -1) {
      throw this.guardError("cannot remove an effect that was never added");
    }
    const [entry] = this.entries.splice(index, 1);
    this.bypassed.delete(node);
    this.refresh();
    if (entry && this.isEntry(entry)) {
      entry.dispose?.();
    }
  }

  setOrder(nodes: readonly AudioNode[]): void {
    const isPermutation =
      nodes.length === this.nodes.length &&
      new Set(nodes).size === nodes.length &&
      nodes.every((node) => this.has(node));
    if (!isPermutation) {
      throw this.guardError("effect order must be a permutation of the current nodes");
    }
    const ordered = nodes.map((node) => this.entries.find((entry) => this.isEntry(entry) && entry.handle === node)!);
    let orderedIndex = 0;
    for (let index = 0; index < this.entries.length; index += 1) {
      if (this.isEntry(this.entries[index]!)) {
        this.entries[index] = ordered[orderedIndex++]!;
      }
    }
    this.refresh();
  }

  setBypassed(node: AudioNode, bypassed: boolean): void {
    if (!this.has(node)) {
      throw this.guardError("cannot bypass an effect that was never added");
    }
    const alreadyBypassed = this.bypassed.has(node);
    if (bypassed === alreadyBypassed) {
      return;
    }
    if (bypassed) {
      this.bypassed.add(node);
    } else {
      this.bypassed.delete(node);
    }
    this.refresh();
  }

  isBypassed(node: AudioNode): boolean {
    return this.bypassed.has(node);
  }

  rampParam(node: AudioNode, paramName: string, value: number, options?: { duration?: number; type?: FadeType }): void {
    const entry = this.entries.filter(this.isEntry).find((candidate) => candidate.handle === node);
    if (!entry) {
      console.warn(
        `${this.diagnosticScope}.rampFilterParam: node is not a filter on this ${this.diagnosticScope.toLowerCase()}; ignoring automation of '${paramName}'.`,
      );
      return;
    }

    const param = entry.params?.[paramName] ?? this.resolveAudioParam(node, paramName);
    if (!param) {
      console.warn(
        `${this.diagnosticScope}.rampFilterParam: could not resolve AudioParam '${paramName}' on the given node; ignoring.`,
      );
      return;
    }

    const now = node.context.currentTime;
    const duration = options?.duration;
    if (duration === undefined || duration <= 0) {
      param.setValueAtTime(value, now);
      return;
    }

    const endTime = now + duration / 1000;
    param.setValueAtTime(param.value, now);
    if (options?.type === "exponential") {
      param.exponentialRampToValueAtTime(value === 0 ? 0.0001 : value, endTime);
    } else {
      param.linearRampToValueAtTime(value, endTime);
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.disconnectEdges();
    for (const entry of this.entries) {
      if (this.isEntry(entry)) {
        try {
          entry.dispose?.();
        } catch {}
      }
    }
    this.entries.length = 0;
    this.bypassed.clear();
  }

  private refresh(): void {
    const desired = this.desiredEdges();
    for (const [source, destination] of this.edges) {
      const stillPresent = desired.some(([desiredSource, desiredDestination]) => {
        return desiredSource === source && desiredDestination === destination;
      });
      if (!stillPresent) {
        try {
          source.disconnect(destination);
        } catch {}
      }
    }
    for (const [source, destination] of desired) {
      const alreadyConnected = this.edges.some(([currentSource, currentDestination]) => {
        return currentSource === source && currentDestination === destination;
      });
      if (!alreadyConnected) {
        source.connect(destination);
      }
    }
    this.edges.length = 0;
    this.edges.push(...desired);
  }

  private desiredEdges(): Array<readonly [AudioNode, AudioNode]> {
    const active = this.entries.filter(this.isEntry).filter((entry) => !this.bypassed.has(entry.handle));
    if (active.length === 0) {
      return [[this.input, this.output]];
    }
    const desired: Array<readonly [AudioNode, AudioNode]> = [];
    let previous = this.input;
    for (const entry of active) {
      desired.push([previous, entry.input]);
      previous = entry.output;
    }
    desired.push([previous, this.output]);
    return desired;
  }

  private normalize(built: BuiltEffect): EffectChainEntry {
    if (!isBuiltEffect(built)) {
      throw this.guardError("effect build must return an AudioNode or BuiltEffectGraph");
    }
    if (isBuiltEffectGraph(built)) {
      return {
        handle: built.handle ?? built.input,
        input: built.input,
        output: built.output,
        params: built.params,
        dispose: built.dispose,
      };
    }
    return {
      handle: built,
      input: built,
      output: built,
    };
  }

  private isEntry(slot: EffectChainSlot): slot is EffectChainEntry {
    return "handle" in slot;
  }

  private guardError(message: string): Error {
    return new Error(`${this.diagnosticScope}: ${message}`);
  }

  private resolveAudioParam(node: AudioNode, paramName: string): AudioParam | undefined {
    const parameters = (node as AudioWorkletNode).parameters;
    if (parameters && typeof parameters.get === "function") {
      const workletParam = parameters.get(paramName);
      if (this.isAudioParam(workletParam)) {
        return workletParam;
      }
    }

    const nativeParam = (node as unknown as Record<string, unknown>)[paramName];
    if (this.isAudioParam(nativeParam)) {
      return nativeParam;
    }

    return undefined;
  }

  private isAudioParam(value: unknown): value is AudioParam {
    return (
      typeof value === "object" &&
      value !== null &&
      typeof (value as AudioParam).setValueAtTime === "function" &&
      typeof (value as AudioParam).linearRampToValueAtTime === "function" &&
      typeof (value as AudioParam).exponentialRampToValueAtTime === "function"
    );
  }

  private connectEdge(source: AudioNode, destination: AudioNode): void {
    source.connect(destination);
    this.edges.push([source, destination]);
  }

  private disconnectEdges(): void {
    for (const [source, destination] of this.edges) {
      try {
        source.disconnect(destination);
      } catch {}
    }
    this.edges.length = 0;
  }
}
