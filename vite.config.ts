/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

const version = process.env.RELEASE_VERSION ?? 'dev';

export default defineConfig({
  root: '.',
  define: {
    __CARD_VERSION__: JSON.stringify(version),
  },
  // esbuild 0.28 (pinned, see pnpm-workspace.yaml) cannot down-level to Vite 6's default dev target
  esbuild: { target: 'es2022' },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  server: {
    // WSL2: listen on all interfaces so the Windows browser can reach the dev server
    host: true,
    open: process.env.CI ? false : '/dev/index.html',
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    lib: {
      entry: 'src/chrono-heatmap-card.ts',
      formats: ['es'],
      fileName: () => 'chrono-heatmap-card.js',
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
