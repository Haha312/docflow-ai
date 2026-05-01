import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    SUPPORTED_MODEL_KEYS,
    isSupportedModelKey,
    estimateSafeChunkSize,
    getModelConfig,
} from './models';

describe('SUPPORTED_MODEL_KEYS', () => {
    it('contains the five known providers', () => {
        expect(SUPPORTED_MODEL_KEYS).toEqual([
            'gemini-flash',
            'gemini-pro',
            'doubao',
            'deepseek',
            'qwen-max',
        ]);
    });
});

describe('isSupportedModelKey', () => {
    it.each(SUPPORTED_MODEL_KEYS)('accepts %s', (k) => {
        expect(isSupportedModelKey(k)).toBe(true);
    });

    it.each(['', 'unknown', 'gpt-4', null, undefined, 42, {}])(
        'rejects %s',
        (val) => {
            expect(isSupportedModelKey(val as unknown)).toBe(false);
        },
    );
});

describe('estimateSafeChunkSize', () => {
    it('uses model-specific baseline for FREE tier', () => {
        expect(estimateSafeChunkSize('gemini-pro', 'FREE')).toBe(16000);
        expect(estimateSafeChunkSize('deepseek', 'FREE')).toBe(6000);
    });

    it('applies 1.35x bonus for ULTRA tier', () => {
        expect(estimateSafeChunkSize('gemini-pro', 'ULTRA')).toBe(Math.floor(16000 * 1.35));
        expect(estimateSafeChunkSize('deepseek', 'ULTRA')).toBe(Math.floor(6000 * 1.35));
    });

    it('falls back to 12000 baseline for unknown / undefined modelKey', () => {
        expect(estimateSafeChunkSize(undefined, 'FREE')).toBe(12000);
        expect(estimateSafeChunkSize('made-up', 'FREE')).toBe(12000);
    });

    it('never returns less than the 4000 floor', () => {
        expect(estimateSafeChunkSize('deepseek', 'FREE')).toBeGreaterThanOrEqual(4000);
    });
});

describe('getModelConfig', () => {
    const envBackup: Record<string, string | undefined> = {};
    const ENV_KEYS = [
        'GOOGLE_API_KEY',
        'GEMINI_OPENAI_BASE_URL',
        'GEMINI_MODEL',
        'DEEPSEEK_API_KEY',
        'DEEPSEEK_MODEL',
        'DOUBAO_API_KEY',
        'DOUBAO_ENDPOINT_ID',
        'DASHSCOPE_API_KEY',
    ];

    beforeEach(() => {
        for (const k of ENV_KEYS) {
            envBackup[k] = process.env[k];
            delete process.env[k];
        }
    });

    afterEach(() => {
        for (const k of ENV_KEYS) {
            if (envBackup[k] === undefined) delete process.env[k];
            else process.env[k] = envBackup[k];
        }
    });

    it('returns null for unsupported key', () => {
        expect(getModelConfig('not-a-model', {})).toBeNull();
    });

    it('reads gemini key from dbConfig over env', () => {
        process.env.GOOGLE_API_KEY = 'env-key';
        const cfg = getModelConfig('gemini-pro', { GOOGLE_API_KEY: 'db-key' });
        expect(cfg?.apiKey).toBe('db-key');
    });

    it('falls back to env when dbConfig missing', () => {
        process.env.GOOGLE_API_KEY = 'env-key';
        const cfg = getModelConfig('gemini-flash', {});
        expect(cfg?.apiKey).toBe('env-key');
    });

    it('uses DEEPSEEK_MODEL override when set, otherwise deepseek-v4-pro', () => {
        const def = getModelConfig('deepseek', {});
        expect(def?.modelId).toBe('deepseek-v4-pro');

        process.env.DEEPSEEK_MODEL = 'deepseek-v4-flash';
        const overridden = getModelConfig('deepseek', {});
        expect(overridden?.modelId).toBe('deepseek-v4-flash');
    });

    it('uses GEMINI_MODEL env for gemini-pro modelId', () => {
        process.env.GEMINI_MODEL = 'gemini-3.5-pro';
        const cfg = getModelConfig('gemini-pro', {});
        expect(cfg?.modelId).toBe('gemini-3.5-pro');
    });

    it('marks gemini variants as needing proxy and others not', () => {
        expect(getModelConfig('gemini-flash', {})?.needsProxy).toBe(true);
        expect(getModelConfig('gemini-pro', {})?.needsProxy).toBe(true);
        expect(getModelConfig('deepseek', {})?.needsProxy).toBe(false);
        expect(getModelConfig('doubao', {})?.needsProxy).toBe(false);
        expect(getModelConfig('qwen-max', {})?.needsProxy).toBe(false);
    });
});
