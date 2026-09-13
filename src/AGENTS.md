# Native audio regressions

Tests that import the optional Node audio backend must use the existing
`nodeBackendAvailable` guard, matching the offline test suites. CI includes
environments where that optional dependency is unavailable. Keep mock-based
regressions unconditional and verify native regressions actually run and pass
in a supported environment before claiming native rendering acceptance.
