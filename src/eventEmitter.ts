type EventMap = Record<string, unknown>;
type EventKey<T extends EventMap> = string & keyof T;
type EventListener<T> = (params: T) => void | Promise<void>;

type ListenerEntry<T extends EventMap, K extends keyof T> = {
  fn: EventListener<T[K]>;
  once: boolean;
};

type ListenerStore<T extends EventMap> = Partial<{
  [K in keyof T]: Array<ListenerEntry<T, K>>;
}>;

/**
 * Type-safe event emitter.
 */
export class TypedEventEmitter<T extends EventMap> {
  private listeners: ListenerStore<T> = {};

  /**
   * Register event listener.
   * @returns Cleanup function
   * @example
   * const cleanup = emitter.on('play', (playback) => console.log(playback));
   * cleanup(); // Remove listener
   */
  on<K extends EventKey<T>>(eventName: K, fn: EventListener<T[K]>): () => void {
    const list = (this.listeners[eventName] ??= []);
    list.push({ fn, once: false });
    return () => this.off(eventName, fn);
  }

  /**
   * Register one-time event listener.
   * The returned cleanup is idempotent: calling it after the listener has
   * auto-removed (because the event fired) is a safe no-op.
   * @returns Cleanup function
   */
  once<K extends EventKey<T>>(eventName: K, fn: EventListener<T[K]>): () => void {
    const list = (this.listeners[eventName] ??= []);
    list.push({ fn, once: true });
    return () => this.off(eventName, fn);
  }

  /**
   * Remove event listener.
   */
  off<K extends EventKey<T>>(eventName: K, fn: EventListener<T[K]>): void {
    const listeners = this.listeners[eventName];
    if (listeners) {
      this.listeners[eventName] = listeners.filter((listener) => listener.fn !== fn);
    }
  }

  /**
   * Emit event synchronously.
   *
   * Listeners fire in registration order against a snapshot taken at the
   * start of the dispatch. Concurrent mutations to `this.listeners[eventName]`
   * during dispatch — including `off()` calls from inside a listener and a
   * re-entrant `emit()` — do not affect which listeners fire for THIS emit.
   *
   * `once` listeners are removed from the stored array BEFORE iteration, so
   * a re-entrant `emit()` does not see them and they cannot fire twice. An
   * in-listener `off()` of a sibling is preserved because removal operates
   * on the current stored array, not on the pre-emit snapshot.
   */
  emit<K extends EventKey<T>>(eventName: K, params: T[K]): void {
    const stored = this.listeners[eventName];
    if (!stored || stored.length === 0) return;
    // Pre-split: keep stays in storage, fire is the dispatch snapshot.
    // Setting storage to `keep` BEFORE dispatch makes once-removal atomic with
    // dispatch (re-entrant emit cannot see a not-yet-fired once listener) and
    // leaves a stable array for in-listener off()/on() to mutate.
    const fire = stored.slice();
    const keep = stored.filter((listener) => !listener.once);
    this.listeners[eventName] = keep;
    for (const listener of fire) {
      listener.fn(params);
    }
  }

  /**
   * Emit event asynchronously with error isolation.
   * Listener errors are logged but don't break other listeners.
   *
   * Same snapshot semantics as `emit`: the dispatched listener set is
   * frozen at call time, and `once` listeners are removed from storage
   * before dispatch so a re-entrant emit cannot re-fire them.
   */
  emitAsync<K extends EventKey<T>>(eventName: K, params: T[K]): Promise<void> {
    const stored = this.listeners[eventName];
    if (!stored || stored.length === 0) return Promise.resolve();
    const fire = stored.slice();
    const keep = stored.filter((listener) => !listener.once);
    this.listeners[eventName] = keep;
    const promises = fire.map((listener) =>
      Promise.resolve()
        .then(() => listener.fn(params))
        .catch((error) => console.error(`Error in listener for event ${eventName}:`, error)),
    );
    return Promise.all(promises).then(() => {});
  }

  /**
   * Remove all event listeners.
   */
  removeAllListeners(): void {
    this.listeners = {};
  }
}
