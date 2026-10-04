import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['src/test/canvas-stub.ts'],
    reporters: process.env.CI ? ['default', 'junit'] : ['default'],
    outputFile: { junit: 'reports/junit.xml' },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // UI components are covered by E2E tests (planned); unit coverage targets logic modules.
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/components/**',
        'src/App.tsx',
        'src/types/**',
      ],
      reporter: ['text', 'json-summary', 'cobertura'],
      reportsDirectory: 'coverage',
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
});
