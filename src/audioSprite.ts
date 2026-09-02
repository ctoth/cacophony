import type { LoopCount } from "./cacophony";
import type { Sound } from "./sound";

/** A named, immutable region of an audio atlas, expressed in seconds. */
export interface SpriteRegion {
  readonly start: number;
  readonly duration: number;
  readonly loopCount?: LoopCount;
}

/** Named regions used to construct an {@link AudioSprite}. */
export type SpriteMap = Readonly<Record<string, SpriteRegion>>;

/** Options shared by every child Sound created for a sprite. */
export interface CreateSpriteOptions {
  panType?: import("./cacophony").PanType;
  signal?: AbortSignal;
}

/**
 * A typed registry and lifetime owner for the ordinary Sounds in an atlas.
 * Playback and configuration remain child-Sound operations.
 */
export class AudioSprite<K extends string = string> {
  readonly sounds: Readonly<Record<K, Sound>>;
  readonly names: readonly K[];
  private cleanedUp = false;

  /** @internal Construct sprites through Cacophony.createSprite(). */
  constructor(sounds: Record<K, Sound>, names: readonly K[]) {
    this.sounds = Object.freeze(sounds);
    this.names = Object.freeze([...names]);
  }

  get(name: K): Sound {
    if (!Object.hasOwn(this.sounds, name)) {
      throw new Error(`Unknown audio sprite name: ${name}`);
    }
    return this.sounds[name];
  }

  has(name: string): name is K {
    return Object.hasOwn(this.sounds, name);
  }

  cleanup(): void {
    if (this.cleanedUp) return;
    this.cleanedUp = true;
    for (const name of this.names) {
      this.sounds[name].cleanup();
    }
  }
}
