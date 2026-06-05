/**
 * Whether the optional `node-web-audio-api` native backend is installed in the
 * current environment.
 *
 * Real-backend test suites gate on this with `describe.skipIf(!nodeBackendAvailable)`
 * so environments without the optional dependency skip those suites instead of
 * failing. The notable case is Node < 22: the package's `engines` field requires
 * `node >= 22`, so npm silently omits it (it is an `optionalDependency`) on the
 * Node 20 CI leg, while the pure-JS browser-library tests still run there.
 *
 * Resolution-only (`require.resolve`) — this neither executes the module nor
 * loads the native binary, and does not depend on a built `dist/`.
 */
import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);

export const nodeBackendAvailable: boolean = (() => {
  try {
    nodeRequire.resolve("node-web-audio-api");
    return true;
  } catch {
    return false;
  }
})();
