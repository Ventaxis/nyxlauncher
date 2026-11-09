import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// Tauri: сборка фронтенда в ui/dist, пути относительные (file://-протокол)
export default defineConfig({
  root: 'ui',
  base: './',
  plugins: [react()],
  // Версия в футере всегда совпадает с package.json.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
