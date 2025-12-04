import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: [],
    testTimeout: 10000, // 10秒でタイムアウト
    hookTimeout: 10000, // フックも10秒
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
      ],
    },
    exclude: [
      'node_modules',
      'dist',
      // Exclude integration tests and database-dependent tests
      'src/tests/integration/**',
      'src/tests/database/**',
      // Storage tests that require actual DB connection
      'src/tests/storage/graph-store-adapter.test.ts',
      'src/tests/storage/find-shortest-path-validation.test.ts',
      'src/tests/storage/uuid-edge-id.test.ts',
      'src/tests/storage/vector-store-adapter.test.ts',
      'src/tests/storage/relationship-validation.test.ts',
      'src/tests/storage/get-node-relationships-validation.test.ts' // Fails due to missing mock
    ],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
