import { defineConfig } from 'vite';

// base './' deixa o mesmo build funcionar na web (GitHub Pages) e dentro do APK.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: true }
});
