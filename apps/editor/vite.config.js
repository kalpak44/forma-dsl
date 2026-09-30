import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // The editor is served from /editor/ under whatever base the deploy passes: Pages serves
  // the project from a subdirectory, so VITE_BASE=/forma-dsl/ makes this /forma-dsl/editor/.
  // `npm run dev` serves the editor alone at the root, where that prefix would be a 404.
  base: command === 'serve' ? '/' : `${process.env.VITE_BASE ?? '/'}editor/`,

  // The kernel is a WASM module loaded at runtime, so it must be copied verbatim rather
  // than inlined as a data URL.
  assetsInclude: ['**/*.wasm'],

  build: {
    // The published site is one artifact: the landing page at the root, the editor here
    // under /editor/, and the manual under /docs/. Outside this workspace, so `emptyOutDir`
    // has to be explicit — Vite will not clear a directory above its root without being
    // told to. Only this app's own directory is cleared; the landing page owns dist/ and
    // builds first.
    outDir: fileURLToPath(new URL('../../dist/editor', import.meta.url)),
    emptyOutDir: true,

    target: 'es2022',
    // Shipped: the app is MIT and the stack traces a user can report are worth more than
    // the bandwidth, which is only spent when devtools is actually open.
    sourcemap: true,
    rollupOptions: {
      output: {
        // Three, CodeMirror and the app change on completely different schedules. One
        // bundle means every fix to a block definition re-downloads all of three.js.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/three/')) return 'three';
          if (/\/(@codemirror|@lezer|codemirror|style-mod|w3c-keyname|crelt)\//.test(id)) return 'editor';
          if (id.includes('/manifold-3d/')) return 'kernel';
          return undefined;
        },
      },
    },
  },

  server: { port: 5173 },
}));
