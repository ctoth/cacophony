import type { BaseSound, LoopCount, Position } from "./cacophony";

import { Playback } from "./playback";
import { Sound } from "./sound";

export class Group implements BaseSound {
  private _position: Position = [0, 0, 0];
  loopCount: LoopCount = 0;
  private playIndex: number = 0;

  constructor(public sounds: Sound[] = []) {}

  /**
   * Prepares a random sound from the group for playback.
   * @returns The playback object representing the prepared sound.
   * @throws Error if the group is empty and there are no sounds to prepare.
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
   * @returns The playback object representing the played sound, or undefined if the group is empty.
   */
  playRandom(): Playback | undefined {
    const playback = this.preplayRandom();
    if (playback) {
      playback.play();
    }
    return playback;
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
   * @returns The playback object representing the first sound being played, or undefined if the group is empty.
   */
  playOrdered(shouldLoop: boolean = true): Playback | undefined {
    const playback = this.preplayOrdered(shouldLoop);
    if (playback) {
      playback.play();
    }
    return playback;
  }

  get duration() {
    return this.sounds
      .map((sound) => sound.duration)
      .reduce((a, b) => Math.max(a, b), 0);
  }

  seek(time: number): void {
    this.sounds.forEach((sound) => sound.seek && sound.seek(time));
  }

  addSound(sound: Sound): void {
    this.sounds.push(sound);
  }

  /**
   * Returns a random sound from the group.
   * @returns A random Sound object from the group.
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
    return this.sounds.reduce<Playback[]>((playbacks, sound) => {
      sound.loop && sound.loop(this.loopCount);
      return playbacks.concat(sound.preplay());
    }, []);
  }

  /***
   *   Plays all sounds in the group.
   *  @returns {Playback[]} An array of Playback objects, one for each sound in the group.
   */

  play(): Playback[] {
    return this.preplay().map((playback) => {
      const result = playback.play();
      return Array.isArray(result) ? result[0] : result;
    });
  }

  /**
   * A boolean indicating whether any of the sounds in the group are currently playing.
   * @returns {boolean} True if any sound is playing, false otherwise.
   */

  get isPlaying(): boolean {
    return this.sounds.some((sound) => sound.isPlaying) || this.playbacks.some((playback) => playback.isPlaying);
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

  loop(loopCount?: LoopCount): LoopCount {
    if (loopCount === undefined) {
      return this.loopCount;
    }
    this.loopCount = loopCount;
    this.sounds.forEach((sound) => sound.loop(loopCount));
    return this.loopCount;
  }

  addFilter(filter: BiquadFilterNode): void {
    this.sounds.forEach((sound) => sound.addFilter(filter));
  }

  removeFilter(filter: BiquadFilterNode): void {
    this.sounds.forEach((sound) => sound.removeFilter(filter));
  }

  set position(position: [number, number, number]) {
    this._position = position;
    this.sounds.forEach((sound) => (sound.position = this._position));
  }

  get position(): [number, number, number] {
    return this._position;
  }

  get volume(): number {
    return (
      this.sounds.map((sound) => sound.volume).reduce((a, b) => a + b, 0) /
      this.sounds.length
    );
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
