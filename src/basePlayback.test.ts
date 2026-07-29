import { describe, expect, it } from "vitest";
import { BasePlayback } from "./basePlayback";
import type { PlaybackContainer } from "./container";

class TestPlayback extends BasePlayback {
  play(): [this] {
    this.markPlaying();
    return [this];
  }

  pause(): void {
    this.markPaused();
  }

  stop(): void {
    this.markStopped();
  }
}

describe("BasePlayback state", () => {
  it("owns the playback state transitions", () => {
    const playback = new TestPlayback({} as PlaybackContainer);

    expect(playback.isPlaying).toBe(false);
    expect(playback.isPaused).toBe(false);

    playback.play();
    expect(playback.isPlaying).toBe(true);
    expect(playback.isPaused).toBe(false);

    playback.pause();
    expect(playback.isPlaying).toBe(false);
    expect(playback.isPaused).toBe(true);

    playback.play();
    expect(playback.isPlaying).toBe(true);
    expect(playback.isPaused).toBe(false);

    playback.stop();
    expect(playback.isPlaying).toBe(false);
    expect(playback.isPaused).toBe(false);
  });
});
