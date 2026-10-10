import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // Playwright spawns browsers as child processes and resolves its driver
      // at runtime — it must stay a real node_modules require, not bundled.
      external: ['playwright', 'playwright-core'],
    },
  },
});
