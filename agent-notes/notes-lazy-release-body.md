Prepare version 0.31.0 for the lazy audio loading and tree-shaking improvements merged in #225. Update only the package and lockfile version fields.

The pre-1.0 minor bump makes the packaging and advanced worklet URL type changes opt-in for consumers on 0.30.x. Normal factory calls remain compatible. After this PR passes CI and merges, tag the merged commit as v0.31.0 to trigger the existing build, test, and npm provenance publication workflow.
