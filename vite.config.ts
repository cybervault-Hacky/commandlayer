import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

/**
 * UI build: popup, side panel and command center.
 *
 * The service worker is built separately (see vite.config.worker.ts) so the
 * worker output stays a single self-contained ES module, which is the most
 * robust layout for a Manifest V3 background worker.
 */
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: 'extension',
    // The worker build runs first and writes extension/background.js; never wipe it.
    emptyOutDir: false,
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      input: {
        popup: fileURLToPath(new URL('./popup.html', import.meta.url)),
        sidepanel: fileURLToPath(new URL('./sidepanel.html', import.meta.url)),
        'command-center': fileURLToPath(new URL('./command-center.html', import.meta.url)),
      },
    },
  },
});
