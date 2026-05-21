import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        globals: false,
        include: ['src/**/*.test.ts', 'src/**/__tests__/**/*.ts'],
        exclude: ['node_modules', 'dist', 'prisma/migrations'],
        coverage: {
            reporter: ['text', 'html'],
            include: ['src/**/*.ts'],
            exclude: ['src/**/*.test.ts', 'src/**/__tests__/**', 'src/types/**'],
        },
    },
});
