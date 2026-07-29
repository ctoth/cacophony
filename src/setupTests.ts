/**
 * Shared test setup and audio-graph assertions.
 *
 * The graph helpers read the observable `connect`/`disconnect` histories on
 * nodes produced by `standardized-audio-context-mock` and the Vitest worklet
 * mock. The upstream mock returns bare objects for channel splitters and
 * mergers, so their factories are instrumented here with equivalent observable
 * methods. `expectReachable()` and `expectNotReachable()` assert graph
 * reachability, `expectPath()` asserts each edge in an ordered chain, and
 * `graphSnapshot()` returns a JSON-safe reachable edge list with port metadata.
 */
import { AudioBuffer, AudioContext } from "standardized-audio-context-mock";
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import { Cacophony } from "./cacophony";

export let cacophony: Cacophony;
export let audioContextMock: AudioContext;

type GraphNode = object;

interface GraphEdge {
  source: GraphNode;
  destination: GraphNode;
  output: number;
  input: number;
}

interface GraphInvocation {
  args: readonly unknown[];
  kind: "connect" | "disconnect";
  order: number;
}

export interface AudioGraphSnapshot {
  nodes: Array<{ id: string; type: string }>;
  edges: Array<{
    source: string;
    destination: string;
    output: number;
    input: number;
  }>;
}

const instrumentedNodeTypes = new WeakMap<GraphNode, string>();

function isGraphNode(value: unknown): value is GraphNode {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function callHistory(fn: unknown, kind: GraphInvocation["kind"]): GraphInvocation[] {
  if (typeof fn !== "function") {
    return [];
  }

  const observable = fn as {
    getCalls?: () => Array<{ args?: readonly unknown[]; callId?: number }>;
    mock?: {
      calls?: readonly (readonly unknown[])[];
      invocationCallOrder?: readonly number[];
    };
  };

  if (typeof observable.getCalls === "function") {
    return observable.getCalls().map((call, index) => ({
      args: call.args ?? [],
      kind,
      order: call.callId ?? index,
    }));
  }

  return (observable.mock?.calls ?? []).map((args, index) => ({
    args,
    kind,
    order: observable.mock?.invocationCallOrder?.[index] ?? index,
  }));
}

function activeEdges(source: GraphNode): GraphEdge[] {
  const node = source as { connect?: unknown; disconnect?: unknown };
  const invocations = [...callHistory(node.connect, "connect"), ...callHistory(node.disconnect, "disconnect")].sort(
    (left, right) => left.order - right.order,
  );
  const edges: GraphEdge[] = [];

  for (const invocation of invocations) {
    if (invocation.kind === "connect") {
      const [destination, output = 0, input = 0] = invocation.args;
      if (!isGraphNode(destination)) {
        continue;
      }
      const edge = {
        source,
        destination,
        output: typeof output === "number" ? output : 0,
        input: typeof input === "number" ? input : 0,
      };
      const duplicate = edges.some(
        (existing) =>
          existing.destination === edge.destination && existing.output === edge.output && existing.input === edge.input,
      );
      if (!duplicate) {
        edges.push(edge);
      }
      continue;
    }

    const [destinationOrOutput, output, input] = invocation.args;
    if (destinationOrOutput === undefined) {
      edges.length = 0;
      continue;
    }
    if (typeof destinationOrOutput === "number") {
      for (let index = edges.length - 1; index >= 0; index -= 1) {
        if (edges[index]?.output === destinationOrOutput) {
          edges.splice(index, 1);
        }
      }
      continue;
    }
    for (let index = edges.length - 1; index >= 0; index -= 1) {
      const edge = edges[index];
      if (
        edge?.destination === destinationOrOutput &&
        (typeof output !== "number" || edge.output === output) &&
        (typeof input !== "number" || edge.input === input)
      ) {
        edges.splice(index, 1);
      }
    }
  }

  return edges;
}

function reachablePath(source: GraphNode, destination: GraphNode): GraphNode[] | undefined {
  const queue: Array<{ node: GraphNode; path: GraphNode[] }> = [{ node: source, path: [source] }];
  const visited = new WeakSet<GraphNode>([source]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    if (current.node === destination) {
      return current.path;
    }
    for (const edge of activeEdges(current.node)) {
      if (!visited.has(edge.destination)) {
        visited.add(edge.destination);
        queue.push({ node: edge.destination, path: [...current.path, edge.destination] });
      }
    }
  }

  return undefined;
}

function graphNodeType(node: GraphNode): string {
  const instrumentedType = instrumentedNodeTypes.get(node);
  if (instrumentedType) {
    return instrumentedType;
  }
  return (node as { constructor?: { name?: string } }).constructor?.name ?? "Object";
}

/**
 * Assert that at least one active connection path leads from source to
 * destination.
 */
export function expectReachable(source: GraphNode, destination: GraphNode): void {
  expect(
    reachablePath(source, destination),
    `Expected ${graphNodeType(source)} to reach ${graphNodeType(destination)}`,
  ).toBeDefined();
}

/**
 * Assert that no active connection path leads from source to destination.
 */
export function expectNotReachable(source: GraphNode, destination: GraphNode): void {
  expect(
    reachablePath(source, destination),
    `Expected ${graphNodeType(source)} not to reach ${graphNodeType(destination)}`,
  ).toBeUndefined();
}

/**
 * Assert an exact ordered chain of direct active edges:
 * `source -> intermediates[0] -> ... -> destination`.
 */
export function expectPath(source: GraphNode, intermediates: readonly GraphNode[], destination: GraphNode): void {
  const path = [source, ...intermediates, destination];
  for (let index = 0; index < path.length - 1; index += 1) {
    const from = path[index]!;
    const to = path[index + 1]!;
    expect(
      activeEdges(from).some((edge) => edge.destination === to),
      `Expected direct graph edge ${graphNodeType(from)} -> ${graphNodeType(to)}`,
    ).toBe(true);
  }
}

/**
 * Return the active graph reachable from source as stable, JSON-safe node and
 * edge arrays. Node IDs are local breadth-first IDs, so snapshots do not
 * depend on test execution order.
 */
export function graphSnapshot(source: GraphNode): AudioGraphSnapshot {
  const ids = new WeakMap<GraphNode, string>();
  const queued = new WeakSet<GraphNode>();
  const queue: GraphNode[] = [source];
  const nodes: AudioGraphSnapshot["nodes"] = [];
  const edges: AudioGraphSnapshot["edges"] = [];
  ids.set(source, "n0");
  queued.add(source);

  while (queue.length > 0) {
    const node = queue.shift()!;
    const sourceId = ids.get(node)!;
    nodes.push({ id: sourceId, type: graphNodeType(node) });
    for (const edge of activeEdges(node)) {
      let destinationId = ids.get(edge.destination);
      if (!destinationId) {
        destinationId = `n${idsForSnapshot(nodes, queue)}`;
        ids.set(edge.destination, destinationId);
      }
      edges.push({
        source: sourceId,
        destination: destinationId,
        output: edge.output,
        input: edge.input,
      });
      if (!queued.has(edge.destination)) {
        queued.add(edge.destination);
        queue.push(edge.destination);
      }
    }
  }

  return { nodes, edges };
}

function idsForSnapshot(nodes: AudioGraphSnapshot["nodes"], queue: readonly GraphNode[]): number {
  return nodes.length + queue.length;
}

function createInstrumentedGraphNode(context: AudioContext, type: string, inputs: number, outputs: number): GraphNode {
  const node = {
    channelCount: 2,
    channelCountMode: "max",
    channelInterpretation: "speakers",
    connect: vi.fn((destination: GraphNode) => destination),
    context,
    disconnect: vi.fn(),
    numberOfInputs: inputs,
    numberOfOutputs: outputs,
  };
  instrumentedNodeTypes.set(node, type);
  return node;
}

function instrumentIncompleteNodeFactories(context: AudioContext): void {
  Object.defineProperty(context, "createChannelSplitter", {
    configurable: true,
    value: (numberOfOutputs = 6) => createInstrumentedGraphNode(context, "ChannelSplitterNodeMock", 1, numberOfOutputs),
    writable: true,
  });
  Object.defineProperty(context, "createChannelMerger", {
    configurable: true,
    value: (numberOfInputs = 6) => createInstrumentedGraphNode(context, "ChannelMergerNodeMock", numberOfInputs, 1),
    writable: true,
  });
}

// Track which URLs have been loaded to simulate cache behavior
const loadedUrls = new Set<string>();

const mockCache = {
  getAudioBuffer: vi.fn((context, url, signal, callbacks) => {
    // Call loading start callback immediately
    if (callbacks?.onLoadingStart) {
      callbacks.onLoadingStart({ url, timestamp: Date.now() });
    }

    // Check if this URL has been loaded before (memory cache simulation)
    const isMemoryCacheHit = loadedUrls.has(url);

    if (isMemoryCacheHit) {
      // Cache hit - return immediately
      if (callbacks?.onCacheHit) {
        callbacks.onCacheHit({
          url,
          cacheType: "memory",
          timestamp: Date.now(),
        });
      }

      const audioBuffer = new AudioBuffer({ length: 100, sampleRate: 44100 });
      return Promise.resolve(audioBuffer);
    }

    // Cache miss - need to "fetch" and load
    if (callbacks?.onCacheMiss) {
      callbacks.onCacheMiss({
        url,
        reason: "not-found",
        timestamp: Date.now(),
      });
    }

    // Simulate async loading behavior — never hit the real network
    return new Promise<AudioBuffer>(async (resolve, reject) => {
      try {
        // If a test has mocked global.fetch to throw, honour that for error-path tests
        if (vi.isMockFunction(global.fetch)) {
          try {
            await global.fetch(url, { signal });
          } catch (fetchError) {
            if (callbacks?.onLoadingError) {
              const errorType = fetchError instanceof Error && fetchError.name === "AbortError" ? "abort" : "network";
              callbacks.onLoadingError({
                url,
                error: fetchError,
                errorType,
                timestamp: Date.now(),
              });
            }
            reject(fetchError);
            return;
          }
        }

        if (callbacks?.onLoadingProgress) {
          callbacks.onLoadingProgress({
            url,
            loaded: 512,
            total: 1024,
            progress: 0.5,
            timestamp: Date.now(),
          });
        }

        const audioBuffer = new AudioBuffer({
          length: 100,
          sampleRate: 44100,
        });

        // Test decode by calling the mocked decodeAudioData
        if (context.decodeAudioData && typeof context.decodeAudioData === "function") {
          try {
            await context.decodeAudioData(new ArrayBuffer(1024));

            if (callbacks?.onLoadingComplete) {
              callbacks.onLoadingComplete({
                url,
                duration: 2.27,
                size: 1024,
                timestamp: Date.now(),
              });
            }

            loadedUrls.add(url);
            resolve(audioBuffer);
          } catch (decodeError) {
            if (callbacks?.onLoadingError) {
              callbacks.onLoadingError({
                url,
                error: decodeError,
                errorType: "decode",
                timestamp: Date.now(),
              });
            }
            reject(decodeError);
          }
        } else {
          if (callbacks?.onLoadingComplete) {
            callbacks.onLoadingComplete({
              url,
              duration: 2.27,
              size: 1024,
              timestamp: Date.now(),
            });
          }

          loadedUrls.add(url);
          resolve(audioBuffer);
        }
      } catch (error) {
        reject(error);
      }
    });
  }),
  clearMemoryCache: vi.fn(() => {
    loadedUrls.clear();
  }),
};

beforeAll(() => {
  vi.useFakeTimers();

  // Mock Audio constructor for HTML audio tests
  global.Audio = vi.fn().mockImplementation(function MockAudio() {
    const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
    const dispatchEvent = (type: string) => {
      const event = new Event(type);
      for (const listener of listeners.get(type) ?? []) {
        if (typeof listener === "function") {
          listener.call(audio, event);
        } else {
          listener.handleEvent(event);
        }
      }
    };

    const audio = {
      src: "",
      crossOrigin: null,
      preload: "auto",
      error: null,
      load: vi.fn(() => {
        if (!audio.src) {
          return;
        }
        queueMicrotask(() => {
          if (!audio.src) {
            return;
          }
          dispatchEvent("loadedmetadata");
        });
      }),
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      currentTime: 0,
      duration: 0,
      loop: false,
      playbackRate: 1,
      onended: null,
      addEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.set(type, listeners.get(type) ?? new Set());
        listeners.get(type)!.add(listener);
      }),
      removeEventListener: vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
        listeners.get(type)?.delete(listener);
      }),
    };

    return audio;
  });

  // Mock AudioWorkletNode constructor for worklet tests
  global.AudioWorkletNode = vi.fn().mockImplementation(function MockAudioWorkletNode() {
    const node = {
      connect: vi.fn((destination) => destination),
      disconnect: vi.fn(),
      port: {
        postMessage: vi.fn(),
        addEventListener: vi.fn(),
      },
    };
    instrumentedNodeTypes.set(node, "AudioWorkletNode");
    return node;
  });
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  audioContextMock = new AudioContext();
  instrumentIncompleteNodeFactories(audioContextMock);
  cacophony = new Cacophony(audioContextMock, mockCache);
});

afterEach(() => {
  audioContextMock.close();
});

export { mockCache };
