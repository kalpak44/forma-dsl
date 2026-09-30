/**
 * Loading the Manifold WASM module, and the global knobs for curve resolution.
 *
 * One instance per page or process. Memoized here rather than left to each caller, because
 * two models evaluating concurrently at startup must not each start an instantiation — and
 * because the resolution controls below are global to the module, so there is nowhere else
 * they could honestly live.
 */

/** @import { Kernel, QualityOptions } from '../index.js' */

import ManifoldModule from 'manifold-3d';

/**
 * The single in-flight or settled load of the WASM module.
 *
 * @type {Promise<Kernel> | null}
 */
let modulePromise = null;

/**
 * Loads and sets up the Manifold WASM module, once per page or process.
 *
 * Every geometry call needs it, so this is memoized on the promise rather than the result:
 * two models evaluating concurrently at startup must not each start an instantiation.
 *
 * Only the first call's options take effect, since later calls get the memoized promise.
 *
 * @param {{ locateFile: () => string }} [options] Passed to the module factory. A bundler
 *   that fingerprints the `.wasm` file needs `locateFile` to point at the built URL,
 *   because the module cannot find it by its own relative path.
 * @returns {Promise<Kernel>} The set-up module.
 */
export function loadKernel(options) {
  if (!modulePromise) {
    modulePromise = ManifoldModule(options).then((wasm) => {
      wasm.setup();
      return wasm;
    }, (error) => {
      // A rejected promise would be memoized along with everything else, so a transient
      // failure — a WASM fetch that lost the network — would be permanent for the page.
      modulePromise = null;
      throw error;
    });
  }
  return modulePromise;
}

/**
 * Sets the resolution used for curved surfaces.
 *
 * These are global to the kernel rather than per-model, so a viewer that renders a draft
 * preview and then a final pass has to set them around each evaluation, not once at load.
 *
 * Each option is left alone when omitted.
 *
 * @param {QualityOptions} [options] The resolution controls.
 * @returns {Promise<void>} Resolves once the kernel has been loaded and configured.
 */
export async function setQuality(options = {}) {
  const { minAngle, minEdgeLength, segments } = options;
  const wasm = await loadKernel();
  if (minAngle !== undefined) wasm.setMinCircularAngle(minAngle);
  if (minEdgeLength !== undefined) wasm.setMinCircularEdgeLength(minEdgeLength);
  if (segments !== undefined) wasm.setCircularSegments(segments);
}

/**
 * Restores the kernel's own curve resolution defaults.
 *
 * @returns {Promise<void>} Resolves once the kernel has been loaded and reset.
 */
export async function resetQuality() {
  const wasm = await loadKernel();
  wasm.resetToCircularDefaults();
}
