import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Renderer build config. In dev, Vite serves with HMR; in prod, bundles to
// renderer/dist which Electron loads via file://. `base: './'` keeps asset
// paths relative so the built index.html works under the file protocol.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  root: __dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'esnext',
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
