import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

export default defineConfig({
  // Pages serves the project from a subdirectory, so the base has to be settable without
  // editing this file. Deploys pass VITE_BASE=/forma-dsl/; local dev needs nothing.
  base: process.env.VITE_BASE ?? '/',

  // The demo runs the real kernel, which is a WASM module fetched at runtime rather than
  // something that can be inlined as a data URL.
  assetsInclude: ['**/*.wasm'],

  build: {
    // The landing page is the site's root, so it owns dist/ and is the one build that
    // clears it. The editor writes dist/editor/ and the manual dist/docs/ afterwards, which
    // is why `npm run build` runs this one first.
    outDir: fileURLToPath(new URL('../../dist', import.meta.url)),
    emptyOutDir: true,

    target: 'es2022',
    sourcemap: true,

    rollupOptions: {
      // Three pages, one build: the legal pages share the shell, the theme and the
      // stylesheet with the landing page, so they are entries rather than a second app.
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        privacy: fileURLToPath(new URL('privacy.html', import.meta.url)),
        terms: fileURLToPath(new URL('terms.html', import.meta.url)),
      },
      output: {
        // The legal pages load the shell and nothing else. Splitting three and the kernel
        // out keeps them from being pulled into that entry, and keeps the hero's renderer
        // cached across a release that only touches the copy.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('/three/')) return 'three';
          if (id.includes('/manifold-3d/')) return 'kernel';
          return undefined;
        },
      },
    },
  },

  server: { port: 5174 },
});
