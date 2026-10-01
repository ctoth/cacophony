# Native audio regressions

Tests that import the optional Node audio backend must use the existing
`nodeBackendAvailable` guard, matching the offline test suites. CI includes
environments where that optional dependency is unavailable. Keep mock-based
regressions unconditional and verify native regressions actually run and pass
in a supported environment before claiming native rendering acceptance.

Use browser offline contexts for tests that interrupt rendering with `suspend()`
and `resume()`. In node-web-audio-api 2.0.0, suspend registration is asynchronous
and can lose a race with `startRendering()`, rejecting with `InvalidStateError`.
Keep static native rendering checks and mock automation checks in Vitest; move
interrupted waveform assertions to the existing Playwright fixtures. Chromium
must execute those assertions; engines without offline suspend/resume may skip.
Do not mask this race with sleeps or retries.
