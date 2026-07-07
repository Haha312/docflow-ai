
import { Router, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { AuthRequest, GenerateRequest } from '../types';
import { errorResponse } from '../utils/response';
import { authenticate } from '../middleware/auth';
import { checkRateLimit } from '../middleware/rateLimit';
import prisma from '../config/database';
import { recognizeImagesForLayout } from '../services/visionService';

const router = Router();

import OpenAI from 'openai';
import { extractImagesAsPlaceholders, restoreImages, convertVectorImagesToPng } from '../utils/imageUtils';
import { BASE_SYSTEM_PROMPTS, SYSTEM_PROMPT_SUFFIX, getNumberingInstruction } from '../config/prompts';
import { IntegrityIssue, countStructure, buildIntegrityReport, detectStructuralAnomalies, reconcileMissingTables, validateFinalIntegrity } from '../utils/integrity';
import { extractSourceCaptions, postProcess } from '../utils/postProcess';
import { buildSkeleton, expectedChapterCount, type SkeletonNode } from '../utils/skeleton';
import { normalizeHeadingText } from '../utils/headingText';
import {
    calcTailHeadOverlap,
    cleanOutput,
    countNumberedItems,
    detectCorporateElementClasses,
    ensureFigureCaptions,
    extractDocumentHeadingMap,
    extractHeadingFingerprints,
    extractLastHeadings,
    hasSameBodyHallucination,
    normalizeText,
    reorderCorporateDocument,
    reinjectMissingPlaceholders,
} from '../utils/generationHtml';

type PreComputedHeading = { level: number; text: string; number: string };

/**
 * Comprehensive hallucination loop detector.
 * Checks 6 distinct repetition patterns and truncates just before the loop starts.
 * Returns the original string if no loop is found.
 *
 * Patterns detected:
 *  1. Exact segment repetition       ??same N-char block repeating ????
 *  2a. Prefix-mutation list          ??(N)Cwakeee ??(N+1)Cwakeeee ??...
 *  2b. Same-body numbered list       ??(31)X (32)X (33)X ... all identical body
 *  3. Non-numbered sentence loop     ??same complete sentence appearing ????
 *  4. Alternating pair loop          ??A B A B A B A B (?? cycles)
 *  5. Character / short-phrase spam  ??"?闂傚倷鑳剁划顖炪€冮幇顔筋潟闁哄洨鍠愬▍鐘绘煕椤愶絾绀冮柛?" / "xxxxxxxxxxx"
 *  6. Empty block spam               ??many consecutive blank <p>/<div> tags
 */
const truncateAtRepetitionLoop = (html: string): string => {
    const plain = normalizeText(html);
    if (plain.length < 200) return html;

    const tailLen = Math.min(plain.length, 5000);
    const tail = plain.slice(-tailLen);

    const blockTags = ['</h1>', '</h2>', '</h3>', '</h4>', '</h5>', '</h6>', '</p>', '</li>', '</div>'];

    /** Find the best HTML cut point just before loopStartInPlain, return truncated string or null. */
    const cutAt = (loopStartInPlain: number, extraSlack: number, reason: string): string | null => {
        const ratio = loopStartInPlain / plain.length;
        const searchUpTo = Math.min(html.length, Math.floor(html.length * ratio) + extraSlack);
        const htmlBefore = html.slice(0, searchUpTo);
        let bestCut = -1;
        for (const tag of blockTags) {
            const idx = htmlBefore.lastIndexOf(tag);
            if (idx > bestCut) bestCut = idx + tag.length;
        }
        if (bestCut > html.length * 0.05) {
            console.log(`[LOOP_TRUNCATED] ${reason}, cutting at ${bestCut}/${html.length}`);
            return html.slice(0, bestCut);
        }
        return null;
    };

    // ???? 1. Exact segment repetition ??????????????????????????????????????????????????????????????????????????????????
    // Catches any block of 35??50 chars that repeats ?? times consecutively.
    for (let segLen = 35; segLen <= 450; segLen += 15) {
        const candidate = tail.slice(-segLen).trim();
        if (candidate.length < 20) continue;
        let pos = tail.length - segLen;
        let repeats = 1;
        while (pos >= segLen) {
            if (tail.slice(pos - segLen, pos).trim() === candidate) { repeats++; pos -= segLen; }
            else break;
        }
        if (repeats >= 3) {
            const result = cutAt(plain.length - tailLen + pos, segLen * 3, `${repeats}x exact repeat segLen=${segLen}`);
            if (result) return result;
        }
    }

    // ???? 2. Numbered-list patterns ????????????????????????????????????????????????????????????????????????????????????????
    const numberedRe = /[\uFF08(]\s*\d+\s*[\uFF09)]\s*[^\n\uFF08(]{5,120}/g;
    const items = [...tail.matchAll(numberedRe)];
    if (items.length >= 5) {
        const lastItems = items.slice(-8);
        const stripped = lastItems.map(m => m[0].replace(/^[\uFF08(]\s*\d+\s*[\uFF09)]\s*/, '').trim());

        // 2a. Prefix-mutation: Cwakeee ??Cwakeeee ??Cwakeeeee
        let mutatingCount = 0;
        for (let i = 1; i < stripped.length; i++) {
            const a = stripped[i - 1], b = stripped[i];
            if (a && b && (b.startsWith(a) || a.startsWith(b))) mutatingCount++;
        }
        if (mutatingCount >= stripped.length - 2) {
            const result = cutAt(
                plain.length - tailLen + (lastItems[0].index ?? 0), 200,
                `prefix-mutation list (${mutatingCount}/${stripped.length - 1})`
            );
            if (result) return result;
        }

        // 2b. Same-body: (31)X (32)X (33)X ??body is identical, only number differs
        // Require body ??8 chars to avoid false positives on short cross-references like "?????闂佽崵鍠愮划搴㈡櫠濡も偓铻?
        const refBody = stripped[stripped.length - 1];
        if (refBody.length >= 8) {
            const sameCount = stripped.filter(b => b === refBody).length;
            if (sameCount >= 5) {
                const firstRepeatIdx = stripped.findIndex(b => b === refBody);
                const result = cutAt(
                    plain.length - tailLen + (lastItems[firstRepeatIdx].index ?? 0), 100,
                    `same-body numbered list (${sameCount}x "${refBody.slice(0, 30)}")`
                );
                if (result) return result;
            }
        }
    }

    // ???? 3. Non-numbered sentence repetition ??????????????????????????????????????????????????????????????????
    // e.g. "?闂?????X???闂?????X???闂?????X???闂?????X???闂?????X??
    // Threshold kept at 5?? (matching hasStreamSentenceRepetition) to avoid false positives
    // on technical documents that legitimately repeat common transitional phrases.
    const sentenceRe = /[^\u3002\uFF01\uFF1F!?\n]{20,150}[\u3002\uFF01\uFF1F!?]/g;
    const sentences = [...tail.matchAll(sentenceRe)];
    if (sentences.length >= 8) {
        const last10 = sentences.slice(-10);
        const sentTexts = last10.map(m => m[0].trim());
        const sentCounts = new Map<string, number>();
        for (const s of sentTexts) sentCounts.set(s, (sentCounts.get(s) ?? 0) + 1);
        for (const [s, cnt] of sentCounts) {
            if (cnt >= 5) {
                const firstIdx = last10.findIndex(m => m[0].trim() === s);
                const result = cutAt(
                    plain.length - tailLen + (last10[firstIdx].index ?? 0), 300,
                    `sentence x${cnt}: "${s.slice(0, 30)}"`
                );
                if (result) return result;
            }
        }
    }

    // ???? 4. Alternating pair loop ??????????????????????????????????????????????????????????????????????????????????????????
    // e.g. A B A B A B A B (same two distinct paragraphs cycling ?? times)
    // Require ??0 chars and mostly CJK/alpha content to avoid false positives on
    // formula lines, short labels, or structured table rows.
    const lineRe = /[^\n]{30,300}/g;
    const lines = [...tail.matchAll(lineRe)]
        .map(m => m[0].trim())
        .filter(l => l.length >= 30 && /[\u4e00-\u9fa5a-zA-Z]{10,}/.test(l)); // must have real text
    if (lines.length >= 8) {
        const last8 = lines.slice(-8);
        const evens = last8.filter((_, i) => i % 2 === 0);
        const odds  = last8.filter((_, i) => i % 2 === 1);
        const uniqueEvens = new Set(evens);
        const uniqueOdds  = new Set(odds);
        if (uniqueEvens.size === 1 && uniqueOdds.size === 1 && evens[0] !== odds[0]) {
            const result = cutAt(plain.length - tailLen + Math.max(0, tail.length - 800), 300,
                `alternating pair: "${evens[0].slice(0, 20)}" / "${odds[0].slice(0, 20)}"`);
            if (result) return result;
        }
    }

    // ???? 5. Character / short-phrase spam ????????????????????????????????????????????????????????????????????????
    // e.g. "?闂傚倷鑳剁划顖炪€冮幇顔筋潟闁哄洨鍠愬▍鐘绘煕椤愶絾绀冮柛瀣儔閺屻劌鈽夊Ο渚患闂佸啿鍢茬粔褰掑蓟??? or "????闂??????闂??????闂??"
    const charTail = tail.slice(-300);
    const spamMatch = charTail.match(/(.{1,6})\1{12,}/);
    if (spamMatch) {
        const result = cutAt(plain.length - tailLen + tail.length - 300, 100,
            `char spam: "${spamMatch[1].slice(0, 20)}" x${Math.floor(spamMatch[0].length / spamMatch[1].length)}`);
        if (result) return result;
    }

    // ???? 6. Empty block spam ????????????????????????????????????????????????????????????????????????????????????????????????????
    // e.g. 15+ consecutive <p></p> or <p> </p>
    const emptyBlockSpam = (html.match(/<p>(\s|&nbsp;)*<\/p>/gi) ?? []).length;
    if (emptyBlockSpam >= 15) {
        // Find where the spam starts in HTML
        const spamStartRe = /(?:<p>(?:\s|&nbsp;)*<\/p>\s*){10}/i;
        const spamMatch2 = html.match(spamStartRe);
        if (spamMatch2?.index !== undefined) {
            const result = cutAt(Math.floor(spamMatch2.index / html.length * plain.length), 50,
                `empty block spam (${emptyBlockSpam} empty <p>)`);
            if (result) return result;
        }
    }

    return html;
};

/**
 * Stream-time sentence repetition detector.
 * Returns true if the EXACT same sentence (??0 chars) appears 5+ times in the last 2500 chars.
 * Threshold is intentionally conservative (5??, ??0 chars) to avoid false positives on
 * common Chinese transitional phrases like "??闂傚倷鐒﹂幃鍫曞磿閹惰棄绀???? / "????????????".
 */
const hasStreamSentenceRepetition = (text: string): boolean => {
    const plain = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(-2500);
    // Require ??0 chars to avoid catching short transitional phrases
    const sentences = [...plain.matchAll(/[^\u3002\uFF01\uFF1F!?\n]{20,150}[\u3002\uFF01\uFF1F!?]/g)].map(m => m[0].trim());
    if (sentences.length < 8) return false;
    const counts = new Map<string, number>();
    for (const s of sentences.slice(-10)) {
        const n = (counts.get(s) ?? 0) + 1;
        counts.set(s, n);
        if (n >= 5) return true;  // raised from 4 to 5 to reduce false positives
    }
    return false;
};

/**
 * Stream-time character spam detector.
 * Returns true if a short phrase repeats 15+ times consecutively.
 */
const hasCharSpam = (text: string): boolean => {
    const tail = text.replace(/<[^>]+>/g, '').slice(-600);
    return /(.{1,6})\1{14,}/.test(tail);
};

/**
 * Close any structurally-significant HTML tags left open after truncation.
 * Runs as a safety net after truncateAtRepetitionLoop() to avoid broken markup
 * propagating into subsequent chunks or the final document.
 */
const repairUnclosedTags = (html: string): string => {
    const trackTags = ['ul', 'ol', 'li', 'table', 'tbody', 'thead', 'tr', 'td', 'th'];
    const stack: string[] = [];
    const tagRe = /<(\/?)([a-z][a-z0-9]*)\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = tagRe.exec(html)) !== null) {
        const isClose = m[1] === '/';
        const tag = m[2].toLowerCase();
        if (!trackTags.includes(tag)) continue;
        if (isClose) {
            const idx = stack.lastIndexOf(tag);
            if (idx !== -1) stack.splice(idx, 1);
        } else {
            if (!m[0].endsWith('/>')) stack.push(tag);
        }
    }
    if (stack.length === 0) return html;
    const closingTags = stack.reverse().map(t => `</${t}>`).join('');
    console.log(`[REPAIR_TAGS] closing unclosed: ${closingTags}`);
    return html + closingTags;
};

const stripHtmlToCompactText = (html: string): string =>
    html.replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim();

const normalizeChunkHeading = (text: string): string =>
    normalizeHeadingText(stripHtmlToCompactText(text)).toLowerCase();

const validateChunkOutput = (
    chunkInput: string,
    chunkOutput: string,
    chunkMeta: StructuredContentChunk,
): string[] => {
    const issues: string[] = [];
    const inputPlainLen = stripHtmlToCompactText(chunkInput).length;
    const outputPlain = stripHtmlToCompactText(chunkOutput);
    const outputPlainLen = outputPlain.length;

    if (inputPlainLen > 500 && outputPlainLen < Math.floor(inputPlainLen * 0.45)) {
        issues.push(`output too short (${outputPlainLen}/${inputPlainLen} chars)`);
    }
    if (inputPlainLen > 500 && outputPlainLen > inputPlainLen * 3.8) {
        issues.push(`output too long (${outputPlainLen}/${inputPlainLen} chars)`);
    }

    const outputHeadingNorms = [...chunkOutput.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)]
        .map((m) => normalizeChunkHeading(m[1]))
        .filter(Boolean);
    const missingHeadings = chunkMeta.headings
        .map((h) => h.text)
        .filter((text) => {
            const norm = normalizeChunkHeading(text);
            if (!norm || norm.length < 3) return false;
            return !outputHeadingNorms.some((out) => out.includes(norm) || norm.includes(out));
        });
    if (missingHeadings.length > 0) {
        issues.push(`missing heading(s): ${missingHeadings.slice(0, 5).join(' | ')}`);
    }

    const inputPlaceholders = [...chunkInput.matchAll(/__IMG_\d+__/g)].map(m => m[0]);
    if (inputPlaceholders.length > 0) {
        const outputSet = new Set([...chunkOutput.matchAll(/__IMG_\d+__/g)].map(m => m[0]));
        const missingImages = inputPlaceholders.filter(p => !outputSet.has(p));
        if (missingImages.length > 0) issues.push(`missing image placeholder(s): ${missingImages.join(', ')}`);
    }

    const inputTables = (chunkInput.match(/<table\b/gi) ?? []).length;
    const outputTables = (chunkOutput.match(/<table\b/gi) ?? []).length;
    if (inputTables > 0 && outputTables < inputTables) {
        issues.push(`missing table(s): ${outputTables}/${inputTables}`);
    }

    const inputListItems = Math.max((chunkInput.match(/<li\b/gi) ?? []).length, (chunkInput.match(/[（(]\s*\d+\s*[）)]/g) ?? []).length);
    const outputListItems = Math.max((chunkOutput.match(/<li\b/gi) ?? []).length, (chunkOutput.match(/[（(]\s*\d+\s*[）)]/g) ?? []).length);
    if (inputListItems >= 5 && outputListItems < Math.floor(inputListItems * 0.6)) {
        issues.push(`too few list items: ${outputListItems}/${inputListItems}`);
    }

    if (hasSameBodyHallucination(chunkOutput) || hasStreamSentenceRepetition(chunkOutput) || hasCharSpam(chunkOutput)) {
        issues.push('repetition detected');
    }

    return issues;
};

const estimateSafeChunkSize = (modelKey: string | undefined, userTier: keyof typeof TIER_LIMITS): number => {
    const baselineByModel: Record<string, number> = {
        'gemini-flash': 12000,
        'gemini-pro': 16000,
        'doubao': 9000,
        'deepseek': 6000
    };
    const base = baselineByModel[modelKey || ''] || 12000;
    const tierFactor = userTier === 'ULTRA' ? 1.35 : 1.0;
    return Math.max(4000, Math.floor(base * tierFactor));
};



import { TIER_LIMITS, getContentLimit } from '../config/tierConfig';
import { invalidateUsageCount } from '../utils/usageCount';
import { normalizePreset } from '../utils/preset';
import { splitContentBySemantics, splitContentIntoStructuredChunks, extractFirstHeading, compressChunksByCoverage, type StructuredContentChunk } from '../utils/chunking';
const env = (...names: string[]): string | undefined => names.map((name) => process.env[name]).find(Boolean);
const pickModelKey = (requested?: string): string => {
    const value = requested || env('AI_PROVIDER') || 'deepseek';
    return value === 'claude' ? 'deepseek' : value;
};
const envNumber = (fallback: number, ...names: string[]): number => {
    for (const name of names) {
        const value = process.env[name];
        if (value !== undefined && value !== '') {
            const parsed = Number(value);
            if (Number.isFinite(parsed) && parsed > 0) return parsed;
        }
    }
    return fallback;
};

const PRIMARY_MODEL = env('GEMINI_MODEL') || 'gemini-3-pro-preview';
const MAX_CONCURRENT_GENERATIONS = Math.max(1, Number(process.env.MAX_CONCURRENT_GENERATIONS || 50));
const AI_IDLE_TIMEOUT_MS = envNumber(60000, 'AI_TIMEOUT_MS', 'AI_IDLE_TIMEOUT_MS');
const AI_MAX_OUTPUT_TOKENS = envNumber(16384, 'AI_MAX_TOKENS', 'AI_MAX_OUTPUT_TOKENS');

interface ModelConfig { apiKey: string; baseUrl: string; modelId: string; needsProxy?: boolean; maxOutputTokens?: number; extraBody?: Record<string, unknown>; }

function getModelConfig(modelKey: string, dbConfig: Record<string, string>): ModelConfig | null {
    const geminiKey  = dbConfig['GOOGLE_API_KEY']        || process.env.GOOGLE_API_KEY        || '';
    const geminiBase = dbConfig['GEMINI_OPENAI_BASE_URL'] || process.env.GEMINI_OPENAI_BASE_URL || '';
    const registry: Record<string, ModelConfig> = {
        'gemini-flash': { apiKey: geminiKey,  baseUrl: geminiBase, modelId: 'gemini-2.5-flash',                                  needsProxy: true,  maxOutputTokens: 16000 },
        'gemini-pro':   { apiKey: geminiKey,  baseUrl: geminiBase, modelId: env('GEMINI_MODEL') || 'gemini-3-pro-preview', needsProxy: true,  maxOutputTokens: 32000 },
        'doubao':       { apiKey: env('DOUBAO_API_KEY', 'VISION_API_KEY') || '', baseUrl: env('DOUBAO_BASE_URL', 'VISION_BASE_URL') || 'https://ark.cn-beijing.volces.com/api/v3', modelId: env('DOUBAO_ENDPOINT_ID') || '', needsProxy: false, maxOutputTokens: AI_MAX_OUTPUT_TOKENS },
        // thinking 婵?闂傚倷鐒﹀鍧楀礈濞嗘垼濮抽柤娴嬫櫇娑?(???闂???闂傚倸鍊峰ù鍥晸閵夆晛纾块梺顒€绉甸崑????????濠???闂?????闂??婵犵數鍋為崹鍫曞蓟閵娿儍娲煛娴??? token 1514ms??99ms)??
        // ??闂????闂??DEEPSEEK_THINKING=enabled??
        'deepseek':     { apiKey: env('DEEPSEEK_API_KEY') || '', baseUrl: env('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com/v1', modelId: env('DEEPSEEK_MODEL') || 'deepseek-v4-flash', needsProxy: false, maxOutputTokens: AI_MAX_OUTPUT_TOKENS,
                          extraBody: process.env.DEEPSEEK_THINKING === 'enabled' ? undefined : { thinking: { type: 'disabled' } } },
    };
    return registry[modelKey] ?? null;
}
let activeGenerations = 0;

const tryAcquireGenerationSlot = (): boolean => {
    if (activeGenerations >= MAX_CONCURRENT_GENERATIONS) return false;
    activeGenerations += 1;
    return true;
};

// ?濠?????????:闂傚倷绀侀幉锟犳嚌閻愵剛闄勯柡鍐ㄥ€婚崡?濠?闂傚倷绀侀幉锟犳嚌妤ｅ啫瀚夋い鎺嗗亾妞ゎ亜鍟村畷鎺楁倷閼碱剛鍘????1 ????????????濠电姵顔栭崰妤冪紦閸ф鍨傜憸鐗堝笒閺????/ ????闂??濠??
// ?闂? Set(??闂?????? Redis ?闂?????濠????闂????????闂????Redis SETNX??
const activeUserGenerations = new Set<string>();

// OpenAI Compatible API Call (for Gemini via proxy)
async function* callOpenAICompatible(
    apiKey: string,
    baseUrl: string,
    systemPrompt: string,
    userContent: string,
    modelName: string,
    maxTokens?: number,
    useProxy?: boolean,
    includeUsage?: boolean,
    extraBody?: Record<string, unknown>
): AsyncGenerator<{ content: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; finishReason?: string | null }> {
    console.log('DEBUG: callOpenAICompatible start', { baseUrl, modelName, apiKeyLength: apiKey?.length, maxTokens, useProxy });

    const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey, baseURL: baseUrl };
    if (useProxy) {
        const proxyUrl = process.env.HTTPS_PROXY || 'http://127.0.0.1:10809';
        const dispatcher = new ProxyAgent(proxyUrl);
        clientOptions.fetch = ((url: any, init: any) => undiciFetch(url, { ...init, dispatcher })) as any;
    }
    const client = new OpenAI(clientOptions);

    // extraBody:濠?????闂???(??deepseek ??thinking ????,OpenAI SDK ???缂???闂????闂?????闂?
    const requestBody = {
        model: modelName,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent }
        ],
        stream: true,
        ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
        temperature: 0.1,
        max_tokens: maxTokens,
        ...(extraBody || {})
    } as Parameters<typeof client.chat.completions.create>[0] & { stream: true };

    // ???? ??闂?????"????(??????缂???????闂???)????
    // provider(??DeepSeek)???闂???????闂??闂?濠??token;SDK 婵?闂?闂傚倷绀侀幖顐﹀疮閸愭祴鏋栨繛鎴炲殠娴???????缂?,
    // ??????token ???????`for await` ?????闂???婵????SSE ???闂???(???濠?????闂傚倷绀侀幖顐﹀嫉椤掑嫬绀夐柟鐑樻⒒閸?闂?)??
    // ????:AbortController + ???闂?????濠?闂?婵犵數鍋為崹鍫曞箰閹绢喖纾??chunk ????;IDLE_MS ??????????????濠?闂?)??
    // ???闂??????婵?????婵犵數鍋為崹鍫曞蓟閵娾晩鏁勯柛娑卞枟濞??婵??????闂?闂?????????MAX_ATTEMPTS ???????闂??????婵????),
    // ????闂??闂????????闂????,?????婵???????
    const IDLE_MS = AI_IDLE_TIMEOUT_MS;       // provider idle timeout
    const MAX_ATTEMPTS = 3;      // 闂????????闂???????2 ??
    for (let attempt = 1; ; attempt++) {
        const ac = new AbortController();
        let idleTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => ac.abort(), IDLE_MS);
        const resetIdle = () => { if (idleTimer) clearTimeout(idleTimer); idleTimer = setTimeout(() => ac.abort(), IDLE_MS); };
        let yieldedAny = false;
        try {
            const stream = await client.chat.completions.create(requestBody, { signal: ac.signal });
            for await (const chunk of stream) {
                resetIdle();
                const content = chunk.choices[0]?.delta?.content || '';
                const usage = chunk.usage;
                const finishReason = chunk.choices[0]?.finish_reason;
                if (content) yieldedAny = true;
                yield {
                    content,
                    usage: usage ? {
                        prompt_tokens: usage.prompt_tokens,
                        completion_tokens: usage.completion_tokens,
                        total_tokens: usage.total_tokens
                    } : undefined,
                    finishReason: finishReason ?? undefined
                };
            }
            if (idleTimer) clearTimeout(idleTimer);
            return; // ????????
        } catch (err: any) {
            if (idleTimer) clearTimeout(idleTimer);
            const aborted = ac.signal.aborted;
            console.error(`[ERROR] callOpenAICompatible attempt ${attempt}/${MAX_ATTEMPTS}${aborted ? ' (idle-timeout abort)' : ''}:`, err?.message || err);
            // ??????闂?????婵????闂???闂??????闂????????????????????婵?)
            if (!yieldedAny && attempt < MAX_ATTEMPTS) {
                console.warn(`[RETRY] AI ???闂?????????{aborted ? '????' : '婵??'},???? attempt ${attempt + 1}/${MAX_ATTEMPTS}...`);
                continue;
            }
            throw new Error(aborted
                ? `AI stream idle-timeout after ${IDLE_MS / 1000}s (provider ??闂??闂???? token,???闂???)`
                : `OpenAI Compatible Error: ${err?.message || err}`);
        }
    }
}

/**
 * POST /api/generate
 * ?闂????闂備浇顕х换鎺楀磻閻樼偨浠堥柛婵勫劤閻? (??闂??闂??????)
 * 缂傚倸鍊搁崐鐑芥嚄閸洖绐楃€广儱娲ㄩ崡姘舵倵濞戞鎴炲垔?? Gemini API
 */
router.post('/', authenticate, checkRateLimit, async (req: AuthRequest, res: Response): Promise<void> => {
    let geminiApiKey: string | undefined;
    let fullRestoredText = '';
    let generationSlotAcquired = false;
    let userLockAcquired: string | null = null;
    let requestedModelKey: string | undefined;

    // ???缂????濠???闂?闂? (?濠??婵???????闂?婵??/??闂??:???闂備浇宕垫慨宕囨閿熺姴鍨傚ù鍏兼綑閹?,
    // ???? UsageLog ????,?????濠???闂?req.on('close') ????闂??????????婵?闂佽楠搁崢婊堝磻??,
    // ?????flag ??????abort,???????闂????flag ??婵?false ??闂????
    let clientClosed = false;
    req.on('close', () => {
        if (!res.writableEnded) {
            clientClosed = true;
            // 客户端断开(用户点「停止」/ 关闭页面 / 网络中断)→ 立刻释放该用户的并发锁与全局槽。
            // 否则这次生成会以「僵尸」状态一直占着锁,用户重试时误报「已有任务在进行」(即便前端看着没在跑)。
            // finally 里有 if(...Acquired) 守卫,这里置空后不会二次释放。
            if (userLockAcquired) { activeUserGenerations.delete(userLockAcquired); userLockAcquired = null; }
            if (generationSlotAcquired) { activeGenerations = Math.max(0, activeGenerations - 1); generationSlotAcquired = false; }
        }
    });

    try {
        const user = req.user;
        if (!user) {
            res.status(401).json(errorResponse('Unauthorized', 401));
            return;
        }

        if (!tryAcquireGenerationSlot()) {
            res.status(503).json(errorResponse('GEN_SERVER_BUSY', 503));
            return;
        }
        generationSlotAcquired = true;

        // ?濠?????????:闂傚倷绀侀幉锟犳嚌閻愵剛闄勯柡鍐ㄥ€婚崡?濠????????????????????????闂???)
        if (activeUserGenerations.has(user.id)) {
            res.status(429).json(errorResponse('GEN_IN_PROGRESS', 429));
            return;
        }
        activeUserGenerations.add(user.id);
        userLockAcquired = user.id;

        // 0. Fetch Dynamic System Config
        let dbConfig: Record<string, string> = {};
        try {
            const configs = await (prisma as any).systemConfig.findMany();
            dbConfig = configs.reduce((acc: any, curr: any) => ({ ...acc, [curr.key]: curr.value }), {});
        } catch (err) {
            // SystemConfig table might not exist
        }

        const { content, preset: rawPreset, fileName, styleConfig, model, imageInputs, preserveSourceHeadingNumbers }: GenerateRequest = req.body;
        // Normalize preset to lowercase to handle frontend sending 'CORPORATE' vs backend enum 'corporate'
        const preset = normalizePreset(rawPreset as string);
        // 闂?闂??????濠?闂傚倸鍊风欢锟犲磻閸曨垁鍥箯鐏炶姤娈??闂傚倷绀侀幖顐︽偋濠婂嫮顩叉繝闈涚墐閸??闂傚倷绀侀幖顐﹀疮椤愶附鍋夐柤娴嬫櫅閸?? deepseek(闂???????????濠????婵??闂?????)
        requestedModelKey = pickModelKey(model);

        // 纯图片上传时 content 本来就是空串(正文交给下面的 OCR 生成),不能算「缺字段」。
        if ((!content && !imageInputs?.length) || !preset || !fileName || !styleConfig) {
            res.status(400).json(errorResponse('GEN_MISSING_FIELDS', 400));
            return;
        }

        const userTier = (user.subscriptionStatus as keyof typeof TIER_LIMITS) || 'FREE';
        const rawContentLimit = Number(process.env.RAW_CONTENT_LIMIT || 60_000_000);
        if (content.length > rawContentLimit) {
            res.status(413).json(errorResponse(
                `Document payload too large (${content.length} chars, limit ${rawContentLimit}). Please reduce embedded images or upload a smaller file.`,
                413
            ));
            return;
        }

        // Truncate fileName to prevent oversized prompt injection
        const safeFileName = String(fileName).slice(0, 200);

        geminiApiKey = dbConfig['GOOGLE_API_KEY'] || process.env.GOOGLE_API_KEY;
        const selectedModelCfg = getModelConfig(requestedModelKey, dbConfig);
        if (!selectedModelCfg?.apiKey && !geminiApiKey) {
            res.status(500).json(errorResponse(`Server Config Error: Missing API key for ${requestedModelKey}`, 500));
            return;
        }

        // ??????? checkRateLimit ?闂??缂傚倸鍊搁崐鐑芥嚄閸洖绐楃€广儱娲ㄩ崡??濠?闂??????婵???闂?

        // 濠?闂??? chunk 闂???闂?????????闂傚倷娴囬鏍礂濞戞碍顐芥慨妯挎硾閻??

        // ????缂傚倸鍊风欢锟犲垂闂堟稓鏆﹂柣銏ゆ涧閸ㄦ繃绻涘顔荤盎缂??
        const numberingRules = getNumberingInstruction(styleConfig.headingNumbering);

        const BASE_SHARED_PROMPT = [
            'Formatting and structural rules:',
            '1. Use <h1 class="doc-title"> only for the document title. Do not use plain <h1> for sections.',
            '2. Use <h2> for top-level chapters, then <h3>, <h4>, and deeper levels for nested sections.',
            `3. Apply this numbering rule to headings starting at <h2>: ${numberingRules}`,
            '4. Preserve all source content. Do not summarize, invent, drop, or reorder body content.',
            '5. Preserve every image placeholder exactly, such as __IMG_0__. Do not rename or remove placeholders.',
            '6. Put figure captions directly below image placeholders and table captions directly above tables.',
            '   If the source already has a figure/table caption number, preserve that exact number and language. Do not translate 图/表 to Figure/Table and do not add a second number.',
            '   Preserve table header rows and cell text exactly; do not rewrite, merge, split, or invent table headers.',
            '7. Use semantic HTML only: headings, paragraphs, lists, tables, and caption divs.',
            '8. Keep math in LaTeX delimiters when formulas are present.',
            '9. Return only raw semantic HTML body content, with no Markdown fences.',
        ].join('\n');


        // ===== Dynamic System Prompt Construction =====

        // 1. Determine Figure Numbering Instruction
        let figureInstruction = "";
        if (styleConfig && styleConfig.figureNumbering === 'chapter-relative') {
            figureInstruction = [
                '- **FIGURE CAPTIONS (CHAPTER-RELATIVE)**:',
                '- If a source caption already starts with 图N / 图N-N / Figure N, preserve that exact caption text.',
                '- Only when a figure has no source caption, create `<div class="figure-caption">图{Chapter}-{Sequence} {Description}</div>`.',
            ].join('\n');
        } else {
            figureInstruction = [
                '- **FIGURE CAPTIONS (SEQUENTIAL)**:',
                '- If a source caption already starts with 图N / Figure N, preserve that exact caption text.',
                '- Only when a figure has no source caption, create `<div class="figure-caption">图{Sequence} {Description}</div>`.',
            ].join('\n');
        }

        // 2. Determine Table Numbering Instruction
        let tableInstruction = "";
        if (styleConfig && styleConfig.tableNumbering === 'chapter-relative') {
            tableInstruction = [
                '- **TABLE CAPTIONS (CHAPTER-RELATIVE)**:',
                '- If a source caption already starts with 表N / 表N-N / Table N, preserve that exact caption text.',
                '- Only when a table has no source caption, create `<div class="table-caption">表{Chapter}-{Sequence} {Description}</div>`.',
                '- Preserve all table header rows exactly as source.',
            ].join('\n');
        } else {
            tableInstruction = [
                '- **TABLE CAPTIONS (SEQUENTIAL)**:',
                '- If a source caption already starts with 表N / Table N, preserve that exact caption text.',
                '- Only when a table has no source caption, create `<div class="table-caption">表{Sequence} {Description}</div>`.',
                '- Preserve all table header rows exactly as source.',
            ].join('\n');
        }

        const systemInstruction = BASE_SYSTEM_PROMPTS[preset] + `

      ${BASE_SHARED_PROMPT}

      *** DYNAMIC NUMBERING RULES (OVERRIDE DEFAULTS) ***
      ${figureInstruction}
      ${tableInstruction}
        ` + (SYSTEM_PROMPT_SUFFIX[preset as keyof typeof SYSTEM_PROMPT_SUFFIX] ?? '');


        // 1a. Strip STRUCTURE_DATA (pre-computed heading numbers from frontend XML parser)
        //     before image extraction so it never reaches the AI as content.
        let preComputedHeadings: PreComputedHeading[] = [];
        // Always strip the STRUCTURE_DATA marker from content, regardless of parse success.
        // If parse fails, we still clean the content so the AI never sees the raw JSON.
        const structureDataMatch = content.match(/\n<!-- STRUCTURE_DATA -->\n([\s\S]*)$/);
        const contentStripped = structureDataMatch
            ? content.slice(0, structureDataMatch.index)
            : content;
        if (structureDataMatch) {
            try {
                preComputedHeadings = JSON.parse(structureDataMatch[1]) as PreComputedHeading[];
                console.log(`[STRUCTURE_DATA] Loaded ${preComputedHeadings.length} pre-computed headings`);
            } catch (e) {
                console.warn('[STRUCTURE_DATA] Parse failed, falling back to HTML extraction', e);
            }
        }
        const contentForProcessing = contentStripped;

        // 1b. ??闂傚倷绀侀幉锟犳偡閿曞倹鍋嬮柡鍥╀紳閻熼偊娼ㄩ柍褜鍓熼獮?(闂?闂???)
        const { textOnly: contentWithoutImages, imageMap } = extractImagesAsPlaceholders(contentForProcessing);
        const imageCount = Object.keys(imageMap).length;
        if (imageCount > 0) console.log(`[IMG] Extracted ${imageCount} images`);

        const contentLimit = getContentLimit(userTier);
        if (contentWithoutImages.length > contentLimit) {
            res.status(413).json(errorResponse(
                `Document text too large (${contentWithoutImages.length} chars after image extraction, limit ${contentLimit}). Please shorten it or upgrade your plan.`,
                413
            ));
            return;
        }

        // 1b-2. Extract FORMULA_DATA block BEFORE chunking so every chunk (not just the last)
        //       can reference it. The block is injected into each chunk's user content as a
        //       read-only reference ??it is never part of the content to be formatted.
        let formulaDataContext = '';
        let contentForChunking = contentWithoutImages;
        if (imageInputs?.length) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.write(`data: ${JSON.stringify({ ping: true, progress: { current: 0, total: 1, status: 'RECOGNIZING_IMAGES', estimatedRemainingSeconds: null } })}\n\n`);
            const recognized = await recognizeImagesForLayout(imageInputs);
            contentForChunking = [
                'The following content was extracted from uploaded image(s). Format it as a clean document using the selected style.',
                '',
                recognized,
                contentForChunking.replace(/^\[图片识别\][\s\S]*?排版。?\s*/u, '').trim(),
            ].filter(Boolean).join('\n\n');
        }
        const formulaMarkerIdx = contentForChunking.indexOf('\n<!-- FORMULA_DATA -->');
        if (formulaMarkerIdx !== -1) {
            formulaDataContext = contentForChunking.slice(formulaMarkerIdx + 1); // keeps the marker line
            contentForChunking = contentForChunking.slice(0, formulaMarkerIdx);
            console.log(`[FORMULA_DATA] Extracted ${formulaDataContext.length} chars ??will inject into all ${Math.ceil(contentForChunking.length / 12000)} chunks`);
        }

        // 1b-3. Heading level normalization: if the document has no H1 anywhere
        //        (neither in the HTML nor in preComputedHeadings), promote the
        //        highest heading level present to H1.
        //        This prevents "0.0.x" numbering when a Word doc uses H3/H4 as its
        //        top-level heading style.
        {
            const hasH1Html        = /<h1\b/i.test(contentForChunking);
            const hasH1PreComputed = preComputedHeadings.some(h => h.level === 1);
            if (!hasH1Html && !hasH1PreComputed) {
                const htmlLevels = [...contentForChunking.matchAll(/<h([1-6])\b/gi)].map(m => parseInt(m[1]));
                const pcLevels   = preComputedHeadings.map(h => h.level);
                const allLevels  = [...htmlLevels, ...pcLevels];
                if (allLevels.length > 0) {
                    const minLevel = Math.min(...allLevels);
                    if (minLevel > 1) {
                        const shift = minLevel - 1;
                        console.log(`[LEVEL_NORM] No H1 ??shifting all heading levels by -${shift} (H${minLevel}??H1)`);
                        // Single-pass replacement to avoid double-substitution.
                        // e.g. H3/H4/H5 with shift=2: H3??H1, H4??H2, H5??H3 in one pass.
                        contentForChunking = contentForChunking.replace(
                            /<(\/?)h([1-6])(\b[^>]*)?>/gi,
                            (_m, slash, lvlStr, attrs) => {
                                const lvl = parseInt(lvlStr);
                                if (lvl < minLevel) return _m; // already above minLevel, shouldn't occur
                                const newLvl = Math.max(1, lvl - shift);
                                return `<${slash}h${newLvl}${attrs ?? ''}>`;
                            }
                        );
                        // Also normalize preComputedHeadings so the structure map is consistent
                        if (preComputedHeadings.length > 0) {
                            preComputedHeadings = preComputedHeadings.map(h => ({
                                ...h,
                                level: Math.max(1, h.level - shift)
                            }));
                            console.log(`[LEVEL_NORM] Also shifted ${preComputedHeadings.length} pre-computed headings`);
                        }
                    }
                }
            }
        }

        // 1c. ?闂????:????(?闂? LEVEL_NORM ??preComputedHeadings ????闂???缂?,
        //     ?闂?????????AI ?闂傚倷鑳堕、濠冦仈缁嬫５娲冀椤愶絽鍘瑰┑鐘诧工閻楀﹪鍩??????闂傚倷绀侀幉锛勭矙閹烘鍋嬮柣鎰閺?婵犵數鍋為崹鍫曞箰閹绢喖纾????缂傚倸鍊搁崐鐑芥嚄閸洖绐楃€广儱娲ㄩ崡?闂????缂????????h1=?闂????闂傚倷鑳剁划顖炴偡閿曗偓椤啴宕稿Δ鈧悿?=?闂?h3=????,
        //     ??????????闂??濠????H1=????缂傚倸鍊风欢锟犲垂闂堟稓鏆﹂柣銏ゆ涧閸??缂傚倸鍊风拋鏌ュ磻??"h1=????"????闂?闂??缂傚倷鑳堕崑鎾愁熆濮椻偓閹宕楅崗鍏肩彿闂佸湱铏庨崰鏍不閻愮儤鐓熼柕蹇曞У閸熺偞绻??/ ??闂???????
        const skeleton: SkeletonNode[] = buildSkeleton(preComputedHeadings);
        if (skeleton.length > 0) {
            console.log(`[SKELETON] Frozen ${skeleton.length} headings, ${expectedChapterCount(skeleton)} chapters`);
        }

        let docStructureBlock = '';
        // ??????缂傚倸鍊风拋鏌ュ磻?婵犵數鍋涢顓熸叏椤撱垹纾?????婵犵數鍋為崹鍫曞箰閹绢喖纾????????????{ level=??????闂?? number }
        const headingNumberMap = new Map<string, { level: number; number: string }>();

        if (skeleton.length > 0) {
            // ???? 闂??闂??:?闂???????? Word XML,婵犵數鍋為崹鍫曞箰閹绢喖纾?闂???????闂????????h2) ????
            const chapterCount = expectedChapterCount(skeleton);
            const indent = ['', '', '', '  ', '    ', '      ', '        '];
            const lines = skeleton.map(n =>
                `${indent[n.outputLevel] ?? ''}<h${n.outputLevel}> [${n.number}] ${n.text}`
            ).join('\n');
            skeleton.forEach(n =>
                headingNumberMap.set(n.text.toLowerCase().trim(), { level: n.outputLevel, number: n.number })
            );
            docStructureBlock =
                `\n\n**DOCUMENT STRUCTURE (authoritative from Word XML). Output EXACTLY this set of headings:**\n` +
                `The body has **${chapterCount}** top-level chapter(s) (\`<h2>\`). Full outline (the \`<hN>\` shown is the OUTPUT level):\n` +
                `\`\`\`\n${lines}\n\`\`\`\n` +
                `CRITICAL RULES:\n` +
                `- Output each heading at EXACTLY the \`<hN>\` shown (\`<h2>\`=chapter, \`<h3>\`=section, \`<h4>\`=sub-section). \`<h1>\` is reserved for the document title ONLY; never emit a chapter as \`<h1>\`.\n` +
                `- Reproduce EXACTLY these headings, one heading per line above. NEVER merge two rows into one heading, NEVER split one row into two, NEVER add or drop a heading.\n` +
                `- The [bracket] number is the source document number. Preserve those numbers; do NOT restart numbering from 1, re-count, or drop digits.\n`;
        } else {
            // ???? ????闂??:??STRUCTURE_DATA(缂???闂?/????婵??)????HTML ???????;?闂????缂??????,????????"H1=?? ????
            const { outline: docHeadingOutline, levelMap: docHeadingLevelMap } = extractDocumentHeadingMap(contentForChunking);
            const levels = [...docHeadingLevelMap.values()];
            const minLvl = levels.length > 0 ? Math.min(...levels) : 1;
            const chapterCount = levels.filter(l => l === minLvl).length;
            // ????闂?= (HTML ?闂?- ??濠??) + 2 ????濠??闂????h2(??,?闂?h6??
            docHeadingLevelMap.forEach((level, text) =>
                headingNumberMap.set(text.toLowerCase().trim(), { level: Math.min(level - minLvl + 2, 6), number: '' })
            );
            if (docHeadingOutline) {
                docStructureBlock =
                    `\n\n**DOCUMENT STRUCTURE MAP (reproduce this exact hierarchy):**\n` +
                    `The body has about **${chapterCount}** top-level chapter(s). Heading hierarchy (indentation = nesting depth):\n` +
                    `\`\`\`\n${docHeadingOutline}\n\`\`\`\n` +
                    `RULES:\n` +
                    `- Reproduce EXACTLY these headings (same text, same nesting). One heading per line; NEVER merge or split, never add or drop.\n` +
                    `- Per the formatting rules above: \`<h1>\` is the document title ONLY; top-level chapters are \`<h2>\`; deeper sections are \`<h3>\`/\`<h4>\`??\n`;
            }
        }
        const systemInstructionWithMap = systemInstruction + docStructureBlock;

        // 2. ?????闂?
        // ULTRA ?濠???????闂?闂????缂???闂?婵??闂????闂????SSE ping ????????)
        // ??闂?濠?????12000 chars ?闂?
        // 濠?????? ????chunk 闂?????????????chunk ????
        const modelCfg     = selectedModelCfg;
        const useKey       = modelCfg?.apiKey  || geminiApiKey!;
        const useBase      = modelCfg?.baseUrl || (dbConfig['GEMINI_OPENAI_BASE_URL'] || process.env.GEMINI_OPENAI_BASE_URL || '');
        const currentModel = modelCfg?.modelId || PRIMARY_MODEL;
        const useProxy     = modelCfg ? (modelCfg.needsProxy ?? false) : true;
        // Gemini ????usage 缂?闂?????濠?缂???闂?婵??濠?闂傚倷娴囬妴鈧柛?闂??婵?
        const includeUsage = useProxy;

        const safeChunkSize = estimateSafeChunkSize(requestedModelKey, userTier);
        const estimatedChunks = Math.max(1, Math.ceil(contentForChunking.length / safeChunkSize));
        console.log(`[ESTIMATE_BUDGET] model=${requestedModelKey || 'gemini-pro'} safeChunkSize=${safeChunkSize} contentLen=${contentForChunking.length}`);
        console.log(`[ESTIMATED_CHUNKS] ${estimatedChunks}`);

        const integrityIssues: IntegrityIssue[] = [];
        let chunks: string[] = [];
        if (userTier === 'ULTRA') {
            // ULTRA ?闂???? chunk??x??????????濠?闂??????????闂????闂?
            const ultraChunkSize = safeChunkSize * 3;
            if (contentForChunking.length <= ultraChunkSize) {
                console.log('[ULTRA] Mode: Single-pass full document processing');
                chunks = [contentForChunking];
            } else {
                console.log(`[ULTRA] Mode: Large doc (${contentForChunking.length} chars), splitting into ${ultraChunkSize}-char chunks`);
                chunks = splitContentBySemantics(contentForChunking, ultraChunkSize);
            }
        } else {
            chunks = splitContentBySemantics(contentForChunking, safeChunkSize);
        }
        const beforeCompression = chunks.length;
        const compressed = compressChunksByCoverage(chunks, 0.78, 280);
        chunks = compressed.chunks;
        if (beforeCompression !== chunks.length) {
            console.log(`[CHUNK_COMPRESSED] from ${beforeCompression} to ${chunks.length} dropped=${compressed.dropped}`);
        }
        let structuredChunks: StructuredContentChunk[] = chunks.map((content, index) => ({
            content,
            start: index === 0 ? 0 : -1,
            end: -1,
            headings: [],
            headingPath: [],
            strategy: 'legacy',
        }));
        if (contentForChunking.length > safeChunkSize) {
            structuredChunks = splitContentIntoStructuredChunks(contentForChunking, userTier === 'ULTRA' ? safeChunkSize * 3 : safeChunkSize);
            const structuredCompressed = compressChunksByCoverage(structuredChunks.map(c => c.content), 0.78, 280);
            if (structuredCompressed.dropped > 0) {
                integrityIssues.push({ type: 'chunk_compressed', severity: 'info', detail: `Skipped ${structuredCompressed.dropped} overlapping chunk(s) during structured splitting` });
            }
            structuredChunks = structuredCompressed.chunks.map((content) => structuredChunks.find(c => c.content === content) ?? {
                content,
                start: -1,
                end: -1,
                headings: [],
                headingPath: [],
                strategy: 'structured-compressed',
            });
            chunks = structuredChunks.map(c => c.content);
        }
        console.log(`[SPLIT] Document split into ${chunks.length} chunk(s)`);

        let lastContext = '';
        /** Cumulative count of opening `<h1>` tags (chapter-level only) emitted so far. */
        let cumulativeH1BeforePart = 0;
        /** Cumulative figure caption count across all completed chunks (for 闂傚倷鐒﹂幃鍫曞磿瀹曞洠鍋?numbering). */
        let cumulativeFigureCount = 0;
        /** Cumulative table caption count across all completed chunks (for ??N numbering). */
        let cumulativeTableCount = 0;
        /**
         * Cumulative heading counter state across all completed chunks.
         * Maps heading level (1-6) ??last formatted heading text at that level.
         * e.g. { 1: "2. ?闂???闂?, 2: "2.2 婵犵數鍋為崹鍫曞箰婵犳艾绠板瀣捣缁犳棃鏌ｉ弮鍥т槐????????闂???", 3: "2.2.5 ?缂傚倸鍊搁崐椋庢閿熺姴鍨傛い蹇撶墕閸??闂傚倷娴囧銊х矆娓氣偓閹囧幢濞嗘帒小?? }
         * Used so continuation chunks know the FULL hierarchical prefix (e.g. "2.2.") to carry forward.
         */
        let headingCounterState: { [level: number]: string } = {};
        /**
         * Last N headings (with their generated numbers) from the most recently processed chunk.
         * e.g. "2. ?闂???闂???2.2 婵犵數鍋為崹鍫曞箰婵犳艾绠板瀣捣缁犳棃鏌ｉ弮鍥т槐?? ??2.2.5 ?缂傚倸鍊搁崐椋庢閿熺姴鍨傛い蹇撶墕閸??闂傚倷娴囧銊х矆娓氣偓閹囧幢濞嗘帒小?
         * Injected into the continuation prompt so the AI sees the exact numbered headings it produced
         * and can continue sequentially without restarting sub-levels at "1.".
         */
        let lastHeadingsState = '';
        const hasHtmlClass = (attrs: string, className: string): boolean => {
            const m = (attrs || '').match(/\bclass\s*=\s*"([^"]*)"/i);
            return !!m && m[1].split(/\s+/).some(x => x.toLowerCase() === className.toLowerCase());
        };
        const isNonBodyHeadingAttrs = (attrs: string): boolean =>
            hasHtmlClass(attrs, 'doc-title') || hasHtmlClass(attrs, 'doc-title-en') || hasHtmlClass(attrs, 'toc-placeholder');

        // ???? SSE ??闂??
        if (!res.headersSent) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
        }

        // ?????闂傚倷鐒﹂幃鍫曞磿鏉堛劍娅犻柤鎭掑劜濞????闂傚倷鐒﹂幃鍫曞磿鏉堛劍娅犻柤鎭掑劜濞呯娀鏌″搴″箹闁???闂傚倷鑳堕…鍫ユ晝閵堝瑙﹂悗锝庡墰閻??闂?闂???闂??闂備浇顕ф绋匡耿闁秴纾婚柣鎰▕濞??闂??闂傚倷绀侀幖顐﹀嫉椤掑嫬绠伴悹鍥ф▕濞?????婵????闂?? img ??缂?
        if (imageCount > 0) {
            res.write(`data: ${JSON.stringify({ imageMap })}\n\n`);
        }

        let totalExactTokens = 0;
        let finalChunksUsed = 0;
        // ??????闂???闂??????闂備浇宕垫慨鏉懨洪悩璇茬柧婵犲﹤鍠氶崵????闂????婵????婵??闂?/?????闂?,????? SSE ????闂??
        // 婵??????????????闂??濠电姵顔栭崳顖滃緤閻ｅ瞼鐭撶痪鎯ь儍娴??婵?濠电姷鏁告慨宥夊礋椤愩埄娼曞┑??婵犵數鍋為崹璺侯潖婵犳艾绐楅柡鍥舵娇閳???,???????? chunk_skipped ????,????"??婵????"???????
        if (compressed.dropped > 0) {
            integrityIssues.push({ type: 'chunk_compressed', severity: 'info', detail: `压缩去重时跳过了 ${compressed.dropped} 个与相邻内容重叠的分块` });
        }

        // 3. 闂?????? Chunks
        for (let i = 0; i < structuredChunks.length; i++) {
            const chunkMeta = structuredChunks[i];
            const chunkContent = chunkMeta.content;
            const chunkFirstHeading = extractFirstHeading(chunkContent);
            const renderedTail = normalizeText(fullRestoredText).slice(-5000);
            const headingCovered = chunkFirstHeading.length > 0 && renderedTail.includes(chunkFirstHeading);
            const overlap = calcTailHeadOverlap(fullRestoredText, chunkContent, 2600);
            const chunkHeadLen = Math.min(normalizeText(chunkContent).length, 2600);
            const coverageRatio = chunkHeadLen > 0 ? overlap / chunkHeadLen : 0;
            // ?婵??????????????濠电姵顔栭崰妤冩暜閳哄懎鐭楅幖娣妼閻???????????闂????闂????????濠???overlap??20 ?闂???????.78)
            // ???婵????濠???闂????闂?婵?婵?????????
            // ???闂???????"??婵????????闂?闂???
            //   ????闂??????闂?????(??.9)"???? ??闂???闂?(????/闂??/??闂???????闂??
            //   ?????? 2 ?闂? break ??闂?闂???????闂????
            // ?????婵????? truncateAtRepetitionLoop + ??闂????????(?闂??闂??????闂?婵??婵???
            const chunkHeadings = extractHeadingFingerprints(chunkContent);
            const outputHeadings = extractHeadingFingerprints(fullRestoredText.slice(-8000));
            const matchedHeadings = [...chunkHeadings].filter(h => outputHeadings.has(h));
            const headingCoverageRatio = chunkHeadings.size > 0 ? matchedHeadings.length / chunkHeadings.size : 0;
            const isDuplicateChunk = i > 0 && headingCovered && overlap >= 320 && coverageRatio >= 0.78;
            if (isDuplicateChunk) {
                console.log(`[SKIP_COVERED_CHUNK] part=${i + 1}/${chunks.length} heading="${chunkFirstHeading}" overlap=${overlap} coverage=${coverageRatio.toFixed(3)} fingerprint=${headingCoverageRatio.toFixed(2)}(${matchedHeadings.length}/${chunkHeadings.size})`);
                integrityIssues.push({ type: 'chunk_skipped', severity: 'info', detail: `第 ${i + 1} 部分内容与已生成内容高度重叠,已跳过(避免重复输出)` });
                // 闂?? preComputedHeadings ?闂??闂????闂???? chunk ??????缂傚倸鍊风拋鏌ュ磻??闂??
                if (preComputedHeadings.length > 0) {
                    const key = chunkFirstHeading.toLowerCase().trim();
                    const idx = preComputedHeadings.findIndex(h => h.text.toLowerCase().trim() === key);
                    if (idx >= 0) {
                        for (let k = idx; k < preComputedHeadings.length; k++) {
                            const h = preComputedHeadings[k];
                            const nextHeading = extractFirstHeading(chunks[i + 1] ?? '');
                            if (nextHeading && h.text.toLowerCase().trim() === nextHeading.toLowerCase().trim() && k > idx) break;
                            headingCounterState[h.level] = `${h.number} ${h.text}`;
                        }
                    }
                }
                continue;
            }

            console.log(`[CHUNK] Processing ${i + 1}/${chunks.length} (${chunkContent.length} chars) Model: ${currentModel}`);

            // ??闂????System Prompt
            let currentSystemPrompt = systemInstructionWithMap;
            const chunkHeadingList = chunkMeta.headings.map(h => `- H${h.level}: ${h.text}`).join('\n');
            const chunkStructureGuide = [
                `--- CURRENT PART STRUCTURE CONTRACT ---`,
                `Part ${i + 1}/${structuredChunks.length}; split strategy: ${chunkMeta.strategy}.`,
                chunkMeta.headingPath.length ? `Current heading path: ${chunkMeta.headingPath.join(' > ')}` : '',
                chunkHeadingList ? `Required headings in this part:\n${chunkHeadingList}` : 'No explicit headings in this part.',
                `Preserve every paragraph, table, list, formula, and image placeholder in reading order. Do not summarize or omit dense content.`,
            ].filter(Boolean).join('\n');
            currentSystemPrompt += `\n\n${chunkStructureGuide}`;

            if (i > 0) {
                currentSystemPrompt += `

                --- CONTINUATION MODE: PART ${i + 1} of ${chunks.length} ---

                **WHERE TO START (CRITICAL)**:
                This part's input begins with: "${chunkFirstHeading}"${(() => {
                    const entry = headingNumberMap.get(chunkFirstHeading.toLowerCase().trim());
                    if (!entry) return '';
                    return entry.number
                        ? ` ??pre-computed number: **[${entry.number}]**, level: H${entry.level}. Output as \`<h${entry.level}>\` with number "${entry.number}". Do NOT change level or re-count.`
                        : ` ??this heading is H${entry.level}. Output as \`<h${entry.level}>\`, NOT a higher level.`;
                })()}
                Your HTML output MUST start from this section ??do NOT output anything before it.

                **NO COVER / TITLE IN THIS PART (CRITICAL)**:
                The ????/??婵?and the document title were ALREADY produced in PART 1. This is a continuation part ??it has NO cover.
                NEVER output \`<h1 class="doc-title">\`, \`<div class="cover-page">\`, or any \`<p class="cover-meta">\` here, even if this part's input happens to open with text that resembles the document title. Begin directly at the section heading above using \`<h2>\` (or deeper). Re-emitting the title here corrupts numbering and the cover.

                **PREVIOUS PART CONTEXT (orientation only ??NOT a forbidden list)**:
                The previous part's HTML ended with:
                "...${lastContext.slice(-600)}"
                This tells you WHERE the previous chunk ended so you know the document state.
                It does NOT mean those headings/sentences are forbidden ??your task is to format EVERYTHING in the CURRENT INPUT regardless of what appeared above.

                **NUMBERING CONTINUATION (CRITICAL)**:
                - All HTML from completed parts before this one contains **${cumulativeH1BeforePart}** chapter-level \`<h2>\` tags (cumulative count, excludes document title).
                - **Do NOT restart** chapter-level numbering at 1 for this part. The next chapter \`<h2>\` in this part must be **chapter/section index ${cumulativeH1BeforePart + 1}** (continuing from where the previous part left off).
                - IMPORTANT: Use \`<h2>\` for chapter-level headings (NOT \`<h1>\`). \`<h1>\` is ONLY for document titles with class="doc-title".
                - Subordinate levels (\`<h3>\`, \`<h4>\`, ?? must also continue the hierarchical counter state implied by that continuation ??do not reset the whole outline to 1.x as if this were a new document.
                **HEADING COUNTER STATE** (use these to determine the next number at each level):
                ${lastHeadingsState
                    ? `Recent output chain (most authoritative ??the exact numbered text your model just produced):
                ${lastHeadingsState}
                Cumulative last heading per level across ALL completed parts${Object.keys(headingCounterState).length > 0 ? ':' : ': (none yet)'}
${Object.entries(headingCounterState).sort(([a],[b])=>+a-+b).map(([l,t])=>`                  H${l}: "${t}"`).join('\n')}`
                    : Object.keys(headingCounterState).length > 0
                        ? `Last heading at each level across ALL completed parts:
${Object.entries(headingCounterState).sort(([a],[b])=>+a-+b).map(([l,t])=>`                  H${l}: "${t}"`).join('\n')}`
                        : '(no headings processed yet ??start numbering from 1)'}
                CONTINUATION RULES:
                - Use the recent output chain first; fall back to the per-level table for levels not shown in the chain.
                - Your next heading at each level must come sequentially AFTER what is listed above ??do NOT restart any level at 1.
                - **HIERARCHICAL NUMBERING**: If the last H3 was "2.2.5 Foo", your next H3 under the SAME parent (2.2) MUST be "2.2.6 Bar" ??NEVER drop the parent prefix.
                - **NEW PARENT**: Entering a new H2 (e.g. "2.3 ??) resets the H3 counter to "2.3.1".
                - **FLAT NUMBERING**: If the scheme uses flat numbers (e.g. "5. Foo"), next is "6. Bar".
                - NEVER drop digits from a hierarchical number ("2.2.5" ??next is "2.2.6", not "6.").

                **FIGURE & TABLE NUMBERING CONTINUATION**:
                - Completed parts before this one contain **${cumulativeFigureCount}** figure caption(s) and **${cumulativeTableCount}** table caption(s).
                - Your NEXT figure caption must be ??{cumulativeFigureCount + 1}, next table caption must be ??{cumulativeTableCount + 1}.
                - Do NOT restart figure or table numbering at 1.

                **IMAGE PLACEHOLDER RULE (ABSOLUTE)**:
                - Placeholders like \`__IMG_55__\` appear in your input. The number is a FIXED UNIQUE ID ??copy it verbatim.
                - FORBIDDEN: Changing any digit in a placeholder. Output \`__IMG_55__\` as \`__IMG_55__\`, never as \`__IMG_56__\` or \`__IMG_1__\`.
                - FORBIDDEN: Inventing placeholder numbers not present in your input.

                **RULES**:
                1. Your FIRST line of output must be the formatted version of "${chunkFirstHeading}".
                2. Format ALL content in the current user input ??do NOT skip any section, even if its title resembles something in the previous context.
                3. Only skip content that is WORD-FOR-WORD identical to sentences in the previous context (exact duplicate sentences only).
                4. Obey **NUMBERING CONTINUATION** above; continue the configured numbering scheme from the stated H1 index, not from 1 again.
                5. Format ONLY the content in the user input. Stop as soon as the input content runs out.
                6. Do NOT invent or add any content not present in the input.
                `;
            } else {
                currentSystemPrompt += `\n\n**MODE**: PART 1 of ${chunks.length}. Start numbering from the beginning. Format ONLY the content provided. Stop when input runs out.`;
            }

            // Append formula reference to EVERY chunk so the AI can reconstruct OMML formulas
            // regardless of which chunk the formula appears in.
            // Cap at 8000 chars to limit extra token usage for very formula-heavy docs.
            const formulaSuffix = formulaDataContext
                ? `\n\n--- FORMULA REFERENCE (read-only ??DO NOT output or format this section) ---\n${formulaDataContext.slice(0, 8000)}\n--- END FORMULA REFERENCE ---`
                : '';
            const baseUserContent = `Filename: ${safeFileName}\n\n${chunkStructureGuide}\n\nContent Part ${i + 1} of ${chunks.length}:\n${chunkContent}\n\n--- END OF PART ${i + 1} INPUT ---\nFormat ONLY the content above. When you reach "--- END OF PART ${i + 1} INPUT ---", stop immediately.${formulaSuffix}`;
            let chunkOutput = '';

            // Stream-time hallucination guard: cap output numbered items at 2?? source + 5
            const inputItemCount = countNumberedItems(chunkContent);
            const maxOutputItems = Math.max(inputItemCount * 2 + 5, 20);
            let streamScanBuffer = 0;       // chars since last scan
            const STREAM_SCAN_INTERVAL = 500;

            try {
                // ??????????闂?
                //   ??baseUrl(DeepSeek/????/Qwen,?????闂???? Gemini)??OpenAI ???? SDK,????缂? baseUrl
                //   ??baseUrl(闂???婵? Gemini)??Google 闂?? SDK
                // 濠??:??????濠???缂??? useBase ?闂?,??????GEMINI_OPENAI_BASE_URL,
                // ???????濠??(??????baseUrl ??GEMINI_OPENAI_BASE_URL 婵??)?闂佽楠搁崢婊堝磻??闂?闂? Google??
                const useOpenAICompat = !!useBase;

                const statusText = chunks.length > 1
                    ? `PARTIAL_GENERATING|${i + 1}|${chunks.length}`
                    : `GENERATING`;

                // 濠?? 1s ???闂???ping????闂?闂傚倷绀侀幖顐﹀磻閸℃稑鍨傜€规洖娲﹂???????????????
                const pingInterval = setInterval(() => {
                    res.write(`data: ${JSON.stringify({ ping: true, progress: { current: i + 1, total: chunks.length, status: statusText, estimatedRemainingSeconds: null } })}\n\n`);
                }, 1000);

                // S3:濠????????? ??????婵犵數鍋犻幓顏嗗緤閻ｅ本宕查柟鐑橆殕閸婅埖绻涢幋娆忕仼缂????/????(idle-timeout / terminated ????
                // ????闂?闂備浇宕垫慨鏉懨洪妸鈺佺獥闁规壆澧楅崕???闂?闂佽娴烽幊鎾垛偓姘ュ姂瀹曟劕螖閸涱喗娅???????? chunkOutput ????,婵??闂????????婵?闂??;
                // ?闂? N ?婵??闂? ????? catch ???????濠???GEN_* ??缂傚倸鍊风拋鏌ュ磻??濠?闂傚倸鍊风欢锟犲磻閸曨垁鍥焼瀹ュ懐浼嬮梺鍝勭Р閸斿瞼娆??,??????闂?闂?????
                const MAX_CHUNK_ATTEMPTS = 3;
                try {
                  let validationRetryReason = '';
                  for (let chunkAttempt = 1; ; chunkAttempt++) {
                    chunkOutput = '';
                    try {
                    const userContent = validationRetryReason
                        ? `${baseUserContent}\n\n--- STRICT RETRY REQUIREMENTS ---\nThe previous attempt failed validation: ${validationRetryReason}\nRegenerate this part from scratch. Preserve every required heading and every source paragraph/table/list/image placeholder. Do not summarize, omit, repeat, or stop early.`
                        : baseUserContent;
                    if (useOpenAICompat) {
                        // 婵?? OpenAI Compatible Endpoint (DeepSeek / ???? / Qwen / ???? Gemini)
                        const maxTokens = modelCfg?.maxOutputTokens ?? (userTier === 'ULTRA' ? 32000 : 16000);
                        let finishReason: string | null = null;
                        let streamHallucinationDetected = false;

                        // ????????
                        for await (const result of callOpenAICompatible(useKey, useBase, currentSystemPrompt, userContent, currentModel, maxTokens, useProxy, includeUsage, modelCfg?.extraBody)) {
                            if (result.content) {
                                chunkOutput += result.content;
                                res.write(`data: ${JSON.stringify({ delta: result.content })}\n\n`);
                                streamScanBuffer += result.content.length;
                                if (streamScanBuffer >= STREAM_SCAN_INTERVAL) {
                                    streamScanBuffer = 0;
                                    // Guard 1: output item count cap (2?? input + 5)
                                    const outItems = countNumberedItems(chunkOutput);
                                    if (outItems > maxOutputItems) {
                                        console.log(`[STREAM_HALL] chunk ${i+1}: item count ${outItems} > max ${maxOutputItems}, breaking`);
                                        streamHallucinationDetected = true; break;
                                    }
                                    // Guard 2: same-body numbered list
                                    if (hasSameBodyHallucination(chunkOutput)) {
                                        console.log(`[STREAM_HALL] chunk ${i+1}: same-body repetition, breaking`);
                                        streamHallucinationDetected = true; break;
                                    }
                                    // Guard 3: sentence repetition
                                    if (hasStreamSentenceRepetition(chunkOutput)) {
                                        console.log(`[STREAM_HALL] chunk ${i+1}: sentence repetition, breaking`);
                                        streamHallucinationDetected = true; break;
                                    }
                                    // Guard 4: character/phrase spam
                                    if (hasCharSpam(chunkOutput)) {
                                        console.log(`[STREAM_HALL] chunk ${i+1}: char spam, breaking`);
                                        streamHallucinationDetected = true; break;
                                    }
                                    // Guard 5: output >> input length
                                    // Use max(inputLen, 2000) as floor to avoid false positives
                                    // on image-heavy chunks with little text. Threshold: 10??.
                                    const inputLenFloor = Math.max(chunkContent.length, 2000);
                                    if (chunkOutput.length > inputLenFloor * 10) {
                                        console.log(`[STREAM_HALL] chunk ${i+1}: output ${chunkOutput.length} >> input floor ${inputLenFloor} (10??), breaking`);
                                        streamHallucinationDetected = true; break;
                                    }
                                }
                            }
                            if (result.finishReason) finishReason = result.finishReason;
                            if (result.usage) totalExactTokens += result.usage.total_tokens || 0;
                        }
                        if (streamHallucinationDetected) {
                            finishReason = null; // skip continuation
                            integrityIssues.push({ type: 'stream_hallucination', severity: 'critical', detail: `第 ${i + 1} 部分输出出现异常重复/失控膨胀,已中断该部分生成` });
                        }

                        // ?闂???闂???? finish_reason === "length" 闂???闂??婵犵數鍋犻幓顏嗙礊閸モ晛绶ら柛褎顨嗛悞????
                        let continuations = 0;
                        while (finishReason === 'length' && continuations < 5) {
                            continuations++;
                            // 闂???闂?闂?? 600 ????婵??闂傚倷绀侀幉锟犲礉閺嶎厽鍋￠柍鍝勬噹閺?闂?????????婵?濠?婵???
                            const plainTail = chunkOutput.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(-600);
                            // 闂傚倷绀侀幉锟犳嚌妤ｅ啫瀚夋い鎺嗗亾妞??HTML 闂????????AI 闂????闂??缂傚倸鍊烽悞锔剧矙閹寸偞娅犻柤鎭掑劜閸??
                            const htmlTail = chunkOutput.slice(-200);
                            console.log(`[CONTINUE] Chunk ${i + 1} truncated (finish_reason=length), continuation ${continuations}/5`);

                            const continueUserContent = `TRUNCATION CONTINUATION ??DO NOT REPEAT\n\nYour previous HTML output was cut off mid-way. The last ~200 characters of your raw HTML output were:\n\`\`\`\n${htmlTail}\n\`\`\`\nThe last ~600 characters of PLAIN TEXT content (for reference) were:\n"...${plainTail}"\n\nRULES:\n1. Continue the HTML output from EXACTLY where it was cut ??complete any unclosed tags first if needed.\n2. ABSOLUTELY DO NOT repeat any sentence, paragraph, or heading already in the output above.\n3. Do NOT add any prefix, preamble, or "Continuing from..." text.\n4. Output ONLY the continuation HTML, nothing else.`;

                            finishReason = null;
                            for await (const result of callOpenAICompatible(useKey, useBase, currentSystemPrompt, continueUserContent, currentModel, maxTokens, useProxy, includeUsage, modelCfg?.extraBody)) {
                                if (result.content) {
                                    chunkOutput += result.content;
                                    res.write(`data: ${JSON.stringify({ delta: result.content })}\n\n`);
                                }
                                if (result.finishReason) finishReason = result.finishReason;
                                if (result.usage) totalExactTokens += result.usage.total_tokens || 0;
                            }

                            // Loop detection: break early if output is already repetitive
                            const loopCheckPlain = normalizeText(chunkOutput).slice(-1200);
                            const loopLast300 = loopCheckPlain.slice(-300).trim();
                            if (loopLast300.length > 100 && loopCheckPlain.slice(0, 900).includes(loopLast300)) {
                                console.log(`[LOOP_DETECTED] Repetitive continuation output at chunk ${i + 1}, breaking`);
                                break;
                            }
                        }

                        if (continuations > 0) {
                            console.log(`[CONTINUE] Chunk ${i + 1} completed after ${continuations} continuation(s), final finish_reason: ${finishReason}`);
                        }
                        {
                            const validationIssues = validateChunkOutput(chunkContent, chunkOutput, chunkMeta);
                            if (validationIssues.length > 0) {
                                throw new Error(`CHUNK_VALIDATION_FAILED: ${validationIssues.join('; ').slice(0, 700)}`);
                            }
                        }
                    } else {
                        // 婵??闂?? Google SDK
                        const proxyUrl = process.env.HTTPS_PROXY || 'http://127.0.0.1:7890';
                        const dispatcher = new ProxyAgent(proxyUrl);
                        const customFetch = (url: string | URL, init?: any) => {
                            return undiciFetch(url, { ...init, dispatcher });
                        };

                        const genAI = new GoogleGenerativeAI(geminiApiKey!);
                        const model = genAI.getGenerativeModel(
                            { model: currentModel, systemInstruction: currentSystemPrompt },
                            { customFetch } as any
                        );
                        const result = await model.generateContentStream([userContent]);
                        let googleStreamHallucinated = false;
                        for await (const chunk of result.stream) {
                            const txt = chunk.text();
                            if (txt) {
                                chunkOutput += txt;
                                res.write(`data: ${JSON.stringify({ delta: txt })}\n\n`);
                                streamScanBuffer += txt.length;
                                if (streamScanBuffer >= STREAM_SCAN_INTERVAL) {
                                    streamScanBuffer = 0;
                                    // Guard 1: output item count cap
                                    const outItems = countNumberedItems(chunkOutput);
                                    if (outItems > maxOutputItems) {
                                        console.log(`[STREAM_HALL] Google chunk ${i+1}: item count ${outItems} > max ${maxOutputItems}, breaking`);
                                        googleStreamHallucinated = true; break;
                                    }
                                    // Guard 2: same-body numbered list
                                    if (hasSameBodyHallucination(chunkOutput)) {
                                        console.log(`[STREAM_HALL] Google chunk ${i+1}: same-body repetition, breaking`);
                                        googleStreamHallucinated = true; break;
                                    }
                                    // Guard 3: sentence repetition
                                    if (hasStreamSentenceRepetition(chunkOutput)) {
                                        console.log(`[STREAM_HALL] Google chunk ${i+1}: sentence repetition, breaking`);
                                        googleStreamHallucinated = true; break;
                                    }
                                    // Guard 4: character/phrase spam
                                    if (hasCharSpam(chunkOutput)) {
                                        console.log(`[STREAM_HALL] Google chunk ${i+1}: char spam, breaking`);
                                        googleStreamHallucinated = true; break;
                                    }
                                    // Guard 5: output >> input length
                                    const inputLenFloorG = Math.max(chunkContent.length, 2000);
                                    if (chunkOutput.length > inputLenFloorG * 10) {
                                        console.log(`[STREAM_HALL] Google chunk ${i+1}: output ${chunkOutput.length} >> input floor ${inputLenFloorG} (10??), breaking`);
                                        googleStreamHallucinated = true; break;
                                    }
                                }
                            }
                        }
                        const aggregatedResponse = await result.response;
                        if (aggregatedResponse.usageMetadata) {
                            totalExactTokens += aggregatedResponse.usageMetadata.totalTokenCount || 0;
                        }
                        // Google SDK ?闂傚倷鐒﹂幃鍫曞磿閹惰棄绐楅柡宓秷鈧?闂傚倷鑳剁划顖滃枈瀹ュ绠伴柟缁㈠枛閸ㄥ倹銇勮濡茬牎TOKENS????skip if hallucination already detected
                        const googleFinishReason = aggregatedResponse.candidates?.[0]?.finishReason;
                        let googleContinuations = 0;
                        let googleFinish: string | undefined = googleStreamHallucinated ? undefined : googleFinishReason as string | undefined;
                        while (googleFinish === 'MAX_TOKENS' && googleContinuations < 5) {
                            googleContinuations++;
                            console.log(`[CONTINUE] Chunk ${i + 1} truncated (MAX_TOKENS), continuation ${googleContinuations}/5`);
                            const plainTailG = chunkOutput.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(-600);
                            const htmlTailG = chunkOutput.slice(-200);
                            const continueG = `TRUNCATION CONTINUATION ??DO NOT REPEAT\n\nYour previous HTML output was cut off. Last ~200 chars of raw HTML:\n\`\`\`\n${htmlTailG}\n\`\`\`\nLast ~600 chars plain text: "...${plainTailG}"\n\nRULES:\n1. Continue HTML from EXACTLY where cut ??close any open tags first if needed.\n2. ABSOLUTELY DO NOT repeat any content already written.\n3. No prefix or preamble. Output ONLY continuation HTML.`;
                            const contResult = await model.generateContentStream([continueG]);
                            for await (const chunk of contResult.stream) {
                                const txt = chunk.text();
                                if (txt) {
                                    chunkOutput += txt;
                                    res.write(`data: ${JSON.stringify({ delta: txt })}\n\n`);
                                }
                            }
                            const contAgg = await contResult.response;
                            if (contAgg.usageMetadata) totalExactTokens += contAgg.usageMetadata.totalTokenCount || 0;
                            googleFinish = contAgg.candidates?.[0]?.finishReason as string | undefined;

                            // Loop detection for Google SDK continuation
                            const loopCheckG = normalizeText(chunkOutput).slice(-1200);
                            const loopLast300G = loopCheckG.slice(-300).trim();
                            if (loopLast300G.length > 100 && loopCheckG.slice(0, 900).includes(loopLast300G)) {
                                console.log(`[LOOP_DETECTED] Repetitive Google continuation at chunk ${i + 1}, breaking`);
                                break;
                            }
                        }
                        {
                            const validationIssues = validateChunkOutput(chunkContent, chunkOutput, chunkMeta);
                            if (validationIssues.length > 0) {
                                throw new Error(`CHUNK_VALIDATION_FAILED: ${validationIssues.join('; ').slice(0, 700)}`);
                            }
                        }
                    }
                        break; // ??闂???濠电姷鏁搁崑娑㈠嫉椤掑嫭鍋￠柨鏇楀亾妞? ???婵?????闂??
                    } catch (chunkErr: any) {
                        const cmsg = String(chunkErr?.message ?? chunkErr ?? '');
                        if (cmsg.includes('CHUNK_VALIDATION_FAILED')) {
                            validationRetryReason = cmsg.replace(/^CHUNK_VALIDATION_FAILED:\s*/, '').slice(0, 700);
                            if (chunkAttempt < MAX_CHUNK_ATTEMPTS) {
                                console.warn(`[CHUNK_VALIDATE_RETRY] part=${i + 1}/${chunks.length} attempt=${chunkAttempt}: ${validationRetryReason}`);
                                continue;
                            }
                            integrityIssues.push({
                                type: 'chunk_validation_failed',
                                severity: 'warning',
                                detail: `Part ${i + 1} validation warning: ${validationRetryReason.slice(0, 500)}`,
                            });
                            break;
                        }
                        if (chunkAttempt < MAX_CHUNK_ATTEMPTS) {
                            console.warn(`[CHUNK_RETRY] ??${i + 1} ??? ${chunkAttempt}/${MAX_CHUNK_ATTEMPTS} ??????婵??${cmsg.slice(0, 80)}),???濠?`);
                            continue;
                        }
                        throw chunkErr; // ???闂傚倸鍊搁崐鍝モ偓姘ュ姂瀹曞綊宕崟鎯扳偓? ???濠???? ?????? GEN_* ????(缂傚倷鑳堕搹搴ㄥ矗鎼淬劌绀堟繛鍡樻尭妗??
                    }
                  }
                } finally {
                    clearInterval(pingInterval);
                }

                // Chunk ??闂????cleanOutput ??闂傚倷鐒﹂幃鍫曞磿鏉堛劍娅犻柤鎭掑劜濞??闂??闂?????闂???
                let cleanChunk = cleanOutput(chunkOutput);
                // Truncate any hallucination loop that slipped through during main generation
                const __beforeTruncLen = cleanChunk.length;
                cleanChunk = truncateAtRepetitionLoop(cleanChunk);
                if (cleanChunk.length < __beforeTruncLen) {
                    integrityIssues.push({ type: 'loop_truncated', severity: 'critical', detail: `第 ${i + 1} 部分检测到重复循环,已截断多余的 ${__beforeTruncLen - cleanChunk.length} 个字符` });
                }
                // Close any HTML tags left open by truncation (e.g. <li>, <td>, <ul>)
                cleanChunk = repairUnclosedTags(cleanChunk);
                // Official documents only: detect + reorder GB/T 9704-2012 red-head elements (first chunk only).
                // Work reports and meeting minutes intentionally do not use red-head ordering.
                if (preset === 'corporate' && i === 0) {
                    cleanChunk = detectCorporateElementClasses(cleanChunk);
                    cleanChunk = reorderCorporateDocument(cleanChunk);
                }
                // Re-insert any __IMG_N__ placeholders the AI dropped (safety net)
                cleanChunk = reinjectMissingPlaceholders(chunkContent, cleanChunk);
                // Ensure every __IMG_N__ has a figure caption ??inject generic one if missing
                cleanChunk = ensureFigureCaptions(cleanChunk, cumulativeFigureCount);
                lastContext = cleanChunk.replace(/<[^>]+>/g, ' ');

                // Count chapter-level H2s (chapters use <h2>) + any non-doc-title H1s (fallback in case AI uses h1 for chapters)
                const h2Tags = [...cleanChunk.matchAll(/<h2\b([^>]*)>/gi)]
                    .filter(m => !isNonBodyHeadingAttrs(m[1] || ''));
                const h1Tags = cleanChunk.match(/<h1\b[^>]*>/gi) ?? [];
                const h1NonTitle = h1Tags.filter(t => !isNonBodyHeadingAttrs(t)).length;
                const h1OpenInChunk = h2Tags.length + h1NonTitle;
                cumulativeH1BeforePart += h1OpenInChunk;
                // Update cumulative per-level heading counter state
                const hcRegex = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
                let hcMatch: RegExpExecArray | null;
                while ((hcMatch = hcRegex.exec(cleanChunk)) !== null) {
                    const lvl = parseInt(hcMatch[1]);
                    if (isNonBodyHeadingAttrs(hcMatch[2])) continue;
                    const txt = hcMatch[3].replace(/<[^>]+>/g, '').trim().slice(0, 80);
                    if (txt) headingCounterState[lvl] = txt;
                }
                console.log(`[HEADING_STATE] after chunk ${i + 1}:`, JSON.stringify(headingCounterState));
                // Update lastHeadingsState with the numbered heading chain from this chunk's output
                lastHeadingsState = extractLastHeadings(cleanChunk, 5);
                if (lastHeadingsState) console.log(`[LAST_HEADINGS] after chunk ${i + 1}: ${lastHeadingsState}`);
                // Track cumulative figure / table caption counts for continuation numbering
                cumulativeFigureCount += (cleanChunk.match(/<div\s+class="figure-caption"/gi) ?? []).length;
                cumulativeTableCount  += (cleanChunk.match(/<div\s+class="table-caption"/gi)  ?? []).length;
                console.log(`[CAPTION_STATE] after chunk ${i + 1}: figures=${cumulativeFigureCount} tables=${cumulativeTableCount}`);

                // 闂傚倷鐒﹂幃鍫曞磿鏉堛劍娅犻柤鎭掑劜濞?????闂備浇宕垫慨鏉懨洪敃鍌涘亱闁绘劕鎼崹???闂?????? __IMG_N__ 闂傚倷绀侀幉锟犮€冮崼鐔稿弿鐎规洖娲ㄧ粈??闂???闂?????postProcess
                // (reconcileImages 闂??/缂傚倸鍊搁崐鎼佸磹閹间礁绠规い鎰剁畱妗????),?????缂傚倸鍊搁崐鐑芥嚄閸洖绐楃€广儱娲ㄩ崡?restoreImages ????缂??濠??濠电姷鏁告慨宥夊礋椤愩埄娼撴繝鐢靛仜閻°劑鏁冮姀銈囧祦?闂???婵犵數鍋為崹鍫曞箰閹绢喖纾????
                // ??????闂??闂??<img> ????闂??闂??????????闂傚倷绀侀幉锟犮€冮崼鐔稿弿鐎规洖娲ㄧ粈???闂傚倷鑳剁划顖炲礉閺嵮屾綎閻犲洩灏欓弳锕€霉閻撳海鎽犻柟鍙夛耿閺岋繝宕掑☉鍗炲妼闂佸摜鍟块崑?闂??闂???
                fullRestoredText += cleanChunk;
                finalChunksUsed += 1;

                // ?????闂??闂傚倸鍊搁崐绋课涘畝鍕；??闂?闂?闂?闂?婵?闂????闂??闂???????????
                res.write(`data: ${JSON.stringify({
                    progress: {
                        current: i + 1,
                        total: chunks.length,
                        status: `PART_COMPLETE|${i + 1}|${chunks.length}`,
                        estimatedRemainingSeconds: (chunks.length - (i + 1)) * 15
                    }
                })}\n\n`);

            } catch (err: any) {
                console.error(`Error processing chunk ${i + 1}:`, err);
                throw err;
            }
        }
        console.log(`[FINAL_CHUNKS_USED] ${finalChunksUsed}/${chunks.length}`);

        res.write(`data: ${JSON.stringify({
            ping: true,
            progress: {
                current: chunks.length,
                total: chunks.length,
                status: 'VERIFYING',
                estimatedRemainingSeconds: null,
            },
        })}\n\n`);

        // ??缂????:???闂傚倸顭崑鍕洪敃鍌樷偓鍐幢濞戞瑥鍓??濠??闂????闂????闂??闂??闂??闂??+ ????????闂??????
        // (??闂??闂??????????????闂???闂傚倷绀侀幉锟犳嚌妤ｅ啫瀚夋い鎺嗗亾妞?闂傚倸鍊搁…顒佺濠婂牊鏅濋柕鍫濇偪?闂?濠???闂?缂?????

        // ???? token 婵???????? + ???) ??API 闂????闂????
        // ???? P0-3 缂???闂??? ??P0-1 闂??闂?? ??P0-4 ?????闂???闂?????
        // ?闂? AI 濠?婵犵妲呴崑鍡樻櫠濡ゅ懎鍨傚┑鍌氭啞閸???????/闂????婵??????闂?闂????? AI ????),?闂??????闂???????濠????
        // ???闂??????闂??闂???? ???婵??闂??(??闂傚倷绀侀幉锟犲箰閸濄儳鐭撻悗娑櫳戝▍??闂?闂?闂??delta,????????缂?闂????????濠?)??
        const tableRepair = reconcileMissingTables(contentForChunking, fullRestoredText);
        fullRestoredText = tableRepair.text;
        integrityIssues.push(...tableRepair.issues);

        const pp = postProcess(fullRestoredText, {
            scheme: styleConfig.headingNumbering,
            figureChapterRelative: styleConfig.figureNumbering === 'chapter-relative',
            tableChapterRelative: styleConfig.tableNumbering === 'chapter-relative',
            expectedImagePlaceholders: Object.keys(imageMap),
            preserveSourceHeadingNumbers: !!preserveSourceHeadingNumbers,
            sourceCaptions: extractSourceCaptions(contentForChunking),
            skeleton, // ?闂????:????闂??????闂傚倷娴囬鏍礂濞嗘挸绀夐幖杈剧稻椤?婵??heading_demoted / heading_missing ????????闂???
        });
        // EMF/WMF 闂????Visio/CAD)??????? docx ???闂?闂??????????ImageMagick ??PNG,????闂??
        // 婵犵數鍋為崹鍫曞箰閹绢喖纾??闂????闂傚倷绀侀幉锟犳嚌妤ｅ啫瀚夋い鎺嗗亾妞?闂?婵???濠????ImageMagick ????婵??闂???濠???(????闂傚倷绀侀幉锟犫€﹂崶顒€绐楅幖绮瑰煑???????),????缂傚倸鍊风拋鏌ュ磻??
        if (imageCount > 0) {
            // 闂???闂??????SSE ????:闂??闂傚倷鐒﹂幃鍫曞磿閹绘帞鏆︽俊顖氥偨???? token ????闂?濠电姷鏁搁崑鐐哄箰閼姐倕鏋堢€广儱鎷嬮悞?闂佽楠搁崢婊堝磻???????? idle ??闂????,
            // ????闂?? {text}/{done} ??闂??????闂?????濠??闂??闂??濠?????????闂????/婵??????")??
            const convPing = setInterval(() => {
                try { res.write(`data: ${JSON.stringify({ ping: true, progress: { current: chunks.length, total: chunks.length, status: 'PROCESSING_IMAGES', estimatedRemainingSeconds: null } })}\n\n`); } catch { /* client closed */ }
            }, 1000);
            try {
                const vres = await convertVectorImagesToPng(imageMap, { concurrency: 3 });
                if (vres.total > 0) console.log(`[VECTOR_IMG] converted=${vres.converted} failed=${vres.failed} total=${vres.total}`);
                if (vres.failed > 0) integrityIssues.push({ type: 'image_vector_unconverted', severity: 'warning', detail: `${vres.failed} vector image(s) could not be converted and may not display` });
            } finally {
                clearInterval(convPing);
            }
        }
        // 闂傚倷绀侀幉锟犮€冮崼鐔稿弿鐎规洖娲ㄧ粈???闂?缂傚倸鍊搁崐鐑芥嚄閸洖绐楃€广儱娲ㄩ崡??闂傚倷绀侀幉锟犫€﹂崶顒€绐楃€广儱娲︾€????<img>(postProcess ?婵?闂備浇宕垫慨鏉懨洪敐鍥╃焼濞撴埃鍋撻柣??+ 缂傚倸鍊搁崐鎼佸磹閹间礁绠规い鎰剁畱妗????,濠??濠电姷鏁告慨宥夊礋椤愩埄娼撴繝鐢靛仜閻°劑鏁冮姀銈囧祦??婵犵數鍋為崹鍫曞箰閹绢喖纾??
        const finalText = imageCount > 0 ? restoreImages(pp.text, imageMap) : pp.text;
        integrityIssues.push(...pp.issues);
        integrityIssues.push(...detectStructuralAnomalies(finalText)); // ????濠????>1 ??????

        let integrityReport: ReturnType<typeof buildIntegrityReport> | undefined;
        try {
            const inputCounts = countStructure(contentForChunking);
            const outputCounts = countStructure(finalText);
            integrityIssues.push(...validateFinalIntegrity(inputCounts, outputCounts));
            // S3b:???闂傚倷鑳堕崢褔骞夐埄鍐懝婵°倕鎳庨悞???? ?????????????????????闂????????,?????闂傚倷鑳堕～瀣焵椤掑嫬纾????????? >85% 婵犵數鍋為崹璺侯潖婵犳艾绐楅柡鍥舵娇閳??缂傚倸鍊风拋鏌ュ磻???????
            // ??婵????缂?闂?1~2 ?闂???????缂?90%????闂?闂佽娴烽幊鎾垛偓姘煎墴椤㈡牠宕卞Δ濠勫姺?闂?"?闂?缂??input/output ?闂?婵犵數鍋為崹鍫曞箰閹绢喖纾????????doc-title)??
            // ??闂???缂?闂??闂?缂傚倸鍊搁崐鎼佸磹閹间礁绠规い鎰剁畱妗??reconcileHeadingsToSkeleton ??heading_missing 闂???闂?,???闂???婵?????
            //??????闂傚倷绀侀幉锟犳嚌閻愵剛闄勯柡鍐ㄥ€婚崡????婵????heading_missing ?闂? early_stop)?????闂??闂傚倷娴囨慨銈夋偋濡や胶鐝堕柛鈩冪懄椤愪粙鏌ㄩ弴鐐测偓鎼佹煁?闂?闂??????闂????
            if (skeleton.length === 0 && inputCounts.headings > 0 && outputCounts.headings < inputCounts.headings) {
                const lost = inputCounts.headings - outputCounts.headings;
                if (lost / inputCounts.headings >= 0.3) {
                    integrityIssues.push({ type: 'early_stop', severity: 'critical', detail: `Output heading count ${outputCounts.headings} is far below source ${inputCounts.headings}; ${lost} section(s) may be missing` });
                } else {
                    integrityIssues.push({ type: 'headings_reduced', severity: 'warning', detail: `Output heading count ${outputCounts.headings} is below source ${inputCounts.headings}; please review ${lost} possible missing section(s)` });
                }
            }
            integrityReport = buildIntegrityReport(inputCounts, outputCounts, integrityIssues);
        } catch (e) {
            console.warn('[INTEGRITY] report build failed (non-fatal):', e);
        }
        // ???闂?缂???critical ?闂?(?闂?/婵??/????????闂傚倷鑳堕～瀣焵椤掑嫬纾??????婵??? ????????????"?缂??缂傚倷鑳堕搹搴ㄥ储閽樺娲冀椤撶偞宓???????闂傚倷娴囬鏍礈濮樿鲸宕查柛鈩冪⊕閸?
        const QUALITY_FLOOR = 85;
        const hasCritical = !!integrityReport && integrityReport.issues.some(x => x.severity === 'critical');
        const lowQuality = !!integrityReport && (hasCritical || integrityReport.charRetentionPct < QUALITY_FLOOR);

        res.write(`data: ${JSON.stringify({
            ping: true,
            progress: {
                current: chunks.length,
                total: chunks.length,
                status: 'FINALIZING',
                estimatedRemainingSeconds: null,
            },
        })}\n\n`);

        // Gemini ?闂?: ??1 token ~= 0.75 ??????????
        let finalReportedTokens = totalExactTokens;
        if (finalReportedTokens === 0) {
            const inputTokens = Math.ceil(contentWithoutImages.length / 3);
            const outputTokens = Math.ceil(finalText.length / 3);
            finalReportedTokens = inputTokens + outputTokens;
            console.log(`[WARN] Using estimated tokens instead of API reported tokens.`);
        }

        // ?缂????闂備浇宕垫慨宕囨閿熺姴鍨傚ù鍏兼綑閹? ?????? UsageLog ????,?????濠????
        if (clientClosed) {
            console.log(`[abort] client closed before completion, skipping UsageLog for user ${user.id}`);
            return;
        }

        // ??闂佽崵鍠愮划搴㈡櫠濡も偓鐓ら柟瀵稿仧缁????闂????闂?缂?闂?????闂???
        if (lowQuality) {
            console.log(`[INTEGRITY] low-quality result (critical=${hasCritical}, retention=${integrityReport?.charRetentionPct}%), skipping UsageLog for user ${user.id}`);
        } else {
            await prisma.usageLog.create({
                data: {
                    userId: user.id,
                    actionType: 'generate_document',
                    presetUsed: preset,
                    tokenUsage: finalReportedTokens
                }
            });
            await invalidateUsageCount(user.id);
        }

        console.log(`[DONE] Document generated. Tokens: ${finalReportedTokens} lowQuality=${lowQuality}`);

        // ?????????闂?????闂??闂??(闂???婵??闂佽瀛╅鏍窗閺嶎偅宕叉慨妞诲亾闁??)?????
        if (integrityReport) res.write(`data: ${JSON.stringify({ integrityReport })}\n\n`);
        res.write(`data: ${JSON.stringify({ text: finalText })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();

    } catch (aiError: any) {
        console.error('AI API Error:', aiError);

        // 缂傚倸鍊搁崐鐑芥嚄閸洖绐楃€广儱娲ㄩ崡???婵???????????闂?缂???闂???闂???(????/闂??),?????闂?缂????闂?闂?????
        // ????缂??闂??dev ??????errorDetail ?闂?(???闂????闂?),??婵??闂????????闂??
        const rawMsg = String(aiError?.message ?? aiError ?? '');
        let code = 'GEN_AI_UNAVAILABLE';
        const isApiKeyError = aiError.status === 401 || aiError.status === 403
            || rawMsg.includes('API key') || rawMsg.includes('Incorrect API key') || rawMsg.includes('invalid_api_key');
        if (isApiKeyError) {
            code = 'GEN_API_KEY_INVALID';
        } else if (rawMsg.includes('idle-timeout')) {
            code = 'GEN_STREAM_TIMEOUT';                 // ??????provider ??闂?濠??token
        } else if (rawMsg.includes('terminated') || rawMsg.includes('socket hang up') || rawMsg.includes('aborted')) {
            code = 'GEN_STREAM_INTERRUPTED';             // ??????闂?闂?(???闂?????
        } else if (rawMsg.includes('Connection') || rawMsg.includes('ECONNREFUSED') || rawMsg.includes('ETIMEDOUT') || rawMsg.includes('fetch failed') || rawMsg.includes('ENOTFOUND')) {
            code = 'GEN_NETWORK';
        } else if (rawMsg.includes('token count') || rawMsg.includes('too long') || rawMsg.includes('context length') || rawMsg.includes('maximum context')) {
            code = 'GEN_TOO_LONG';
        } else if (rawMsg.includes('VISION_NOT_CONFIGURED')) {
            code = 'VISION_NOT_CONFIGURED';
        } else if (rawMsg.includes('VISION_NO_TEXT_FOUND')) {
            code = 'VISION_NO_TEXT_FOUND';
        } else if (rawMsg.includes('VISION_TOO_MANY_IMAGES') || rawMsg.includes('VISION_IMAGE_TOO_LARGE') || rawMsg.includes('VISION_INVALID_IMAGE')) {
            code = 'VISION_INPUT_INVALID';
        } else if (rawMsg.includes('only support text messages') || rawMsg.includes('ModelNotOpen') || rawMsg.includes('InvalidEndpointOrModel')) {
            code = 'VISION_MODEL_UNAVAILABLE';
        } else if (rawMsg.includes('400') || rawMsg.includes('404')) {
            code = 'GEN_REGION_UNSUPPORTED';
        }

        if (!res.writableEnded) {
            const payload: { error: string; errorDetail?: string } = { error: code };
            if (process.env.NODE_ENV !== 'production') payload.errorDetail = rawMsg.slice(0, 200);
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
            res.end();
        }
    } finally {
        if (generationSlotAcquired) {
            activeGenerations = Math.max(0, activeGenerations - 1);
        }
        if (userLockAcquired) {
            activeUserGenerations.delete(userLockAcquired);
        }
    }
});

export default router;




