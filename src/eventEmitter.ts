type EventMap = Record<string, any>;
type EventKey<T extends EventMap> = string & keyof T;
type EventListener<T> = (params: T) => void;

export class TypedEventEmitter<T extends EventMap> {
  private listeners: Partial<Record<keyof T, EventListener<any>[]>> = {};

  on<K extends EventKey<T>>(eventName: K, fn: EventListener<T[K]>) {
    this.listeners[eventName] = this.listeners[eventName] ?? [];
    this.listeners[eventName]!.push(fn);
    return () => this.off(eventName, fn);
  }

  off<K extends EventKey<T>>(eventName: K, fn: EventListener<T[K]>) {
    const listeners = this.listeners[eventName];
    if (listeners) {
      const index = listeners.indexOf(fn);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  emit<K extends EventKey<T>>(eventName: K, params: T[K]) {
    this.listeners[eventName]?.forEach(fn => fn(params));
  }
}
