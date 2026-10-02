import { defineConfig } from 'vitest/config';

// Unit tests for pure modules (*.test.ts next to the code). UI behaviour is covered by e2e/smoke.mts.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
