import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri: сборка фронтенда в ui/dist, пути относительные (file://-протокол)
export default defineConfig({
  root: 'ui',
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
