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
  preplayRandom(): Playback {
    if (this.sounds.length === 0) {
      throw new Error("Cannot prepare a random sound from an empty group");
    }
    const randomIndex = Math.floor(Math.random() * this.sounds.length);
    const randomSound = this.sounds[randomIndex] as Sound;
    const playback = randomSound.preplay();
    return playback[0];
  }

  /**
   * Plays a random sound from the group.
   * @returns The playback object representing the played sound.
   * @throws Error if the group is empty and there are no sounds to play.
   */
  playRandom(): Playback {
    const playback = this.preplayRandom();
    playback.play();
    return playback;
  }

  /**
   * Prepares the sounds in the group for playback in a specific order.
   *
   * @param shouldLoop - Indicates whether the sounds should be prepared for looping.
   * @returns The playback object representing the first sound being prepared.
   * @throws Error if the group is empty.
   */
  preplayOrdered(shouldLoop: boolean = true): Playback {
    if (this.sounds.length === 0) {
      throw new Error("Cannot prepare an ordered sound from an empty group");
    }
    const sound = this.sounds[this.playIndex] as Sound;
    const playback = sound.preplay()[0];
    this.playIndex++;
    if (this.playIndex >= this.sounds.length) {
      if (shouldLoop) {
        this.playIndex = 0;
      } else {
        this.playIndex = this.sounds.length; // Set to length to indicate end of list
      }
    }
    return playback;
  }

  /**
   * Plays the sounds in the group in a specific order.
   *
   * @param shouldLoop - Indicates whether the sounds should be played in a loop.
   * @returns The playback object representing the first sound being played.
   * @throws Error if the group is empty.
   */
  playOrdered(shouldLoop: boolean = true): Playback {
    const playback = this.preplayOrdered(shouldLoop);
    playback.play();
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
    return this.preplay().map((playback) => playback.play()[0]);
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
