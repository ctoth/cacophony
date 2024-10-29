import { AudioContext } from "../context";
export interface ICache {
  getAudioBuffer(context: AudioContext, url: string): Promise<AudioBuffer>;
  clearMemoryCache(): void;
}
