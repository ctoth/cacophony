export interface ICache {
  getAudioBuffer(context: AudioContext, url: string): Promise<AudioBuffer>;
  clearMemoryCache(): void;
}
