import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Mock development environment before creating emitter
    process.env.NODE_ENV = 'development';
    emitter = new TypedEventEmitter<TestEvents>();
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    // Clean up environment
    delete process.env.NODE_ENV;
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

    it('should remove listeners correctly', () => {
      const listener = vi.fn();
      emitter.on('testEvent', listener);
      emitter.off('testEvent', listener);
      emitter.emit('testEvent', 'hello');
      
      expect(listener).not.toHaveBeenCalled();
    });

    it('should handle once listeners', () => {
      const listener = vi.fn();
      emitter.once('testEvent', listener);
      
      emitter.emit('testEvent', 'first');
      emitter.emit('testEvent', 'second');
      
      expect(listener).toHaveBeenCalledWith('first');
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('Development Warning System', () => {
    it('should warn when async function is added to sync-only event', () => {
      emitter.markEventAsSyncOnly('testEvent');
      
      const asyncListener = async (data: string) => {
        await Promise.resolve();
        return data;
      };
      
      emitter.on('testEvent', asyncListener);
      
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('🎵 Cacophony Warning: Async listener detected on sync event \'testEvent\'')
      );
    });

    it('should detect async functions with async keyword', () => {
      emitter.markEventAsSyncOnly('testEvent');
      
      const asyncListener = async () => {};
      emitter.on('testEvent', asyncListener);
      
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should NOT warn for functions containing await keyword but not async', () => {
      emitter.markEventAsSyncOnly('testEvent');
      
      const listener = function(data: string) {
        // This should NOT be detected as async - it's just a string containing 'await'
        return eval('(async () => { await Promise.resolve(); })()');
      };
      
      emitter.on('testEvent', listener);
      
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should NOT warn for functions using Promise but not async', () => {
      emitter.markEventAsSyncOnly('testEvent');
      
      const listener = (data: string) => {
        return Promise.resolve(data);
      };
      
      emitter.on('testEvent', listener);
      
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should NOT warn for functions using .then() but not async', () => {
      emitter.markEventAsSyncOnly('testEvent');
      
      const listener = (data: string) => {
        Promise.resolve().then(() => {});
      };
      
      emitter.on('testEvent', listener);
      
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should not warn for sync functions on sync-only events', () => {
      emitter.markEventAsSyncOnly('testEvent');
      
      const syncListener = (data: string) => {
        console.log(data);
      };
      
      emitter.on('testEvent', syncListener);
      
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should not warn for async functions on non-sync-only events', () => {
      const asyncListener = async (data: string) => {
        await Promise.resolve();
      };
      
      emitter.on('testEvent', asyncListener);
      
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should allow disabling warnings with warnOnAsync option', () => {
      emitter.markEventAsSyncOnly('testEvent');
      
      const asyncListener = async (data: string) => {
        await Promise.resolve();
      };
      
      emitter.on('testEvent', asyncListener, { warnOnAsync: false });
      
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('should not warn in production environment', () => {
      // Set production environment
      process.env.NODE_ENV = 'production';
      
      // Create new emitter in production mode
      const prodEmitter = new TypedEventEmitter<TestEvents>();
      prodEmitter.markEventAsSyncOnly('testEvent');
      
      const asyncListener = async (data: string) => {
        await Promise.resolve();
      };
      
      prodEmitter.on('testEvent', asyncListener);
      
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('Async Event Methods', () => {
    describe('onAsync', () => {
      it('should register async listeners separately', () => {
        const asyncListener = vi.fn().mockResolvedValue(undefined);
        const unsubscribe = emitter.onAsync('testEvent', asyncListener);
        
        expect(typeof unsubscribe).toBe('function');
        
        // Should not be called by regular emit
        emitter.emit('testEvent', 'sync');
        expect(asyncListener).not.toHaveBeenCalled();
      });

      it('should return unsubscribe function', () => {
        const asyncListener = vi.fn();
        const unsubscribe = emitter.onAsync('testEvent', asyncListener);
        
        unsubscribe();
        
        // Should not be called after unsubscribe
        emitter.emitAsyncOnly('testEvent', 'async');
        expect(asyncListener).not.toHaveBeenCalled();
      });

      it('should handle multiple async listeners', async () => {
        const listener1 = vi.fn().mockResolvedValue(undefined);
        const listener2 = vi.fn().mockResolvedValue(undefined);
        
        emitter.onAsync('testEvent', listener1);
        emitter.onAsync('testEvent', listener2);
        
        await emitter.emitAsyncOnly('testEvent', 'async');
        
        expect(listener1).toHaveBeenCalledWith('async');
        expect(listener2).toHaveBeenCalledWith('async');
      });
    });

    describe('onceAsync', () => {
      it('should register one-time async listeners', async () => {
        const asyncListener = vi.fn().mockResolvedValue(undefined);
        emitter.onceAsync('testEvent', asyncListener);
        
        await emitter.emitAsyncOnly('testEvent', 'first');
        await emitter.emitAsyncOnly('testEvent', 'second');
        
        expect(asyncListener).toHaveBeenCalledWith('first');
        expect(asyncListener).toHaveBeenCalledTimes(1);
      });

      it('should return unsubscribe function', async () => {
        const asyncListener = vi.fn();
        const unsubscribe = emitter.onceAsync('testEvent', asyncListener);
        
        unsubscribe();
        
        await emitter.emitAsyncOnly('testEvent', 'async');
        expect(asyncListener).not.toHaveBeenCalled();
      });
    });

    describe('offAsync', () => {
      it('should remove async listeners', async () => {
        const asyncListener = vi.fn();
        emitter.onAsync('testEvent', asyncListener);
        emitter.offAsync('testEvent', asyncListener);
        
        await emitter.emitAsyncOnly('testEvent', 'async');
        expect(asyncListener).not.toHaveBeenCalled();
      });

      it('should only remove matching listeners', async () => {
        const listener1 = vi.fn();
        const listener2 = vi.fn();
        
        emitter.onAsync('testEvent', listener1);
        emitter.onAsync('testEvent', listener2);
        emitter.offAsync('testEvent', listener1);
        
        await emitter.emitAsyncOnly('testEvent', 'async');
        
        expect(listener1).not.toHaveBeenCalled();
        expect(listener2).toHaveBeenCalledWith('async');
      });
    });
  });

  describe('Enhanced emitAsync', () => {
    it('should emit to both sync and async listeners', async () => {
      const syncListener = vi.fn();
      const asyncListener = vi.fn().mockResolvedValue(undefined);
      
      emitter.on('testEvent', syncListener);
      emitter.onAsync('testEvent', asyncListener);
      
      const results = await emitter.emitAsync('testEvent', 'both');
      
      expect(syncListener).toHaveBeenCalledWith('both');
      expect(asyncListener).toHaveBeenCalledWith('both');
      expect(results).toHaveLength(2);
      expect(results.every(r => r.status === 'fulfilled')).toBe(true);
    });

    it('should handle listener errors gracefully', async () => {
      const errorListener = vi.fn().mockRejectedValue(new Error('Test error'));
      const successListener = vi.fn().mockResolvedValue(undefined);
      
      emitter.onAsync('testEvent', errorListener);
      emitter.onAsync('testEvent', successListener);
      
      const results = await emitter.emitAsync('testEvent', 'test');
      
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('rejected');
      expect(results[1].status).toBe('fulfilled');
    });

    it('should respect timeout parameter', async () => {
      const slowListener = vi.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 100))
      );
      
      emitter.onAsync('testEvent', slowListener);
      
      const results = await emitter.emitAsync('testEvent', 'test', 50);
      
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('rejected');
      expect((results[0] as PromiseRejectedResult).reason.message).toContain('timeout');
    });

    it('should clean up one-time listeners after emit', async () => {
      const onceListener = vi.fn().mockResolvedValue(undefined);
      const regularListener = vi.fn().mockResolvedValue(undefined);
      
      emitter.once('testEvent', onceListener);
      emitter.onceAsync('testEvent', onceListener);
      emitter.on('testEvent', regularListener);
      emitter.onAsync('testEvent', regularListener);
      
      await emitter.emitAsync('testEvent', 'first');
      await emitter.emitAsync('testEvent', 'second');
      
      // Once listeners should only be called once
      expect(onceListener).toHaveBeenCalledTimes(2); // once sync + once async
      // Regular listeners should be called twice
      expect(regularListener).toHaveBeenCalledTimes(4); // twice sync + twice async
    });

    it('should return empty array when no listeners', async () => {
      const results = await emitter.emitAsync('testEvent', 'test');
      expect(results).toEqual([]);
    });
  });

  describe('emitAsyncOnly', () => {
    it('should emit only to async listeners', async () => {
      const syncListener = vi.fn();
      const asyncListener = vi.fn().mockResolvedValue(undefined);
      
      emitter.on('testEvent', syncListener);
      emitter.onAsync('testEvent', asyncListener);
      
      await emitter.emitAsyncOnly('testEvent', 'async-only');
      
      expect(syncListener).not.toHaveBeenCalled();
      expect(asyncListener).toHaveBeenCalledWith('async-only');
    });

    it('should handle errors in async listeners', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const errorListener = vi.fn().mockRejectedValue(new Error('Async error'));
      
      emitter.onAsync('testEvent', errorListener);
      
      await emitter.emitAsyncOnly('testEvent', 'test');
      
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Error in async listener for event testEvent:'),
        expect.any(Error)
      );
      
      errorSpy.mockRestore();
    });

    it('should clean up one-time async listeners', async () => {
      const onceAsyncListener = vi.fn().mockResolvedValue(undefined);
      
      emitter.onceAsync('testEvent', onceAsyncListener);
      
      await emitter.emitAsyncOnly('testEvent', 'first');
      await emitter.emitAsyncOnly('testEvent', 'second');
      
      expect(onceAsyncListener).toHaveBeenCalledWith('first');
      expect(onceAsyncListener).toHaveBeenCalledTimes(1);
    });

    it('should resolve immediately when no async listeners', async () => {
      const syncListener = vi.fn();
      emitter.on('testEvent', syncListener);
      
      const result = await emitter.emitAsyncOnly('testEvent', 'test');
      
      expect(result).toBeUndefined();
      expect(syncListener).not.toHaveBeenCalled();
    });
  });

  describe('removeAllListeners', () => {
    it('should remove all sync and async listeners', async () => {
      const syncListener = vi.fn();
      const asyncListener = vi.fn();
      
      emitter.on('testEvent', syncListener);
      emitter.onAsync('testEvent', asyncListener);
      
      emitter.removeAllListeners();
      
      emitter.emit('testEvent', 'sync');
      await emitter.emitAsyncOnly('testEvent', 'async');
      
      expect(syncListener).not.toHaveBeenCalled();
      expect(asyncListener).not.toHaveBeenCalled();
    });
  });

  describe('markEventAsSyncOnly', () => {
    it('should mark events as sync-only', () => {
      emitter.markEventAsSyncOnly('testEvent');
      
      const asyncListener = async () => {};
      emitter.on('testEvent', asyncListener);
      
      expect(consoleWarnSpy).toHaveBeenCalled();
    });

    it('should support multiple sync-only events', () => {
      emitter.markEventAsSyncOnly('testEvent');
      emitter.markEventAsSyncOnly('numberEvent');
      
      const asyncListener1 = async () => {};
      const asyncListener2 = async () => {};
      
      emitter.on('testEvent', asyncListener1);
      emitter.on('numberEvent', asyncListener2);
      
      expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('TypeScript type safety', () => {
    it('should enforce correct event types', () => {
      const stringListener = vi.fn();
      const numberListener = vi.fn();
      const objectListener = vi.fn();
      const voidListener = vi.fn();
      
      emitter.on('testEvent', stringListener);
      emitter.on('numberEvent', numberListener);
      emitter.on('objectEvent', objectListener);
      emitter.on('voidEvent', voidListener);
      
      emitter.emit('testEvent', 'hello');
      emitter.emit('numberEvent', 42);
      emitter.emit('objectEvent', { value: 100 });
      emitter.emit('voidEvent', undefined);
      
      expect(stringListener).toHaveBeenCalledWith('hello');
      expect(numberListener).toHaveBeenCalledWith(42);
      expect(objectListener).toHaveBeenCalledWith({ value: 100 });
      expect(voidListener).toHaveBeenCalledWith(undefined);
    });
  });
});