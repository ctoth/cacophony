import type { BaseContext } from "./context";

const DEFAULT_INTERVAL_MS = 25;
const DEFAULT_LOOKAHEAD_SECONDS = 0.1;

export interface ScheduledCallbackHandle {
  cancel(): void;
}

type ScheduledEntry = {
  callback: (contextTime: number) => void;
  contextTime: number;
  id: number;
};

/**
 * A lightweight lookahead scheduler that uses a JavaScript timer only to
 * enqueue work before its sample-accurate AudioContext time arrives.
 */
export class Scheduler {
  private entries: ScheduledEntry[] = [];
  private nextId = 0;
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly context: BaseContext,
    private readonly intervalMs = DEFAULT_INTERVAL_MS,
    private readonly lookaheadSeconds = DEFAULT_LOOKAHEAD_SECONDS,
  ) {}

  schedule(callback: (contextTime: number) => void, contextTime: number): ScheduledCallbackHandle {
    const entry = { callback, contextTime, id: this.nextId++ };
    this.entries.push(entry);
    this.entries.sort((left, right) => left.contextTime - right.contextTime || left.id - right.id);
    this.startTimer();
    this.tick();

    return {
      cancel: () => {
        const index = this.entries.indexOf(entry);
        if (index !== -1) {
          this.entries.splice(index, 1);
          this.stopTimerWhenIdle();
        }
      },
    };
  }

  private startTimer(): void {
    if (this.timer !== undefined) {
      return;
    }
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  private tick(): void {
    const horizon = this.context.currentTime + this.lookaheadSeconds;
    let firstError: unknown;
    let callbackFailed = false;
    while (this.entries[0]?.contextTime <= horizon) {
      const entry = this.entries.shift()!;
      try {
        entry.callback(entry.contextTime);
      } catch (error) {
        if (!callbackFailed) {
          firstError = error;
          callbackFailed = true;
        }
      }
    }
    this.stopTimerWhenIdle();
    if (callbackFailed) {
      throw firstError;
    }
  }

  private stopTimerWhenIdle(): void {
    if (this.entries.length !== 0 || this.timer === undefined) {
      return;
    }
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
