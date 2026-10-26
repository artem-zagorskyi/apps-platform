import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // Runs once before all tests: creates the test database, applies migrations
    globalSetup: ['./test/global-setup.ts'],
    // Runs in every test worker before test files are loaded
    setupFiles: ['./test/setup.ts'],
    // All test files share one database, so they run one after another
    fileParallelism: false,
  },
});