import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the project from a subdirectory, so the base has to be settable
  // without editing this file. Deploys pass VITE_BASE=/forma-dsl/; local dev needs nothing.
  base: process.env.VITE_BASE ?? '/',

  // The kernel is a WASM module loaded at runtime, so it must be copied verbatim rather
  // than inlined as a data URL.
  assetsInclude: ['**/*.wasm'],

  build: {
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
});
