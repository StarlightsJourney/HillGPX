import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Set to '/<repo-name>/' if deploying to GitHub Pages under a project path.
  base: process.env.VITE_BASE ?? '/',
  // Not Vite's default 5173 — that collides with other local servers and you end
  // up staring at a different project wondering why nothing works. `strictPort`
  // makes a collision fail loudly instead of silently sliding to another port.
  server: { port: 5180, strictPort: true, host: true, open: true },
  optimizeDeps: { exclude: ['maplibre-gl'] },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // maplibre-gl is larger than 500 kB minified; raising the warning keeps the
    // build output clean while we still report genuinely oversized app chunks.
    chunkSizeWarningLimit: 1500,
  },
});
