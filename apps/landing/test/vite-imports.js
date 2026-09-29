/**
 * Module hooks for the two import forms only a bundler understands.
 *
 * The demo imports the kernel's `.wasm` with Vite's `?url` suffix and the page's entry
 * imports a stylesheet, neither of which Node can resolve — so without these the module
 * cannot be loaded at all, let alone tested. `?url` becomes the file's path on disk, which
 * is what the suffix means, and a stylesheet becomes an empty module.
 */
import { fileURLToPath } from 'node:url';

/**
 * @param {string} source The module's source.
 * @returns {string} A URL Node can import it from.
 */
const moduleOf = (source) => `data:text/javascript,${encodeURIComponent(source)}`;

/**
 * @param {string} specifier The import specifier.
 * @param {object} context The resolution context.
 * @param {Function} nextResolve The next hook in the chain.
 * @returns {Promise<object>} Where to load the module from.
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith('?url')) {
    const target = await nextResolve(specifier.slice(0, -'?url'.length), context);
    const source = `export default ${JSON.stringify(fileURLToPath(target.url))};`;
    return { url: moduleOf(source), format: 'module', shortCircuit: true };
  }
  if (specifier.endsWith('.css')) {
    return { url: moduleOf('export default {};'), format: 'module', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
