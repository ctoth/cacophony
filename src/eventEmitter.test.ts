import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TypedEventEmitter } from './eventEmitter';

// Test event interface
interface TestEvents {
  testEvent: string;
  numberEvent: number;
  objectEvent: { value: number };
  voidEvent: void;
}

describe('TypedEventEmitter', () => {
  let emitter: TypedEventEmitter<TestEvents>;

  beforeEach(() => {
    emitter = new TypedEventEmitter<TestEvents>();
  });

  describe('Basic functionality', () => {
    it('should register and emit events', () => {
      const listener = vi.fn();
      emitter.on('testEvent', listener);
      emitter.emit('testEvent', 'hello');
      
      expect(listener).toHaveBeenCalledWith('hello');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should support multiple listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      
      emitter.on('testEvent', listener1);
      emitter.on('testEvent', listener2);
      emitter.emit('testEvent', 'hello');
      
      expect(listener1).toHaveBeenCalledWith('hello');
      expect(listener2).toHaveBeenCalledWith('hello');
    });

    it('should handle different event types', () => {
      const stringListener = vi.fn();
      const numberListener = vi.fn();
      const objectListener = vi.fn();
      const voidListener = vi.fn();

      emitter.on('testEvent', stringListener);
      emitter.on('numberEvent', numberListener);
      emitter.on('objectEvent', objectListener);
      emitter.on('voidEvent', voidListener);

      emitter.emit('testEvent', 'test');
      emitter.emit('numberEvent', 42);
      emitter.emit('objectEvent', { value: 100 });
      emitter.emit('voidEvent', undefined);

      expect(stringListener).toHaveBeenCalledWith('test');
      expect(numberListener).toHaveBeenCalledWith(42);
      expect(objectListener).toHaveBeenCalledWith({ value: 100 });
      expect(voidListener).toHaveBeenCalledWith(undefined);
    });
  });

  describe('once', () => {
    it('should register one-time listeners', () => {
      const listener = vi.fn();
      emitter.once('testEvent', listener);
      
      emitter.emit('testEvent', 'first');
      emitter.emit('testEvent', 'second');
      
      expect(listener).toHaveBeenCalledWith('first');
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should return unsubscribe function', () => {
      const listener = vi.fn();
      const unsubscribe = emitter.once('testEvent', listener);
      
      unsubscribe();
      emitter.emit('testEvent', 'test');
      
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('off', () => {
    it('should remove specific listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      
      emitter.on('testEvent', listener1);
      emitter.on('testEvent', listener2);
      emitter.off('testEvent', listener1);
      emitter.emit('testEvent', 'test');
      
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledWith('test');
    });

    it('should handle removing non-existent listeners', () => {
      const listener = vi.fn();
      
      expect(() => {
        emitter.off('testEvent', listener);
      }).not.toThrow();
    });
  });

  describe('emitAsync', () => {
    it('should handle async listeners', async () => {
      const asyncListener = vi.fn().mockResolvedValue(undefined);
      emitter.on('testEvent', asyncListener);
      
      await emitter.emitAsync('testEvent', 'async');
      
      expect(asyncListener).toHaveBeenCalledWith('async');
    });

    it('should handle listener errors gracefully', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const errorListener = vi.fn().mockRejectedValue(new Error('test error'));
      const successListener = vi.fn().mockResolvedValue(undefined);
      
      emitter.on('testEvent', errorListener);
      emitter.on('testEvent', successListener);
      
      await emitter.emitAsync('testEvent', 'test');
      
      expect(errorListener).toHaveBeenCalledWith('test');
      expect(successListener).toHaveBeenCalledWith('test');
      expect(errorSpy).toHaveBeenCalled();
      
      errorSpy.mockRestore();
    });

    it('should handle once listeners with async emit', async () => {
      const onceListener = vi.fn().mockResolvedValue(undefined);
      const regularListener = vi.fn().mockResolvedValue(undefined);
      
      emitter.once('testEvent', onceListener);
      emitter.on('testEvent', regularListener);
      
      await emitter.emitAsync('testEvent', 'first');
      await emitter.emitAsync('testEvent', 'second');
      
      expect(onceListener).toHaveBeenCalledWith('first');
      expect(onceListener).toHaveBeenCalledTimes(1);
      expect(regularListener).toHaveBeenCalledTimes(2);
    });

    it('should return undefined when no listeners', async () => {
      const result = await emitter.emitAsync('testEvent', 'test');
      expect(result).toBeUndefined();
    });

    it('should handle mixed sync and async listeners', async () => {
      const syncListener = vi.fn();
      const asyncListener = vi.fn().mockResolvedValue(undefined);
      
      emitter.on('testEvent', syncListener);
      emitter.on('testEvent', asyncListener);
      
      await emitter.emitAsync('testEvent', 'test');
      
      expect(syncListener).toHaveBeenCalledWith('test');
      expect(asyncListener).toHaveBeenCalledWith('test');
    });
  });

  describe('removeAllListeners', () => {
    it('should remove all listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      
      emitter.on('testEvent', listener1);
      emitter.on('numberEvent', listener2);
      emitter.removeAllListeners();
      
      emitter.emit('testEvent', 'test');
      emitter.emit('numberEvent', 42);
      
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe functionality', () => {
    it('should return unsubscribe function from on()', () => {
      const listener = vi.fn();
      const unsubscribe = emitter.on('testEvent', listener);
      
      unsubscribe();
      emitter.emit('testEvent', 'test');
      
      expect(listener).not.toHaveBeenCalled();
    });
  });
});