import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        include: ['src/tests/integration/**/*.test.ts'],
        exclude: ['**/node_modules/**', '**/dist/**'],
        testTimeout: 30000,
        hookTimeout: 30000,
        globals: true,
        environment: 'node',
        env: {
            NODE_ENV: 'test',
        },
        pool: 'forks',
        poolOptions: {
            forks: {
                singleFork: true,
            },
        },
        globalSetup: './src/tests/integration/global-setup.ts',
    },
    globalTeardown: './src/tests/integration/global-teardown.ts',
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
