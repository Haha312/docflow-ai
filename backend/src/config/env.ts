/**
 * Validate required environment variables at startup.
 * Fail-fast if anything critical is missing or insecure, so misconfiguration
 * surfaces during boot instead of mid-request.
 */

export interface EnvValidationResult {
    errors: string[];
    warnings: string[];
}

/**
 * Pure validator: inspects an env-like object and returns errors/warnings.
 * Exposed separately from `validateEnv` so it can be unit-tested without
 * touching real `process.env` or `process.exit`.
 */
export const inspectEnv = (env: NodeJS.ProcessEnv): EnvValidationResult => {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!env.DATABASE_URL) {
        errors.push('DATABASE_URL is required');
    }

    const jwtSecret = env.JWT_SECRET;
    if (!jwtSecret) {
        errors.push('JWT_SECRET is required');
    } else if (jwtSecret.length < 32) {
        errors.push('JWT_SECRET must be at least 32 characters');
    } else if (/^(your_|change_me|default|secret|test)/i.test(jwtSecret)) {
        errors.push('JWT_SECRET looks like a placeholder, please use a strong random value');
    }

    const hasGemini = !!env.GOOGLE_API_KEY;
    const hasDeepseek = !!env.DEEPSEEK_API_KEY;
    const hasDoubao = !!(env.DOUBAO_API_KEY && env.DOUBAO_ENDPOINT_ID);
    const hasQwen = !!env.DASHSCOPE_API_KEY;
    if (!hasGemini && !hasDeepseek && !hasDoubao && !hasQwen) {
        errors.push('At least one LLM provider must be configured (GOOGLE_API_KEY / DEEPSEEK_API_KEY / DOUBAO_API_KEY+DOUBAO_ENDPOINT_ID / DASHSCOPE_API_KEY)');
    }

    if (env.NODE_ENV === 'production') {
        if (!env.CORS_ORIGINS && !env.FRONTEND_URL) {
            errors.push('CORS_ORIGINS or FRONTEND_URL is required in production');
        }
    } else if (!env.CORS_ORIGINS && !env.FRONTEND_URL) {
        warnings.push('No CORS_ORIGINS / FRONTEND_URL set; CORS will reject all browser origins. Set FRONTEND_URL=http://localhost:5173 to allow local dev.');
    }

    return { errors, warnings };
};

export const validateEnv = (): void => {
    const { errors, warnings } = inspectEnv(process.env);

    if (errors.length > 0) {
        console.error('\n[env] FATAL: invalid configuration:');
        errors.forEach((e) => console.error('  - ' + e));
        console.error('\nAborting startup.\n');
        process.exit(1);
    }

    if (warnings.length > 0) {
        warnings.forEach((w) => console.warn('[env] WARN: ' + w));
    }
};
