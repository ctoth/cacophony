
## Cacophony: Advanced Browser Audio Library

Cacophony is an intuitive and powerful audio library designed for the modern web. It's built to simplify audio management within browser-based applications, offering a straightforward interface to the Web Audio API. Cacophony is ideal for projects that require detailed audio control, from simple sound playback to complex audio processing and 3D audio positioning.

## Key Features

- **Rich Audio Source Management**: Handle audio sources from `AudioBuffer`, URL strings, or user's microphone with ease.
- **Detailed Audio Control**: Comprehensive control over audio playback including play, stop, pause, resume, and loop.
- **3D Audio Positioning**: Create immersive audio experiences by positioning sounds in a three-dimensional space.
- **Advanced Audio Effects**: Apply and manage a variety of audio filters for enhanced sound quality.
- **Dynamic Volume and Muting**: Global and individual volume control, complete with smooth fade-in and fade-out effects.
- **Live Audio Input**: Capture and process live audio input from the user's microphone.

## Installation

```bash
npm install cacophony
```

## Quick Start

```typescript
import { Cacophony } from 'cacophony';

async function playSampleSound() {
  const cacophony = new Cacophony();
  const sound = await cacophony.createSound('path/to/audio.mp3');
  sound.play();
  sound.position = [1, 1, 1]; // Set sound position in 3D space
}

playSampleSound();
```

## Detailed API Documentation

For a complete overview of all functionality, classes, and methods, please refer to our [detailed documentation](https://cacophony.js.org).

## Additional Highlights

- **Streaming Audio**: Stream live audio directly from a URL.
- **Volume Transitions**: Employ `fadeIn` and `fadeOut` for nuanced volume control.

## Contributing

We welcome contributions! If you're interested in helping improve Cacophony, please check out our [contribution guidelines](CONTRIBUTING.md).

## License

Cacophony is open-source software licensed under the [MIT License](LICENSE.txt)
