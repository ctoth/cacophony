Importing Cacophony currently makes MediaBunny and all worklet payloads eager, and leaf imports can retain unrelated FFT code. Load the WebCodecs adapter and each worklet URL on demand, preserve ESM/CJS module boundaries, and declare package side effects so consumer bundlers can discard unused modules.

Ordinary imports and factory calls retain their existing signatures and behavior. The advanced worklet URL input now accepts a string or asynchronous loader; the runtime URL resolver still receives a string. `loadWorklets()` remains the preload-all API. Cancellation is checked around the new asynchronous boundaries.

Consumer Rollup fixtures show initial gzip sizes changing from 274,842 to 35,962 bytes for Cacophony, 11,045 to 4,033 for AudioCache, and 12,864 to 342 for ReverbEffect. Bundle gates check lazy MediaBunny/worklet placement, leaf-import isolation, and CommonJS lazy loading. Browser smoke coverage exercises the built ESM package; documentation explains code splitting and deployment.

Validation: full build and packed type consumer passed; 1,191 tests passed with no reported type errors; explicit new-test TypeScript checks passed; browser suite passed 10 tests with 5 Windows WebKit capability skips; built Node distortion render passed. Existing 35 TypeDoc warnings remain. Linux browser coverage runs in PR CI.

Also fixes an existing headless CI failure in the sprite round-trip fixture by selecting the supported null audio sink. The same failure was verified on current master; the test still generates, decodes, and checks the real atlas. All four sprite tests pass locally.
