import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Background service worker build.
 *
 * Emits a single self-contained ES module at extension/background.js, matching the
 * `background.service_worker` entry in public/manifest.json.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'extension',
    // The main UI build cleans extension/ via npm run clean; do not wipe it here.
    emptyOutDir: false,
    target: 'es2022',
    sourcemap: false,
    minify: true,
    rollupOptions: {
      input: {
        background: 'src/background/index.ts',
      },
      output: {
        format: 'es',
        entryFileNames: '[name].js',
        inlineDynamicImports: true,
      },
    },
  },
});
