import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Integration tests use test.runIf() to skip gracefully when move-analyzer unavailable
    // Allow unhandled rejections in tests that intentionally trigger timeouts with fake timers
    // These are expected behavior, not actual test failures
    dangerouslyIgnoreUnhandledErrors: true,
  },
  resolve: {
    alias: {
      // Handle .js imports pointing to .ts source files
    },
    extensions: ['.ts', '.js', '.mjs', '.mts'],
  },
});