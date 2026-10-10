import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['src/test/canvas-stub.ts', 'src/test/setup-dom.ts'],
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'reports/junit.xml' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // Components count too: they have component tests (Testing Library).
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/test/**',
        'src/types/**',
      ],
      reporter: ['text', 'json-summary', 'cobertura'],
      reportsDirectory: 'coverage',
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
  },
});
