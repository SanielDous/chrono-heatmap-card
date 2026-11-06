import { defineConfig } from 'vite';

// Static build of the dev/mock page for GitHub Pages (`pnpm build:demo` → dist-demo/).
export default defineConfig({
  root: 'dev',
  base: './',
  define: {
    __CARD_VERSION__: JSON.stringify(process.env.RELEASE_VERSION ?? 'demo'),
  },
  esbuild: { target: 'es2022' },
  build: {
    target: 'es2022',
    outDir: '../dist-demo',
    emptyOutDir: true,
  },
});
