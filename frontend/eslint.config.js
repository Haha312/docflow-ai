import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
    {
        ignores: [
            'node_modules/**',
            'dist/**',
            'coverage/**',
            'src/**', // Boilerplate stubs only — actual code lives in repo root
            'analyze_*.cjs', // Ad-hoc local analysis scripts, not part of the app
            '*.config.{js,ts}', // Vite/Vitest configs, kept simple
            'scripts/**', // Node-side dev/e2e helper scripts (different globals)
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.{ts,tsx,js,jsx}'],
        plugins: {
            react,
            'react-hooks': reactHooks,
            'react-refresh': reactRefresh,
        },
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            parserOptions: {
                ecmaFeatures: { jsx: true },
            },
            globals: {
                window: 'readonly',
                document: 'readonly',
                console: 'readonly',
                fetch: 'readonly',
                localStorage: 'readonly',
                sessionStorage: 'readonly',
                navigator: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                URL: 'readonly',
                URLSearchParams: 'readonly',
                FormData: 'readonly',
                File: 'readonly',
                FileReader: 'readonly',
                Blob: 'readonly',
                HTMLElement: 'readonly',
                HTMLInputElement: 'readonly',
                HTMLTextAreaElement: 'readonly',
                HTMLDivElement: 'readonly',
                Event: 'readonly',
                MouseEvent: 'readonly',
                KeyboardEvent: 'readonly',
                process: 'readonly',
            },
        },
        settings: {
            // Pin version explicitly — `detect` triggers a contextOrFilename incompatibility
            // between eslint-plugin-react and ESLint 10 flat config.
            react: { version: '19.2' },
        },
        rules: {
            ...react.configs.recommended.rules,
            // Don't spread reactHooks.configs.recommended.rules — v7 added many new rules that
            // require deep refactors of existing code. Enable only the foundational rules at warn.
            'react/react-in-jsx-scope': 'off', // Not needed in React 17+
            'react/prop-types': 'off', // Using TypeScript instead
            'react/display-name': 'off', // Anonymous arrow components are fine
            'react/no-unescaped-entities': 'warn',
            'react-hooks/rules-of-hooks': 'warn',

            // TS already does undefined-identifier checking via tsc; ESLint's no-undef is redundant
            // and produces false positives for browser globals (TextEncoder, crypto, etc.)
            'no-undef': 'off',

            '@typescript-eslint/no-unused-vars': [
                'warn',
                { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
            ],
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/no-require-imports': 'off',
            '@typescript-eslint/ban-ts-comment': 'warn',
            '@typescript-eslint/no-unused-expressions': 'warn',
            'react-refresh/only-export-components': 'warn',

            // Legacy carve-outs (warn for incremental cleanup)
            'no-useless-escape': 'warn',
            'no-useless-assignment': 'warn',
            'prefer-const': 'warn',
            'preserve-caught-error': 'warn',
            '@typescript-eslint/no-use-before-define': 'warn',
        },
    },
    prettier
);
