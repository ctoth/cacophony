Platform audio interruptions are now observable and recover automatically while the page is visible. Explicit user pauses survive foreground signals, gestures, and previously pending recovery attempts. Context events share one deduplicating publisher, and `dispose()` removes platform, gesture, and public event listeners while the caller retains ownership of context and sound cleanup.

Output selection delegates to the actual browser or Node context through `setOutputDevice()`; `outputDevice` reads its current sink. `sinkChange` reports the active sink, while `devicechange` reports available audio outputs and discards stale asynchronous inventories. Switching preserves the context and graph, permissions remain with the app, and platform errors propagate unchanged. Unsupported contexts use the interim Error permitted by #203 until #169 lands.

Adds red-first regressions, real Node sink coverage, native browser transition/device/sink tests, published-type consumer coverage, and a mobile hardware/interruption test matrix. The existing autoplay watcher receives a user-pause guard so gesture fallback respects the same intent. Firefox CI now provides a virtual PulseAudio output: Linux reproduction confirmed native `resume()` hangs without an audio server and both session tests pass with one.

Validation:
- Linux `npm run build` and `npx vitest run --maxWorkers 4`: 104 files, 1401 tests passed, including the real Node output-selection regression.
- Windows full suite: 104 files, 1399 tests passed, followed by the final focused suite containing two additional regressions (30 tests passed).
- Windows `npx playwright test`: 64 passed, 20 capability skips. Chromium/Firefox session tests pass; Chromium silent sink passes. Linux WebKit session coverage runs in CI. Physical hot-plug and iOS interruptions remain manual checks.
- `npm run check:package-types`, `npx biome ci .`, and `npm run changelog:check` passed.
- actionlint 1.7.12 passed. zizmor 1.30.1 reported pre-existing action-pin, token-permission, and checkout-credential findings; the added virtual-audio step introduces none of those findings.

Closes #209
Closes #203
