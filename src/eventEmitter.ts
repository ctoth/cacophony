type EventMap = Record<string, any>;
type EventKey<T extends EventMap> = string & keyof T;
type EventListener<T> = (params: T) => void | Promise<void>;

/**
 * Type-safe event emitter.
 */
export class TypedEventEmitter<T extends EventMap> {
  private listeners: Partial<Record<keyof T, Array<{ fn: EventListener<any>, once: boolean }>>> = {};

  /**
   * Register event listener.
   * @returns Cleanup function
   * @example
   * const cleanup = emitter.on('play', (playback) => console.log(playback));
   * cleanup(); // Remove listener
   */
  on<K extends EventKey<T>>(eventName: K, fn: EventListener<T[K]>) {
    this.listeners[eventName] = this.listeners[eventName] ?? [];
    this.listeners[eventName]!.push({ fn, once: false });
    return () => this.off(eventName, fn);
  }

  /**
   * Register one-time event listener.
   * @returns Cleanup function
   */
  once<K extends EventKey<T>>(eventName: K, fn: EventListener<T[K]>) {
    this.listeners[eventName] = this.listeners[eventName] ?? [];
    this.listeners[eventName]!.push({ fn, once: true });
    return () => this.off(eventName, fn);
  }

  /**
   * Remove event listener.
   */
  off<K extends EventKey<T>>(eventName: K, fn: EventListener<T[K]>) {
    const listeners = this.listeners[eventName];
    if (listeners) {
      this.listeners[eventName] = listeners.filter(listener => listener.fn !== fn);
    }
  }

  /**
   * Emit event synchronously.
   */
  emit<K extends EventKey<T>>(eventName: K, params: T[K]) {
    const listeners = this.listeners[eventName];
    if (listeners) {
      listeners.forEach(listener => listener.fn(params));
      this.listeners[eventName] = listeners.filter(listener => !listener.once);
    }
  }

  /**
   * Emit event asynchronously with error isolation.
   * Listener errors are logged but don't break other listeners.
   */
  emitAsync<K extends EventKey<T>>(eventName: K, params: T[K]): Promise<void> {
    const listeners = this.listeners[eventName];
    if (listeners) {
      const promises = listeners.map(listener => 
        Promise.resolve().then(() => listener.fn(params))
          .catch(error => console.error(`Error in listener for event ${eventName}:`, error))
      );
      this.listeners[eventName] = listeners.filter(listener => !listener.once);
      return Promise.all(promises).then(() => {});
    }
    return Promise.resolve();
  }

  /**
   * Remove all event listeners.
   */
  removeAllListeners() {
    this.listeners = {};
  }
}
