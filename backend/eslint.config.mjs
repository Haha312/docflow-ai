import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
    {
        ignores: ['dist/**', 'node_modules/**', 'prisma/migrations/**', 'coverage/**'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            globals: {
                process: 'readonly',
                console: 'readonly',
                Buffer: 'readonly',
                __dirname: 'readonly',
                __filename: 'readonly',
                module: 'readonly',
                require: 'readonly',
                exports: 'readonly',
                setTimeout: 'readonly',
                setInterval: 'readonly',
                clearTimeout: 'readonly',
                clearInterval: 'readonly',
            },
        },
        rules: {
            // Allow unused args starting with _ (common pattern for express handlers)
            '@typescript-eslint/no-unused-vars': [
                'warn',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
            // Project uses console.log heavily today; downgrade to warn (will tighten as pino rollout completes)
            'no-console': 'off',
            // Allow `any` for now (legacy code); revisit incrementally
            '@typescript-eslint/no-explicit-any': 'warn',
            // require() is needed for some legacy CommonJS interop (svg-captcha, better-sqlite3)
            '@typescript-eslint/no-require-imports': 'off',

            // ── Legacy code carve-outs (downgrade from error → warn for incremental cleanup) ──
            // Empty catch blocks are intentional in some places (best-effort cleanup)
            'no-empty': ['warn', { allowEmptyCatch: true }],
            // Existing regex escapes will be fixed incrementally
            'no-useless-escape': 'warn',
            // Will adopt error chaining as we touch each error site
            'preserve-caught-error': 'warn',
            // let-vs-const cleanups are mechanical, do them as files are touched
            'prefer-const': 'warn',
            'no-useless-assignment': 'warn',
        },
    },
    {
        // Scripts may use console.* freely and may not be strictly typed
        files: ['scripts/**/*.{js,ts}'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },
    prettier
);
