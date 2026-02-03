import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    target: process.env.TAURI_PLATFORM == null && mode === 'development' ? 'esnext' : ['es2021', 'chrome100', 'safari13'],
    minify: mode === 'development' ? false : 'esbuild',
    sourcemap: true
  }
}));
