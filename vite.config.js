import { defineConfig } from 'vite';

export default defineConfig({
  // The kernel is a WASM module loaded at runtime, so it must be copied verbatim rather
  // than inlined as a data URL.
  assetsInclude: ['**/*.wasm'],
  build: { target: 'es2022' },
  server: { port: 5173 },
});
