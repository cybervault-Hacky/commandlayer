import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Content-script build (Phase 2 — Page Intelligence).
 *
 * Emits a single self-contained IIFE at dist/content.js, matching the
 * `content_scripts` entry in public/manifest.json. The bundle is
 * extraction-only: no network calls, no command execution, no secrets.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'dist',
    // The main UI build cleans dist/ via npm run clean; do not wipe it here.
    emptyOutDir: false,
    target: 'es2022',
    sourcemap: false,
    minify: true,
    rollupOptions: {
      input: {
        content: 'src/content/contentScript.ts',
      },
      output: {
        format: 'iife',
        entryFileNames: '[name].js',
        inlineDynamicImports: true,
      },
    },
  },
});
