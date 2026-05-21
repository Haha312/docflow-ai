import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.{test,spec}.{ts,tsx}'],
    exclude: ['node_modules', 'dist', 'src'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['**/*.{ts,tsx}'],
      exclude: ['**/*.{test,spec}.{ts,tsx}', 'node_modules', 'dist', 'vite.config.ts', 'vitest.config.ts'],
    },
  },
});
