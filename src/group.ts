import type { Bus } from "./bus";
import type { BaseSound, FadeType, LoopCount, PlayOptions, Position } from "./cacophony";
import type { BiquadFilterNode } from "./context";
import type { Playback } from "./playback";
import type { Sound } from "./sound";

export class Group implements BaseSound {
  private _position: Position = [0, 0, 0];
  loopCount: LoopCount = 0;
  private playIndex: number = 0;

  constructor(public sounds: Sound[] = []) {}

  /**
   * Prepares a random sound from the group for playback.
   * @returns The playback object representing the prepared sound, or undefined if the group is empty.
   */
  preplayRandom(): Playback | undefined {
    if (this.sounds.length === 0) {
      return undefined;
    }
    const randomSound = this.randomSound();
    const playbacks = randomSound.preplay();
    return playbacks.length > 0 ? playbacks[0] : undefined;
  }

  /**
   * Plays a random sound from the group.
   * @param options - Options for configuring fade behavior.
   * @returns The playback object representing the played sound, or undefined if the group is empty.
   */
  playRandom(options?: PlayOptions): Playback | undefined {
    if (this.sounds.length === 0) {
      return undefined;
    }
    return this.randomSound().play(options)[0];
  }

  /**
   * Prepares the sounds in the group for playback in a specific order.
   *
   * @param shouldLoop - Indicates whether the sounds should be prepared for looping.
   * @returns The playback object representing the first sound being prepared, or undefined if the group is empty.
   */
  preplayOrdered(shouldLoop: boolean = true): Playback | undefined {
    if (this.sounds.length === 0) {
      return undefined;
    }
    if (this.playIndex >= this.sounds.length) {
      return undefined;
    }
    const sound = this.sounds[this.playIndex];
    const playbacks = sound.preplay();
    if (playbacks.length === 0) {
      return undefined;
    }
    this.playIndex = (this.playIndex + 1) % this.sounds.length;
    if (!shouldLoop && this.playIndex === 0) {
      this.playIndex = this.sounds.length;
    }
    return playbacks[0];
  }

  /**
   * Plays the sounds in the group in a specific order.
   *
   * @param shouldLoop - Indicates whether the sounds should be played in a loop.
   * @param options - Options for configuring fade behavior.
   * @returns The playback object representing the first sound being played, or undefined if the group is empty.
   */
  playOrdered(shouldLoop: boolean = true, options?: PlayOptions): Playback | undefined {
    if (this.sounds.length === 0 || this.playIndex >= this.sounds.length) {
      return undefined;
    }
    const playbacks = this.sounds[this.playIndex].play(options);
    if (playbacks.length === 0) {
      return undefined;
    }
    this.playIndex = (this.playIndex + 1) % this.sounds.length;
    if (!shouldLoop && this.playIndex === 0) {
      this.playIndex = this.sounds.length;
    }
    return playbacks[0];
  }

  /**
   * Restarts ordered playback from the first sound in the group.
   */
  resetOrder(): void {
    this.playIndex = 0;
  }

  get duration() {
    return this.sounds.map((sound) => sound.duration).reduce((a, b) => Math.max(a, b), 0);
  }

  seek(time: number): void {
    this.sounds.forEach((sound) => sound.seek?.(time));
  }

  addSound(sound: Sound): void {
    this.sounds.push(sound);
  }

  /**
   * Returns a random sound from the group.
   * @throws Error if the group is empty.
   */
  randomSound(): Sound {
    if (this.sounds.length === 0) {
      throw new Error("Cannot get a random sound from an empty group");
    }
    const randomIndex = Math.floor(Math.random() * this.sounds.length);
    return this.sounds[randomIndex];
  }

  preplay(): Playback[] {
    const playbacks = this.sounds.map((sound) => sound.preplay());
    return playbacks.flat();
  }

  /***
   *   Plays all sounds in the group.
   *  @returns {Playback[]} An array of Playback objects, one for each sound in the group.
   */

  play(options?: PlayOptions): Playback[] {
    return this.sounds.flatMap((sound) => sound.play(options));
  }

  /**
   * A boolean indicating whether any of the sounds in the group are currently playing.
   * @returns {boolean} True if any sound is playing, false otherwise.
   */

  get isPlaying(): boolean {
    return this.sounds.some((sound) => sound.isPlaying);
  }

  /**
   * Stops all the sounds in the group.
   */

  stop(): void {
    this.sounds.forEach((sound) => sound.stop());
  }

  pause(): void {
    this.sounds.forEach((sound) => sound.pause());
  }

  fadeTo(value: number, duration: number, type?: FadeType): Promise<void> {
    return Promise.all(this.sounds.map((sound) => sound.fadeTo(value, duration, type))).then(() => {});
  }

  fadeIn(duration: number, type?: FadeType): Promise<void> {
    return Promise.all(this.sounds.map((sound) => sound.fadeIn(duration, type))).then(() => {});
  }

  fadeOut(duration: number, type?: FadeType): Promise<void> {
    return Promise.all(this.sounds.map((sound) => sound.fadeOut(duration, type))).then(() => {});
  }

  stopWithFade(duration: number, type?: FadeType): Promise<void> {
    return Promise.all(this.sounds.map((sound) => sound.stopWithFade(duration, type))).then(() => {});
  }

  loop(loopCount?: LoopCount): LoopCount {
    if (loopCount === undefined) {
      return this.loopCount;
    }
    this.loopCount = loopCount;
    this.sounds.forEach((sound) => sound.loop(loopCount));
    return this.loopCount;
  }

  /**
   * Adds a filter to all sounds in the group.
   * Filters are cloned to playbacks, not shared.
   */
  addFilter(filter: BiquadFilterNode): void {
    this.sounds.forEach((sound) => sound.addFilter(filter));
  }

  /**
   * Removes a filter from all sounds in the group.
   */
  removeFilter(filter: BiquadFilterNode): void {
    this.sounds.forEach((sound) => sound.removeFilter(filter));
  }

  /**
   * Routes every sound in this group to the specified Bus (or back to
   * master). Fans the call out to every member; see {@link Sound.routeTo}
   * for full semantics. With a `sendGain`, adds a per-sound send instead
   * of redirecting primary routing.
   */
  routeTo(target: Bus | string, sendGain?: number): void {
    if (sendGain !== undefined) {
      this.sounds.forEach((sound) => sound.routeTo(target, sendGain));
    } else {
      this.sounds.forEach((sound) => sound.routeTo(target));
    }
  }

  set position(position: [number, number, number]) {
    this._position = position;
    this.sounds.forEach((sound) => (sound.position = this._position));
  }

  get position(): [number, number, number] {
    return this._position;
  }

  get volume(): number {
    if (this.sounds.length === 0) {
      return 1;
    }
    return this.sounds.map((sound) => sound.volume).reduce((a, b) => a + b, 0) / this.sounds.length;
  }

  set volume(volume: number) {
    this.sounds.forEach((sound) => (sound.volume = volume));
  }

  get playbackRate(): number {
    if (this.sounds.length === 0) {
      return 1;
    }
    return this.sounds[0].playbackRate;
  }

  set playbackRate(rate: number) {
    this.sounds.forEach((sound) => (sound.playbackRate = rate));
  }
}
