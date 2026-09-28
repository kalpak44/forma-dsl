import ManifoldModule from 'manifold-3d';

let modulePromise = null;

/// Loads and sets up the Manifold WASM module, once per page or process.
///
/// Every geometry call needs it, so this is memoized on the promise rather than the result:
/// two models evaluating concurrently at startup must not each start an instantiation.
export function loadKernel(options = {}) {
  if (!modulePromise) {
    modulePromise = ManifoldModule(options).then((wasm) => {
      wasm.setup();
      return wasm;
    });
  }
  return modulePromise;
}

/// Resolution for curved surfaces, as Manifold's global defaults.
///
/// These are global to the kernel rather than per-model, so a viewer that renders a draft
/// preview and then a final pass has to set them around each evaluation, not once at load.
export async function setQuality({ minAngle, minEdgeLength, segments } = {}) {
  const wasm = await loadKernel();
  if (minAngle !== undefined) wasm.setMinCircularAngle(minAngle);
  if (minEdgeLength !== undefined) wasm.setMinCircularEdgeLength(minEdgeLength);
  if (segments !== undefined) wasm.setCircularSegments(segments);
}

export async function resetQuality() {
  const wasm = await loadKernel();
  wasm.resetToCircularDefaults();
}
