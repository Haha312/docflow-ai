/**
 * Single source of truth for LLM model registry.
 *
 * Adding/removing a model only needs to happen here; both the request
 * validator and the per-call config resolver read from this file.
 */
import type { TIER_LIMITS } from './tierConfig';

export interface ModelConfig {
    apiKey: string;
    baseUrl: string;
    modelId: string;
    needsProxy?: boolean;
    maxOutputTokens?: number;
}

export type SupportedModelKey =
    | 'gemini-flash'
    | 'gemini-pro'
    | 'doubao'
    | 'deepseek'
    | 'qwen-max';

export const SUPPORTED_MODEL_KEYS: readonly SupportedModelKey[] = [
    'gemini-flash',
    'gemini-pro',
    'doubao',
    'deepseek',
    'qwen-max',
] as const;

export const isSupportedModelKey = (key: unknown): key is SupportedModelKey =>
    typeof key === 'string' && (SUPPORTED_MODEL_KEYS as readonly string[]).includes(key);

const SAFE_CHUNK_BASELINES: Record<SupportedModelKey, number> = {
    'gemini-flash': 12000,
    'gemini-pro': 16000,
    'doubao': 9000,
    'deepseek': 6000,
    'qwen-max': 6000,
};

export const estimateSafeChunkSize = (
    modelKey: string | undefined,
    userTier: keyof typeof TIER_LIMITS,
): number => {
    const base = (isSupportedModelKey(modelKey) ? SAFE_CHUNK_BASELINES[modelKey] : undefined) ?? 12000;
    const tierFactor = userTier === 'ULTRA' ? 1.35 : 1.0;
    return Math.max(4000, Math.floor(base * tierFactor));
};

export const getModelConfig = (
    modelKey: string,
    dbConfig: Record<string, string>,
): ModelConfig | null => {
    const geminiKey = dbConfig['GOOGLE_API_KEY'] || process.env.GOOGLE_API_KEY || '';
    const geminiBase = dbConfig['GEMINI_OPENAI_BASE_URL'] || process.env.GEMINI_OPENAI_BASE_URL || '';

    const registry: Record<SupportedModelKey, ModelConfig> = {
        'gemini-flash': {
            apiKey: geminiKey,
            baseUrl: geminiBase,
            modelId: 'gemini-2.0-flash',
            needsProxy: true,
            maxOutputTokens: 16000,
        },
        'gemini-pro': {
            apiKey: geminiKey,
            baseUrl: geminiBase,
            modelId: process.env.GEMINI_MODEL || 'gemini-3-pro-preview',
            needsProxy: true,
            maxOutputTokens: 32000,
        },
        'doubao': {
            apiKey: process.env.DOUBAO_API_KEY || '',
            baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
            modelId: process.env.DOUBAO_ENDPOINT_ID || '',
            needsProxy: false,
            maxOutputTokens: 8192,
        },
        'deepseek': {
            apiKey: process.env.DEEPSEEK_API_KEY || '',
            baseUrl: 'https://api.deepseek.com/v1',
            modelId: process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro',
            needsProxy: false,
            maxOutputTokens: 8192,
        },
        'qwen-max': {
            apiKey: process.env.DASHSCOPE_API_KEY || '',
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            modelId: 'qwen-max',
            needsProxy: false,
            maxOutputTokens: 8192,
        },
    };

    return isSupportedModelKey(modelKey) ? registry[modelKey] : null;
};
