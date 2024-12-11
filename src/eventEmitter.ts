type EventMap = Record<string, any>;
type EventKey<T extends EventMap> = string & keyof T;
type EventListener<T> = (params: T) => void | Promise<void>;

export class TypedEventEmitter<T extends EventMap> {
  private listeners: Partial<Record<keyof T, Array<{ fn: EventListener<any>, once: boolean }>>> = {};

  on<K extends EventKey<T>>(eventName: K, fn: EventListener<T[K]>) {
    this.listeners[eventName] = this.listeners[eventName] ?? [];
    this.listeners[eventName]!.push({ fn, once: false });
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

  removeAllListeners() {
    this.listeners = {};
  }
}
