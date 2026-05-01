import { describe, it, expect } from 'vitest';
import { inspectEnv } from './env';

const VALID_SECRET = 'a'.repeat(40);

const baseEnv = (): NodeJS.ProcessEnv => ({
    DATABASE_URL: 'postgres://x',
    JWT_SECRET: VALID_SECRET,
    GOOGLE_API_KEY: 'gkey',
    FRONTEND_URL: 'http://localhost:5173',
    NODE_ENV: 'development',
});

describe('inspectEnv', () => {
    it('passes a fully valid dev env without errors or warnings', () => {
        const result = inspectEnv(baseEnv());
        expect(result.errors).toEqual([]);
        expect(result.warnings).toEqual([]);
    });

    it('flags missing DATABASE_URL', () => {
        const env = baseEnv();
        delete env.DATABASE_URL;
        expect(inspectEnv(env).errors).toContain('DATABASE_URL is required');
    });

    it('flags missing JWT_SECRET', () => {
        const env = baseEnv();
        delete env.JWT_SECRET;
        expect(inspectEnv(env).errors).toContain('JWT_SECRET is required');
    });

    it('flags too-short JWT_SECRET', () => {
        const env = { ...baseEnv(), JWT_SECRET: 'short' };
        expect(inspectEnv(env).errors).toContain('JWT_SECRET must be at least 32 characters');
    });

    it.each([
        'your_random_secret_here_min_32_chars',
        'change_me_now_please_xxxxxxxxxxxxxxx',
        'default-secret-value-xxxxxxxxxxxxxxx',
    ])(
        'flags placeholder-looking JWT_SECRET %s',
        (secret) => {
            const env = { ...baseEnv(), JWT_SECRET: secret };
            const errs = inspectEnv(env).errors;
            expect(errs.some((e) => e.includes('placeholder'))).toBe(true);
        },
    );

    it('requires at least one LLM provider', () => {
        const env = baseEnv();
        delete env.GOOGLE_API_KEY;
        const errs = inspectEnv(env).errors;
        expect(errs.some((e) => e.includes('LLM provider'))).toBe(true);
    });

    it('accepts deepseek as the sole provider', () => {
        const env = baseEnv();
        delete env.GOOGLE_API_KEY;
        env.DEEPSEEK_API_KEY = 'dkey';
        expect(inspectEnv(env).errors).toEqual([]);
    });

    it('requires both DOUBAO_API_KEY and DOUBAO_ENDPOINT_ID for doubao to count', () => {
        const env = baseEnv();
        delete env.GOOGLE_API_KEY;
        env.DOUBAO_API_KEY = 'k';
        // missing endpoint id -> still no provider
        expect(inspectEnv(env).errors.some((e) => e.includes('LLM provider'))).toBe(true);

        env.DOUBAO_ENDPOINT_ID = 'ep';
        expect(inspectEnv(env).errors).toEqual([]);
    });

    it('requires CORS config in production', () => {
        const env = baseEnv();
        env.NODE_ENV = 'production';
        delete env.FRONTEND_URL;
        expect(inspectEnv(env).errors).toContain(
            'CORS_ORIGINS or FRONTEND_URL is required in production',
        );
    });

    it('accepts CORS_ORIGINS in place of FRONTEND_URL', () => {
        const env = baseEnv();
        env.NODE_ENV = 'production';
        delete env.FRONTEND_URL;
        env.CORS_ORIGINS = 'https://app.example.com';
        expect(inspectEnv(env).errors).toEqual([]);
    });

    it('warns (does not error) when CORS missing in dev', () => {
        const env = baseEnv();
        delete env.FRONTEND_URL;
        const result = inspectEnv(env);
        expect(result.errors).toEqual([]);
        expect(result.warnings.length).toBe(1);
    });
});
