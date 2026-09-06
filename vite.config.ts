import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Set to '/<repo-name>/' if deploying to GitHub Pages under a project path.
  base: process.env.VITE_BASE ?? '/',
  server: { port: 5173, open: true },
  build: { outDir: 'dist', sourcemap: true },
});
