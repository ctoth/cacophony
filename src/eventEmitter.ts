type EventMap = Record<string, any>;
type EventKey<T extends EventMap> = string & keyof T;
type EventListener<T> = (params: T) => void | Promise<void>;

// Development mode detection for warnings
declare const __DEV__: boolean | undefined;
function isDev(): boolean {
  return (typeof __DEV__ !== 'undefined' && __DEV__) ||
    (typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'development');
}

export class TypedEventEmitter<T extends EventMap> {
  private listeners: Partial<Record<keyof T, Array<{ fn: EventListener<any>, once: boolean }>>> = {};
  private asyncListeners: Partial<Record<keyof T, Array<{ fn: EventListener<any>, once: boolean }>>> = {};
  private syncOnlyEvents: Set<keyof T> = new Set();

  on<K extends EventKey<T>>(eventName: K, fn: EventListener<T[K]>, options?: { warnOnAsync?: boolean }) {
    this.listeners[eventName] = this.listeners[eventName] ?? [];
    this.listeners[eventName]!.push({ fn, once: false });
    
    // Development warning for async listeners on sync events
    if (isDev() && (options?.warnOnAsync !== false)) {
      if (this.syncOnlyEvents.has(eventName) && this.isAsyncFunction(fn)) {
        console.warn(
          `🎵 Cacophony Warning: Async listener detected on sync event '${String(eventName)}'. ` +
          `This listener's Promise will be ignored. Use onAsync('${String(eventName)}', listener) ` +
          `or emitAsync('${String(eventName)}', data) for proper async handling.`
        );
      }
    }
    
    return () => this.off(eventName, fn);
  }

  once<K extends EventKey<T>>(eventName: K, fn: EventListener<T[K]>) {
    this.listeners[eventName] = this.listeners[eventName] ?? [];
    this.listeners[eventName]!.push({ fn, once: true });
    return () => this.off(eventName, fn);
  }

  off<K extends EventKey<T>>(eventName: K, fn: EventListener<T[K]>) {
    const listeners = this.listeners[eventName];
    if (listeners) {
      this.listeners[eventName] = listeners.filter(listener => listener.fn !== fn);
    }
  }

  emit<K extends EventKey<T>>(eventName: K, params: T[K]) {
    const listeners = this.listeners[eventName];
    if (listeners) {
      listeners.forEach(listener => listener.fn(params));
      this.listeners[eventName] = listeners.filter(listener => !listener.once);
    }
  }

  /**
   * Enhanced emitAsync with better error handling and optional per-listener timeout
   */
  emitAsync<K extends EventKey<T>>(eventName: K, params: T[K], timeoutMs?: number): Promise<PromiseSettledResult<void>[]> {
    const syncListeners = this.listeners[eventName] || [];
    const asyncListeners = this.asyncListeners[eventName] || [];
    const allListeners = [...syncListeners, ...asyncListeners];
    
    if (allListeners.length === 0) {
      return Promise.resolve([]);
    }

    const promises = allListeners.map(listener => {
      const listenerPromise = Promise.resolve().then(() => listener.fn(params));
      
      // Only apply timeout if specified, to avoid starvation
      if (timeoutMs && timeoutMs > 0) {
        const timeoutPromise = new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error(`Listener timeout after ${timeoutMs}ms`)), timeoutMs);
        });
        return Promise.race([listenerPromise, timeoutPromise]);
      }
      
      return listenerPromise;
    });

    // Clean up one-time listeners
    this.listeners[eventName] = syncListeners.filter(listener => !listener.once);
    this.asyncListeners[eventName] = asyncListeners.filter(listener => !listener.once);

    return Promise.allSettled(promises);
  }

  removeAllListeners() {
    this.listeners = {};
    this.asyncListeners = {};
  }

  /**
   * Mark an event as sync-only (will warn if async listeners are added in dev mode)
   */
  markEventAsSyncOnly<K extends EventKey<T>>(eventName: K): void {
    this.syncOnlyEvents.add(eventName);
  }

  /**
   * Convenience method for registering async listeners
   */
  onAsync<K extends EventKey<T>>(eventName: K, fn: EventListener<T[K]>) {
    this.asyncListeners[eventName] = this.asyncListeners[eventName] ?? [];
    this.asyncListeners[eventName]!.push({ fn, once: false });
    return () => this.offAsync(eventName, fn);
  }

  /**
   * Convenience method for registering one-time async listeners
   */
  onceAsync<K extends EventKey<T>>(eventName: K, fn: EventListener<T[K]>) {
    this.asyncListeners[eventName] = this.asyncListeners[eventName] ?? [];
    this.asyncListeners[eventName]!.push({ fn, once: true });
    return () => this.offAsync(eventName, fn);
  }

  /**
   * Remove async listener
   */
  offAsync<K extends EventKey<T>>(eventName: K, fn: EventListener<T[K]>) {
    const listeners = this.asyncListeners[eventName];
    if (listeners) {
      this.asyncListeners[eventName] = listeners.filter(listener => listener.fn !== fn);
    }
  }

  /**
   * Emit to async listeners only
   */
  emitAsyncOnly<K extends EventKey<T>>(eventName: K, params: T[K]): Promise<void> {
    const listeners = this.asyncListeners[eventName];
    if (listeners) {
      const promises = listeners.map(listener => 
        Promise.resolve().then(() => listener.fn(params))
          .catch(error => console.error(`Error in async listener for event ${eventName}:`, error))
      );
      this.asyncListeners[eventName] = listeners.filter(listener => !listener.once);
      return Promise.all(promises).then(() => {});
    }
    return Promise.resolve();
  }

  /**
   * Detect if function is actually async (not just contains async-like strings)
   * Only relies on constructor.name to avoid false positives from transpiled code
   */
  private isAsyncFunction(fn: Function): boolean {
    return fn.constructor.name === 'AsyncFunction';
  }
}
