import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  plugins: [react()],
  clearScreen: false,
  server: { host: '127.0.0.1', strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
  test: { environment: 'node', include: ['tests/**/*.test.{ts,tsx}'] },
});
