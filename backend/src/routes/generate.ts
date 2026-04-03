
import { Router, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { AuthRequest, GenerateRequest } from '../types';
import { errorResponse } from '../utils/response';
import { authenticate } from '../middleware/auth';
import { checkRateLimit } from '../middleware/rateLimit';
import prisma from '../config/database';

const router = Router();

import OpenAI from 'openai';
import { extractImagesAsPlaceholders, restoreImages } from '../utils/imageUtils';
import { BASE_SYSTEM_PROMPTS, getNumberingInstruction } from '../config/prompts';


type PreComputedHeading = { level: number; text: string; number: string };

// Helper to clean Markdown code blocks from the output
const cleanOutput = (text: string): string => {
    return text.replace(/```html/g, '').replace(/```/g, '').trim();
};

const normalizeText = (s: string): string => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const stripLeadingNumbers = (s: string): string =>
    s.replace(/(\d+\.)+\s*/g, '')
     .replace(/第[一二三四五六七八九十百千\d]+[章节条款部分]\s*/g, '')
     .replace(/\s+/g, ' ').trim();

const calcTailHeadOverlap = (a: string, b: string, maxWindow = 2200): number => {
    const left  = stripLeadingNumbers(normalizeText(a)).slice(-maxWindow);
    const right = stripLeadingNumbers(normalizeText(b)).slice(0, maxWindow);
    const maxLen = Math.min(left.length, right.length);
    for (let len = maxLen; len >= 80; len--) {
        if (left.slice(-len) === right.slice(0, len)) return len;
    }
    return 0;
};

/**
 * Post-processing safety net: re-insert any __IMG_N__ placeholders that the AI dropped.
 * Strategy: for each <div class="figure-caption"> in the output that has no placeholder
 * within the preceding 500 chars, prepend the next missing placeholder from the input.
 * This ensures captions always have their image, even when the AI omits the placeholder.
 */
const reinjectMissingPlaceholders = (chunkInput: string, chunkOutput: string): string => {
    const inputPlaceholders = [...chunkInput.matchAll(/__IMG_(\d+)__/g)].map(m => m[0]);
    if (inputPlaceholders.length === 0) return chunkOutput;

    const outputHasPlaceholder = new Set([...chunkOutput.matchAll(/__IMG_(\d+)__/g)].map(m => m[0]));
    const missing = inputPlaceholders.filter(p => !outputHasPlaceholder.has(p));
    if (missing.length === 0) return chunkOutput;

    console.log(`[IMG_REINJECT] ${missing.length} missing placeholder(s): ${missing.join(', ')}`);

    let missingIdx = 0;
    // Walk through output, inserting missing placeholders before orphaned figure captions
    const result = chunkOutput.replace(/(<div\s+class="figure-caption")/gi, (match, _tag, offset) => {
        if (missingIdx >= missing.length) return match;
        // Check if there's already a placeholder in the 500 chars before this caption
        const preceding = chunkOutput.slice(Math.max(0, offset - 500), offset);
        if (/__IMG_\d+__/.test(preceding)) return match; // caption already has an image nearby
        // Inject the next missing placeholder immediately before this caption
        const placeholder = missing[missingIdx++];
        console.log(`[IMG_REINJECT] Inserting ${placeholder} before figure-caption at offset ${offset}`);
        return `${placeholder}\n${match}`;
    });

    return result;
};

/** Extract last N heading texts (with numbers) from HTML output for continuation context. */
const extractLastHeadings = (html: string, n: number = 5): string => {
    const matches = [...html.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)];
    return matches.slice(-n).map(m => m[0].replace(/<[^>]+>/g, '').trim()).join(' → ');
};

/**
 * Extract a compact heading-level map from source HTML (before chunking).
 * Returns { outline, levelMap } where outline is a human-readable indented list
 * and levelMap maps normalised heading text → heading level (1-6).
 */
const extractDocumentHeadingMap = (html: string): { outline: string; levelMap: Map<string, number> } => {
    const levelMap = new Map<string, number>();
    const lines: string[] = [];
    const indent = ['', '', '  ', '    ', '      ', '        ', '          '];
    const regex = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
        const level = parseInt(match[1]);
        const text = match[2].replace(/<[^>]+>/g, '').trim().slice(0, 70);
        if (!text) continue;
        levelMap.set(text.toLowerCase(), level);
        lines.push(`${indent[level] ?? '  '}H${level}: ${text}`);
    }
    return { outline: lines.join('\n'), levelMap };
};

/**
 * Detect a hallucination loop in HTML output (same block repeating ≥3 times in a row)
 * and truncate to just before the loop started.
 * Returns the original string if no loop is found.
 */
const truncateAtRepetitionLoop = (html: string): string => {
    const plain = normalizeText(html);
    if (plain.length < 450) return html;

    const tailLen = Math.min(plain.length, 4000);
    const tail = plain.slice(-tailLen);

    for (let segLen = 120; segLen <= 450; segLen += 15) {
        const candidate = tail.slice(-segLen).trim();
        if (candidate.length < 80) continue;

        // Count consecutive backward repetitions
        let pos = tail.length - segLen;
        let repeats = 1;
        while (pos >= segLen) {
            if (tail.slice(pos - segLen, pos).trim() === candidate) {
                repeats++;
                pos -= segLen;
            } else {
                break;
            }
        }

        if (repeats >= 3) {
            // `pos` is where the loop starts inside `tail`
            const loopStartInPlain = plain.length - tailLen + pos;
            const ratio = loopStartInPlain / plain.length;
            // Give extra slack so we don't cut too aggressively
            const searchUpTo = Math.min(html.length, Math.floor(html.length * ratio) + segLen * 3);
            const htmlBefore = html.slice(0, searchUpTo);
            // Find nearest closing block tag just before the loop
            const blockTags = ['</h1>', '</h2>', '</h3>', '</h4>', '</h5>', '</h6>', '</p>', '</li>', '</div>'];
            let bestCut = -1;
            for (const tag of blockTags) {
                const idx = htmlBefore.lastIndexOf(tag);
                if (idx > bestCut) bestCut = idx + tag.length;
            }
            if (bestCut > html.length * 0.05) {
                console.log(`[LOOP_TRUNCATED] ${repeats}x repeat (segLen=${segLen}), truncating HTML at ${bestCut}/${html.length}`);
                return html.slice(0, bestCut);
            }
        }
    }
    return html;
};

const estimateSafeChunkSize = (modelKey: string | undefined, userTier: keyof typeof TIER_LIMITS): number => {
    const baselineByModel: Record<string, number> = {
        'gemini-flash': 12000,
        'gemini-pro': 16000,
        'doubao': 9000,
        'deepseek': 6000,
        'qwen-max': 6000
    };
    const base = baselineByModel[modelKey || ''] || 12000;
    const tierFactor = userTier === 'ULTRA' ? 1.35 : 1.0;
    return Math.max(4000, Math.floor(base * tierFactor));
};



import { TIER_LIMITS } from '../config/tierConfig';
import { splitContentBySemantics, extractFirstHeading, compressChunksByCoverage } from '../utils/chunking';

const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3-pro-preview';
const MAX_CONCURRENT_GENERATIONS = Math.max(1, Number(process.env.MAX_CONCURRENT_GENERATIONS || 50));

interface ModelConfig { apiKey: string; baseUrl: string; modelId: string; needsProxy?: boolean; maxOutputTokens?: number; }

function getModelConfig(modelKey: string, dbConfig: Record<string, string>): ModelConfig | null {
    const geminiKey  = dbConfig['GOOGLE_API_KEY']        || process.env.GOOGLE_API_KEY        || '';
    const geminiBase = dbConfig['GEMINI_OPENAI_BASE_URL'] || process.env.GEMINI_OPENAI_BASE_URL || '';
    const registry: Record<string, ModelConfig> = {
        'gemini-flash': { apiKey: geminiKey,  baseUrl: geminiBase, modelId: 'gemini-2.0-flash',                          needsProxy: true,  maxOutputTokens: 16000 },
        'gemini-pro':   { apiKey: geminiKey,  baseUrl: geminiBase, modelId: process.env.GEMINI_MODEL || 'gemini-3-pro-preview', needsProxy: true,  maxOutputTokens: 32000 },
        'doubao':       { apiKey: process.env.DOUBAO_API_KEY   || '', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',        modelId: process.env.DOUBAO_ENDPOINT_ID || '', needsProxy: false, maxOutputTokens: 8192 },
        'deepseek':     { apiKey: process.env.DEEPSEEK_API_KEY || '', baseUrl: 'https://api.deepseek.com/v1',                     modelId: 'deepseek-chat',                      needsProxy: false, maxOutputTokens: 8192 },
        'qwen-max':     { apiKey: process.env.DASHSCOPE_API_KEY || '', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelId: 'qwen-max',                        needsProxy: false, maxOutputTokens: 8192 },
    };
    return registry[modelKey] ?? null;
}
let activeGenerations = 0;

const tryAcquireGenerationSlot = (): boolean => {
    if (activeGenerations >= MAX_CONCURRENT_GENERATIONS) return false;
    activeGenerations += 1;
    return true;
};

// OpenAI Compatible API Call (for Gemini via proxy)
async function* callOpenAICompatible(
    apiKey: string,
    baseUrl: string,
    systemPrompt: string,
    userContent: string,
    modelName: string,
    maxTokens?: number,
    useProxy?: boolean,
    includeUsage?: boolean
): AsyncGenerator<{ content: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }; finishReason?: string | null }> {
    console.log('DEBUG: callOpenAICompatible start', { baseUrl, modelName, apiKeyLength: apiKey?.length, maxTokens, useProxy });

    try {
        const clientOptions: ConstructorParameters<typeof OpenAI>[0] = { apiKey, baseURL: baseUrl };
        if (useProxy) {
            const proxyUrl = process.env.HTTPS_PROXY || 'http://127.0.0.1:10809';
            const dispatcher = new ProxyAgent(proxyUrl);
            clientOptions.fetch = ((url: any, init: any) => undiciFetch(url, { ...init, dispatcher })) as any;
        }
        const client = new OpenAI(clientOptions);

        const stream = await client.chat.completions.create({
            model: modelName,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
            ],
            stream: true,
            ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
            temperature: 0.1,
            max_tokens: maxTokens
        });

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            const usage = chunk.usage;
            const finishReason = chunk.choices[0]?.finish_reason;

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
    } catch (err: any) {
        console.error('[ERROR] callOpenAICompatible Error:', err);
        if (err.response) {
            console.error('[ERROR] status:', err.status);
            console.error('[ERROR] data:', err.response.data);
        }
        throw new Error(`OpenAI Compatible Error: ${err.message}`);
    }
}

/**
 * POST /api/generate
 * 文档生成接口 (需要验证和限流)
 * 统一使用 Gemini API
 */
router.post('/', authenticate, checkRateLimit, async (req: AuthRequest, res: Response): Promise<void> => {
    let geminiApiKey: string | undefined;
    let fullRestoredText = '';
    let generationSlotAcquired = false;
    let requestedModelKey: string | undefined;

    try {
        const user = req.user;
        if (!user) {
            res.status(401).json(errorResponse('Unauthorized', 401));
            return;
        }

        if (!tryAcquireGenerationSlot()) {
            res.status(503).json(errorResponse('当前生成请求较多，请稍后重试', 503));
            return;
        }
        generationSlotAcquired = true;

        // 0. Fetch Dynamic System Config
        let dbConfig: Record<string, string> = {};
        try {
            const configs = await (prisma as any).systemConfig.findMany();
            dbConfig = configs.reduce((acc: any, curr: any) => ({ ...acc, [curr.key]: curr.value }), {});
        } catch (err) {
            // SystemConfig table might not exist
        }

        const { content, preset, fileName, styleConfig, model }: GenerateRequest = req.body;
        requestedModelKey = model;

        if (!content || !preset || !fileName || !styleConfig) {
            res.status(400).json(errorResponse('缺少必要参数', 400));
            return;
        }

        // 获取用户等级与配置
        const userTier = (user.subscriptionStatus as keyof typeof TIER_LIMITS) || 'FREE';

        // Truncate fileName to prevent oversized prompt injection
        const safeFileName = String(fileName).slice(0, 200);

        geminiApiKey = dbConfig['GOOGLE_API_KEY'] || process.env.GOOGLE_API_KEY;

        if (!geminiApiKey) {
            res.status(500).json(errorResponse('Server Config Error: Missing GOOGLE_API_KEY', 500));
            return;
        }

        // 配额已由 checkRateLimit 中间件统一检查，此处无需重复查询

        // 模型将在 chunk 循环中根据索引动态选择

        // 构建系统指令
        const numberingRules = getNumberingInstruction(styleConfig.headingNumbering);

        const BASE_SHARED_PROMPT = `
      \nFormatting & Structural Analysis Rules:
      1. **DOCUMENT TITLE vs HEADINGS (CRITICAL)**:
         - Identify the **Document Title**. Wrap it in \`<h1 class="doc-title">\`. NO numbering.
         - Start numbering from the **first content section**.

      2. **IDENTIFY SECTIONS**:
         - Analyze semantic structure. Tag <h1>, <h2>... <h6>.

      3. **APPLY NUMBERING SCHEME**:
         - ${numberingRules}
         - **STRIP OLD NUMBERING, APPLY TEMPLATE (CRITICAL)**:
             - The user has chosen a numbering template (e.g. decimal: 1. / 1.1 / 1.1.1). This template is the SINGLE source of truth for all heading numbers in the output.
             - Before tagging a heading, STRIP any pre-existing numbering prefix from the heading text, then apply the configured numbering scheme.
             - Prefixes to strip (remove entirely from heading text):
               - Chinese ordinal: "一、", "二、", "三、", ... "十、" and multi-character like "十一、"
               - Chinese chapter/section: "第一章", "第二章", "第一节", "第二节", etc.
               - Arabic decimal: "1.", "2.", "1.1", "1.1.1", "3.4.4.", etc. (leading digits + dots)
               - Parenthesized ASCII: "(1)", "(2)", "(一)", "(二)", etc.
               - Parenthesized full-width: "（1）", "（2）", "（一）", "（二）", etc.
             - After stripping, apply the template number, then output the clean heading text.
             - Example: Input "一、核心原理" with decimal template → strip "一、" → apply "2." → Output \`<h2>2. 核心原理</h2>\`
             - Example: Input "（1）误差方程" with decimal template → strip "（1）" → apply "3.4.1" → Output \`<h4>3.4.1 误差方程</h4>\`
             - Example: Input "核心原理" (no prefix) → apply "1." → Output \`<h2>1. 核心原理</h2>\`
             - **NEVER output both the original numbering prefix AND the template number** — the result must have exactly one number prefix from the template.
         - **WORD AUTO-NUMBERING BUG FIX (CRITICAL)**:
             - Microsoft Word stores auto-numbering separately from the paragraph text. After conversion to HTML, list numbering information is LOST. The result is that every ordered-list item appears as "1." in the browser. YOU must detect and fix these patterns.
             - **INPUT IS HTML — DETECT BY TAG STRUCTURE, NOT PLAINTEXT "1."**:
               Your user input is HTML (e.g. \`<ol><li>...</li></ol>\`, \`<p>...</p>\`). There is often **no** literal \`1.\` / \`2.\` text in the source — do **not** wait for those characters. Infer broken numbering from **repeated \`<ol>\` / single-\`<li>\` structures** and sibling markup, exactly as below.
             - **PATTERN A — Consecutive \`<ol>\` blocks directly adjacent (no \`<p>\` between them)**:
               **HTML shape** (what you actually receive): \`<ol><li>A</li></ol><ol><li>B</li></ol><ol><li>C</li></ol>\`
               These are consecutive list items incorrectly split. Merge into ONE \`<ol>\`: \`<ol><li>A</li><li>B</li><li>C</li></ol>\`.
               FORBIDDEN: leaving them as separate \`<ol>\` blocks — the browser renders each as "1.".
             - **PATTERN B — Multiple \`<ol>\` blocks each with EXACTLY ONE \`<li>\`, separated by \`<p>\` or other non-list content**:
               **HTML shape** (what you actually receive): \`<ol><li>TopicA</li></ol><p>body text...</p><ol><li>TopicB</li></ol><p>body text...</p><ol><li>TopicC</li></ol>\`
               **DETECTION (HTML-only)**: Two or more \`<ol>\` elements where **each** contains **exactly one** \`<li>\`, with \`<p>\`, \`<table>\`, \`<div>\`, or other **non-list** elements between those \`<ol>\` blocks. Do **not** require a leading \`1.\` in the \`<li>\` text — the bug is visible from tags alone.
               These are SEQUENTIAL SECTION HEADINGS — NOT true lists. Word's auto-numbering was lost, so the browser shows every item as "1.".
               **Fix**: Convert EACH single-item \`<ol><li>text</li></ol>\` block to an appropriate heading tag (\`<h2>\`, \`<h3>\`, \`<h4>\` — match the level indicated by context and surrounding headings).
               **Strip old prefix, apply template number**: If the \`<li>\` text starts with an old numbering prefix (Chinese ordinal like "一、", "二、"; parenthesized like "(1)", "（1）"; Arabic like "1.", "2."), STRIP that prefix first, then assign the sequential template number.
               - Example: \`<ol><li>一、TopicA</li></ol><p>body</p><ol><li>二、TopicB</li></ol>\` → strip "一、"/"二、" → \`<h2>1. TopicA</h2><p>body</p><h2>2. TopicB</h2>\`
               - Example (no prefix): \`<ol><li>TopicA</li></ol><p>body</p><ol><li>TopicB</li></ol>\` → \`<h2>1. TopicA</h2><p>body</p><h2>2. TopicB</h2>\`
               FORBIDDEN: Keeping them as \`<ol>\` elements. FORBIDDEN: Numbering all as "1.". FORBIDDEN: Keeping old prefix AND adding template number (e.g. "2. 二、TopicB").
             - **UNIVERSAL RULE**: Within any given parent section, you MUST NEVER output N headings or items of the same level ALL labeled "1." when they are clearly a sequence. Count them and assign 1, 2, 3, ..., N.
             - FORBIDDEN: Multiple headings/items at the same level all labeled "1." when they belong to the same sequential section.
         - **LISTS (CRITICAL)**:
             - ONLY convert to a list if the source text EXPLICITLY has list markers ("1.", "1)", "(1)", "-", "•") on CONSECUTIVE lines (2+ items in a row).
             - A single sentence that happens to start with "1." is NOT a list — keep it as a paragraph.
             - FORBIDDEN: Adding list numbers to normal body paragraphs that are NOT lists in the source.
             - FORBIDDEN: Converting regular paragraphs or prose steps into numbered lists.
             - PRESERVE the source structure: if the source uses prose paragraphs, keep them as paragraphs.
         - Use standard HTML list tags (\`<ul>\`, \`<ol>\`, \`<li>\`) only for genuine lists.

      3b. **MULTIPLE DOCUMENTS IN ONE FILE (CRITICAL)**:
         - If the source contains what appears to be TWO OR MORE separate documents (multiple standalone title lines with completely different topics), treat the ENTIRE content as ONE combined document.
         - Do NOT restart section numbering (H1, H2...) when a new apparent document title appears mid-content.
         - Continue the numbering scheme throughout the entire content — e.g. if Document 1 ends at section 6, Document 2's first section MUST be 7, not 1.
         - Wrap each document's title with \`<h1 class="doc-title">\` (no numbering), but keep body section numbering continuous.

      4. **Content Integrity (STRICT)**:
         - **ZERO DATA LOSS**. Output every sentence, row, and list item.
         - **VERBATIM BODY TEXT**. Do not summarize.
         - **LOOP PREVENTION (CRITICAL)**:
            - If you notice your own output repeating the same paragraph, formula, or numbered item with only a counter incrementing (e.g. (5) calc... (6) calc... (7) calc... with the same body each time), STOP IMMEDIATELY — this means you are hallucinating content not present in the source.
            - Only generate content that is explicitly present in the source input. Do NOT invent additional iterations of any repeating pattern.
         - **PRESERVE IMAGES (HIGHEST PRIORITY)**:
            - You will see placeholders like \`__IMG_0__\`.
            - You MUST output them **EXACTLY** as is.
            - DO NOT put them inside headers (h1-h6).
            - DO NOT rename them (e.g. to \`__IMG_1__\` if it was \`__IMG_0__\`).
            - DO NOT delete them. If input has 5 images, output MUST have 5 images.

       5. **MATH & FORMULAS & VARIABLES (HIGHEST PRIORITY)**:
          - Use **LaTeX** for ALL mathematical expressions (e.g. variables \`$x$\`, equations).
          - DELIMITERS:
             - Use \`$$\` for Display/Block Math (e.g. \`$$ E=mc^2 $$\`).
             - Use \`$\` for Inline Math (e.g. \`$(x, y)$\`).
          - **STRICT ACCURACY**:
             - Do NOT change variable names (e.g. \`a_0\` must remain \`a_0\`).
             - Do NOT simplify or solve equations.
             - Reproduce the exact notation from the source text.
          - **FORMULA_DATA SECTION (CRITICAL)**:
             - The input may contain a \`<!-- FORMULA_DATA -->\` HTML comment marker followed by a raw text representation of the document. This section contains complete LaTeX equations (e.g. \`$$ \\theta = ... $$\`) extracted directly from Word's OMML (equation objects).
             - This section exists because the MAIN HTML above it has DEGRADED OMML equations — Word equation objects appear as isolated variable characters (θ, φ, x₀, etc.) on their own lines.
             - **HOW TO USE**: When you see isolated single variable/character symbols (e.g. \`<p>θ</p>\`, \`<p>x₀</p>\`) in the main HTML, these are OMML formula placeholders. Find the corresponding full \`$$...$$\` equation in the FORMULA_DATA section (match by surrounding context/position) and output it INSTEAD of the isolated character.
             - **DO NOT output the FORMULA_DATA section as document content.** It is a reference tool only. Your output must NOT include the \`<!-- FORMULA_DATA -->\` marker or any raw text from that block verbatim.
             - If no matching full equation is found, wrap the isolated symbol in inline LaTeX: \`$\\theta$\`.
          - **VARIABLE DEFINITION LISTS (CRITICAL)**:
             - When the source text has patterns like "vx, vy: meaning" or "x, y—meaning" or "a0 constant term", treat these as **definition items**, NOT standalone list items.
             - NEVER convert variable names (latin letters, subscripts) into Chinese punctuation or other characters.
             - Keep the original variable identifiers (e.g. $v_x$, $v_y$) in their LaTeX form.
             - Format each variable definition as: \`<p>$v_x$, $v_y$: meaning</p>\`
             - Do NOT turn "vx, vy:" into bullet points.

       6. **IMAGES & FIGURES (CRITICAL)**:
         - **PRESERVE PLACEHOLDERS (ABSOLUTE RULE)**:
           - Image placeholders look like \`__IMG_0__\`, \`__IMG_55__\`, \`__IMG_122__\`, etc.
           - The NUMBER inside is a **fixed unique ID assigned before you were called** — it is NOT a sequence counter.
           - You MUST copy each placeholder **character-for-character, digit-for-digit** exactly as it appears in your input.
           - **FORBIDDEN**: Changing \`__IMG_55__\` to \`__IMG_1__\`, \`__IMG_56__\`, or any other number.
           - **FORBIDDEN**: Inventing placeholder numbers that were not in your input.
           - **FORBIDDEN**: Placing placeholders inside \`<h1>\`–\`<h6>\` tags.
           - If an image placeholder is in your input, it MUST appear in your output at the same relative position.
         - **MANDATORY PAIRING**: Every \`__IMG_N__\` placeholder MUST appear in your output, and it MUST be followed IMMEDIATELY by a figure caption.
         - Format:
           \`__IMG_55__\`
           \`<div class="figure-caption">图3 系统架构示意图</div>\`
         - **NEVER** output a \`<div class="figure-caption">\` without its \`__IMG_N__\` placeholder directly above it.
         - **NEVER** output a \`__IMG_N__\` without a \`<div class="figure-caption">\` directly below it.
         - If you are unsure of the figure description, use a generic one like "示意图" — but you MUST keep the placeholder.

       7. **TABLES (CRITICAL)**:
          - **MANDATORY**: Generate a TABLE TITLE for EVERY table.
          - Position: **IMMEDIATELY ABOVE** the table.
          - Format: \`<div class="table-caption">表{N} {Description}</div>\`
          - Example: \`<div class="table-caption">表1 价格方案对比</div>\n<table>...</table>\`
          - **NO TEXT-INDENT in table cells**: Do NOT use text-indent in \`<td>\` or \`<th>\` content.

      8. **CAPTION STYLE**:
         - Use generic counters (图1, 图2... 表1, 表2...) unless specific numbering is required.
         - Center align captions.

      9. **TOC HANDLING**:
         - Do NOT output the actual TOC items - the system will generate Word native TOC.

      10. **Output**: Return ONLY raw semantic HTML body content.
    `;


        // ===== Dynamic System Prompt Construction =====

        // 1. Determine Figure Numbering Instruction
        let figureInstruction = "";
        if (styleConfig && styleConfig.figureNumbering === 'chapter-relative') {
            figureInstruction = `
          - **FIGURE CAPTIONS (CHAPTER-RELATIVE)**:
            - You MUST rename figure captions to follow "图[Chapter]-[Sequence]" format.
            - Detect the current Chapter (H1) number (e.g. "1", "2", "3").
            - Reset figure sequence at each new Chapter.
            - Example: In Chapter 1, use "图1-1", "图1-2". In Chapter 2, use "图2-1".
            - Format: \`<div class="figure-caption">图{Chapter}-{Sequence} {Description}</div>\`
            `;
        } else {
            figureInstruction = `
          - **FIGURE CAPTIONS (SEQUENTIAL)**:
            - Use continuous numbering across the document "图[Sequence]".
            - Format: \`<div class="figure-caption">图{Sequence} {Description}</div>\`
            `;
        }

        // 2. Determine Table Numbering Instruction
        let tableInstruction = "";
        if (styleConfig && styleConfig.tableNumbering === 'chapter-relative') {
            tableInstruction = `
          - **TABLE CAPTIONS (CHAPTER-RELATIVE)**:
            - You MUST rename table captions to follow "表[Chapter]-[Sequence]" format.
            - Detect the current Chapter (H1) number.
            - Reset table sequence at each new Chapter.
            - Example: "表1-1", "表2-1".
            - Format: \`<div class="table-caption">表{Chapter}-{Sequence} {Description}</div>\`
            `;
        } else {
            tableInstruction = `
          - **TABLE CAPTIONS (SEQUENTIAL)**:
            - Use continuous numbering across the document.
            - Format: \`<div class="table-caption">表{Sequence} {Description}</div>\`
            `;
        }

        const systemInstruction = BASE_SYSTEM_PROMPTS[preset] + `

      ${BASE_SHARED_PROMPT}

      *** DYNAMIC NUMBERING RULES (OVERRIDE DEFAULTS) ***
      ${figureInstruction}
      ${tableInstruction}
        `;


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

        // 1b. 提取图片 (全局处理)
        const { textOnly: contentWithoutImages, imageMap } = extractImagesAsPlaceholders(contentForProcessing);
        const imageCount = Object.keys(imageMap).length;
        if (imageCount > 0) console.log(`[IMG] Extracted ${imageCount} images`);

        // 1b-2. Extract FORMULA_DATA block BEFORE chunking so every chunk (not just the last)
        //       can reference it. The block is injected into each chunk's user content as a
        //       read-only reference — it is never part of the content to be formatted.
        let formulaDataContext = '';
        let contentForChunking = contentWithoutImages;
        const formulaMarkerIdx = contentWithoutImages.indexOf('\n<!-- FORMULA_DATA -->');
        if (formulaMarkerIdx !== -1) {
            formulaDataContext = contentWithoutImages.slice(formulaMarkerIdx + 1); // keeps the marker line
            contentForChunking = contentWithoutImages.slice(0, formulaMarkerIdx);
            console.log(`[FORMULA_DATA] Extracted ${formulaDataContext.length} chars — will inject into all ${Math.ceil(contentForChunking.length / 12000)} chunks`);
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
                        console.log(`[LEVEL_NORM] No H1 — shifting all heading levels by -${shift} (H${minLevel}→H1)`);
                        // Single-pass replacement to avoid double-substitution.
                        // e.g. H3/H4/H5 with shift=2: H3→H1, H4→H2, H5→H3 in one pass.
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

        // 1c. Build document structure block for the system prompt.
        //     Priority: pre-computed headings from XML (exact) > HTML heading tags (approximate).
        let docStructureBlock = '';
        // Lookup map: normalised heading text → { level, number }
        const headingNumberMap = new Map<string, { level: number; number: string }>();

        if (preComputedHeadings.length > 0) {
            // ── Authoritative path: use numbers extracted directly from Word XML ──
            const h1Count = preComputedHeadings.filter(h => h.level === 1).length;
            const indent = ['', '', '  ', '    ', '      ', '        '];
            const lines = preComputedHeadings.map(h =>
                `${indent[h.level] ?? ''}H${h.level} [${h.number}] ${h.text}`
            ).join('\n');
            preComputedHeadings.forEach(h =>
                headingNumberMap.set(h.text.toLowerCase().trim(), { level: h.level, number: h.number })
            );
            docStructureBlock =
                `\n\n**PRE-COMPUTED HEADING NUMBERS (authoritative — extracted from Word XML)**:\n` +
                `This document has **${h1Count}** top-level chapter(s). ` +
                `Every heading below already has its exact number pre-calculated.\n` +
                `\`\`\`\n${lines}\n\`\`\`\n` +
                `CRITICAL RULES:\n` +
                `- The number in [brackets] IS the correct number for that heading. Use it EXACTLY.\n` +
                `- DO NOT re-count or re-number. DO NOT add or drop digits (e.g. [2.2.6] must appear as "2.2.6", never as "6." or "5.").\n` +
                `- DO NOT change the H-level (e.g. H3 must stay <h3>, never <h1> or <h2>).\n` +
                `- Apply the configured numbering FORMAT to these numbers (e.g. "第N章" for H1 if the scheme uses it).\n`;
        } else {
            // ── Fallback path: derive from HTML heading tags (less reliable) ──
            const { outline: docHeadingOutline, levelMap: docHeadingLevelMap } = extractDocumentHeadingMap(contentForChunking);
            const h1Count = [...docHeadingLevelMap.values()].filter(l => l === 1).length;
            docHeadingLevelMap.forEach((level, text) =>
                headingNumberMap.set(text.toLowerCase().trim(), { level, number: '' })
            );
            if (docHeadingOutline) {
                docStructureBlock =
                    `\n\n**DOCUMENT STRUCTURE MAP (MANDATORY REFERENCE — DO NOT DEVIATE)**:\n` +
                    `This document has exactly **${h1Count} top-level chapter(s) (H1)**. The complete heading hierarchy is:\n` +
                    `\`\`\`\n${docHeadingOutline}\n\`\`\`\n` +
                    `RULES:\n` +
                    `- Each line is one heading. The H-level shown IS correct — output it at exactly that level.\n` +
                    `- H1 = top-level chapter (numbered 1 … ${h1Count}). H2/H3/H4 = sub-sections.\n` +
                    `- NEVER promote an H2/H3/H4 to H1. Number H1 chapters 1 … ${h1Count} across the entire document.\n`;
            }
        }
        const systemInstructionWithMap = systemInstruction + docStructureBlock;

        // 2. 语义切分
        // ULTRA 用户：单次全文处理，确保章节顺序和编号完全正确(SSE ping 保活连接)
        // 普通用户：按 12000 chars 切分
        // 模型配置 — 在 chunk 循环外解析，所有 chunk 共用
        const modelCfg     = requestedModelKey ? getModelConfig(requestedModelKey, dbConfig) : null;
        const useKey       = modelCfg?.apiKey  || geminiApiKey!;
        const useBase      = modelCfg?.baseUrl || (dbConfig['GEMINI_OPENAI_BASE_URL'] || process.env.GEMINI_OPENAI_BASE_URL || '');
        const currentModel = modelCfg?.modelId || PRIMARY_MODEL;
        const useProxy     = modelCfg ? (modelCfg.needsProxy ?? false) : true;
        // Gemini 需要 usage 统计；国内模型不需要且部分不支持该字段
        const includeUsage = useProxy;

        const safeChunkSize = estimateSafeChunkSize(requestedModelKey, userTier);
        const estimatedChunks = Math.max(1, Math.ceil(contentForChunking.length / safeChunkSize));
        console.log(`[ESTIMATE_BUDGET] model=${requestedModelKey || 'gemini-pro'} safeChunkSize=${safeChunkSize} contentLen=${contentForChunking.length}`);
        console.log(`[ESTIMATED_CHUNKS] ${estimatedChunks}`);

        let chunks: string[] = [];
        if (userTier === 'ULTRA') {
            // ULTRA 用更大的 chunk（3x），但超出模型单次输出容量时仍需分块
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
        console.log(`[SPLIT] Document split into ${chunks.length} chunk(s)`);

        let lastContext = '';
        /** Cumulative count of opening `<h1>` tags (chapter-level only) emitted so far. */
        let cumulativeH1BeforePart = 0;
        /** Cumulative figure caption count across all completed chunks (for 图N numbering). */
        let cumulativeFigureCount = 0;
        /** Cumulative table caption count across all completed chunks (for 表N numbering). */
        let cumulativeTableCount = 0;
        /**
         * Cumulative heading counter state across all completed chunks.
         * Maps heading level (1-6) → last formatted heading text at that level.
         * e.g. { 1: "2. 研究进展", 2: "2.2 专业模块智能设计方法", 3: "2.2.5 风场尾流效应…" }
         * Used so continuation chunks know the FULL hierarchical prefix (e.g. "2.2.") to carry forward.
         */
        let headingCounterState: { [level: number]: string } = {};
        /**
         * Last N headings (with their generated numbers) from the most recently processed chunk.
         * e.g. "2. 研究进展 → 2.2 专业模块 → 2.2.5 风场尾流效应"
         * Injected into the continuation prompt so the AI sees the exact numbered headings it produced
         * and can continue sequentially without restarting sub-levels at "1.".
         */
        let lastHeadingsState = '';

        // 设置 SSE 响应头
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // 如果有图片，将图片映射字典发给前端，让前端实时流式渲染时可以替换回真实的 img 标签
        if (imageCount > 0) {
            res.write(`data: ${JSON.stringify({ imageMap })}\n\n`);
        }

        let totalExactTokens = 0;
        let consecutiveCoveredSkips = 0;
        let finalChunksUsed = 0;

        // 3. 循环处理 Chunks
        for (let i = 0; i < chunks.length; i++) {
            const chunkContent = chunks[i];
            const chunkFirstHeading = extractFirstHeading(chunkContent);
            const renderedTail = normalizeText(fullRestoredText).slice(-5000);
            const headingCovered = chunkFirstHeading.length > 0 && renderedTail.includes(chunkFirstHeading);
            const overlap = calcTailHeadOverlap(fullRestoredText, chunkContent, 2600);
            const chunkHeadLen = Math.min(normalizeText(chunkContent).length, 2600);
            const coverageRatio = chunkHeadLen > 0 ? overlap / chunkHeadLen : 0;
            if (i > 0 && headingCovered && overlap >= 320 && coverageRatio >= 0.78) {
                consecutiveCoveredSkips += 1;
                console.log(`[SKIP_COVERED_CHUNK] part=${i + 1}/${chunks.length} heading="${chunkFirstHeading}" overlap=${overlap} coverage=${coverageRatio.toFixed(3)}`);
                // Sync heading counter state from preComputedHeadings for skipped chunks,
                // so the continuation prompt for the next processed chunk stays accurate.
                if (preComputedHeadings.length > 0) {
                    const key = chunkFirstHeading.toLowerCase().trim();
                    const idx = preComputedHeadings.findIndex(h => h.text.toLowerCase().trim() === key);
                    if (idx >= 0) {
                        // Walk forward through preComputed until the chunk boundary to update state
                        for (let k = idx; k < preComputedHeadings.length; k++) {
                            const h = preComputedHeadings[k];
                            // Stop when we reach a heading that belongs to the NEXT chunk
                            const nextHeading = extractFirstHeading(chunks[i + 1] ?? '');
                            if (nextHeading && h.text.toLowerCase().trim() === nextHeading.toLowerCase().trim() && k > idx) break;
                            headingCounterState[h.level] = `${h.number} ${h.text}`;
                        }
                    }
                }
                if (consecutiveCoveredSkips >= 2) {
                    console.log(`[EARLY_STOP_COVERAGE] stop_at_part=${i + 1} total=${chunks.length}`);
                    break;
                }
                continue;
            }
            consecutiveCoveredSkips = 0;

            console.log(`[CHUNK] Processing ${i + 1}/${chunks.length} (${chunkContent.length} chars) Model: ${currentModel}`);

            // 动态构建 System Prompt
            let currentSystemPrompt = systemInstructionWithMap;

            if (i > 0) {
                currentSystemPrompt += `

                --- CONTINUATION MODE: PART ${i + 1} of ${chunks.length} ---

                **WHERE TO START (CRITICAL)**:
                This part's input begins with: "${chunkFirstHeading}"${(() => {
                    const entry = headingNumberMap.get(chunkFirstHeading.toLowerCase().trim());
                    if (!entry) return '';
                    return entry.number
                        ? ` — pre-computed number: **[${entry.number}]**, level: H${entry.level}. Output as \`<h${entry.level}>\` with number "${entry.number}". Do NOT change level or re-count.`
                        : ` — this heading is H${entry.level}. Output as \`<h${entry.level}>\`, NOT a higher level.`;
                })()}
                Your HTML output MUST start from this section — do NOT output anything before it.

                **PREVIOUS PART CONTEXT (orientation only — NOT a forbidden list)**:
                The previous part's HTML ended with:
                "...${lastContext.slice(-600)}"
                This tells you WHERE the previous chunk ended so you know the document state.
                It does NOT mean those headings/sentences are forbidden — your task is to format EVERYTHING in the CURRENT INPUT regardless of what appeared above.

                **NUMBERING CONTINUATION (CRITICAL)**:
                - All HTML from completed parts before this one contains **${cumulativeH1BeforePart}** opening \`<h1>\` tags (cumulative count).
                - **Do NOT restart** top-level / chapter-style numbering at 1 for this part. Treat the next logical first \`<h1>\` in this part as **chapter/section index ${cumulativeH1BeforePart + 1}** for any scheme that numbers by H1 order (including chapter-relative 图/表 captions if applicable).
                - Subordinate levels (\`<h2>\`, \`<h3>\`, …) must also continue the hierarchical counter state implied by that continuation — do not reset the whole outline to 1.x as if this were a new document.
                **HEADING COUNTER STATE** (use these to determine the next number at each level):
                ${lastHeadingsState
                    ? `Recent output chain (most authoritative — the exact numbered text your model just produced):
                ${lastHeadingsState}
                Cumulative last heading per level across ALL completed parts${Object.keys(headingCounterState).length > 0 ? ':' : ': (none yet)'}
${Object.entries(headingCounterState).sort(([a],[b])=>+a-+b).map(([l,t])=>`                  H${l}: "${t}"`).join('\n')}`
                    : Object.keys(headingCounterState).length > 0
                        ? `Last heading at each level across ALL completed parts:
${Object.entries(headingCounterState).sort(([a],[b])=>+a-+b).map(([l,t])=>`                  H${l}: "${t}"`).join('\n')}`
                        : '(no headings processed yet — start numbering from 1)'}
                CONTINUATION RULES:
                - Use the recent output chain first; fall back to the per-level table for levels not shown in the chain.
                - Your next heading at each level must come sequentially AFTER what is listed above — do NOT restart any level at 1.
                - **HIERARCHICAL NUMBERING**: If the last H3 was "2.2.5 Foo", your next H3 under the SAME parent (2.2) MUST be "2.2.6 Bar" — NEVER drop the parent prefix.
                - **NEW PARENT**: Entering a new H2 (e.g. "2.3 …") resets the H3 counter to "2.3.1".
                - **FLAT NUMBERING**: If the scheme uses flat numbers (e.g. "5. Foo"), next is "6. Bar".
                - NEVER drop digits from a hierarchical number ("2.2.5" → next is "2.2.6", not "6.").

                **FIGURE & TABLE NUMBERING CONTINUATION**:
                - Completed parts before this one contain **${cumulativeFigureCount}** figure caption(s) and **${cumulativeTableCount}** table caption(s).
                - Your NEXT figure caption must be 图${cumulativeFigureCount + 1}, next table caption must be 表${cumulativeTableCount + 1}.
                - Do NOT restart figure or table numbering at 1.

                **IMAGE PLACEHOLDER RULE (ABSOLUTE)**:
                - Placeholders like \`__IMG_55__\` appear in your input. The number is a FIXED UNIQUE ID — copy it verbatim.
                - FORBIDDEN: Changing any digit in a placeholder. Output \`__IMG_55__\` as \`__IMG_55__\`, never as \`__IMG_56__\` or \`__IMG_1__\`.
                - FORBIDDEN: Inventing placeholder numbers not present in your input.

                **RULES**:
                1. Your FIRST line of output must be the formatted version of "${chunkFirstHeading}".
                2. Format ALL content in the current user input — do NOT skip any section, even if its title resembles something in the previous context.
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
                ? `\n\n--- FORMULA REFERENCE (read-only — DO NOT output or format this section) ---\n${formulaDataContext.slice(0, 8000)}\n--- END FORMULA REFERENCE ---`
                : '';
            const userContent = `Filename: ${safeFileName}\n\nContent Part ${i + 1} of ${chunks.length}:\n${chunkContent}\n\n--- END OF PART ${i + 1} INPUT ---\nFormat ONLY the content above. When you reach "--- END OF PART ${i + 1} INPUT ---", stop immediately.${formulaSuffix}`;
            let chunkOutput = '';

            try {
                // 检查是否使用 OpenAI Compatible 代理
                const geminiOpenAIBaseUrl = dbConfig['GEMINI_OPENAI_BASE_URL'] || process.env.GEMINI_OPENAI_BASE_URL;

                const statusText = chunks.length > 1
                    ? `PARTIAL_GENERATING|${i + 1}|${chunks.length}`
                    : `GENERATING`;

                // 每隔 1s 发送进度 ping，让前端骨架屏进度条有响应
                const pingInterval = setInterval(() => {
                    res.write(`data: ${JSON.stringify({ ping: true, progress: { current: i + 1, total: chunks.length, status: statusText, estimatedRemainingSeconds: null } })}\n\n`);
                }, 1000);

                try {
                    if (geminiOpenAIBaseUrl) {
                        // 使用 OpenAI Compatible Endpoint (如 hiapi.online)
                        const maxTokens = modelCfg?.maxOutputTokens ?? (userTier === 'ULTRA' ? 32000 : 16000);
                        let finishReason: string | null = null;

                        // 初次生成
                        for await (const result of callOpenAICompatible(useKey, useBase, currentSystemPrompt, userContent, currentModel, maxTokens, useProxy, includeUsage)) {
                            if (result.content) {
                                chunkOutput += result.content;
                                res.write(`data: ${JSON.stringify({ delta: result.content })}\n\n`);
                            }
                            if (result.finishReason) finishReason = result.finishReason;
                            if (result.usage) totalExactTokens += result.usage.total_tokens || 0;
                        }

                        // 截断续写：当 finish_reason === "length" 时，自动从断点继续
                        let continuations = 0;
                        while (finishReason === 'length' && continuations < 5) {
                            continuations++;
                            // 取纯文本尾部 600 字作为续写锚点（更多上下文防止重复）
                            const plainTail = chunkOutput.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(-600);
                            // 同时取 HTML 尾部，帮助 AI 知道当前标签状态
                            const htmlTail = chunkOutput.slice(-200);
                            console.log(`[CONTINUE] Chunk ${i + 1} truncated (finish_reason=length), continuation ${continuations}/5`);

                            const continueUserContent = `TRUNCATION CONTINUATION — DO NOT REPEAT\n\nYour previous HTML output was cut off mid-way. The last ~200 characters of your raw HTML output were:\n\`\`\`\n${htmlTail}\n\`\`\`\nThe last ~600 characters of PLAIN TEXT content (for reference) were:\n"...${plainTail}"\n\nRULES:\n1. Continue the HTML output from EXACTLY where it was cut — complete any unclosed tags first if needed.\n2. ABSOLUTELY DO NOT repeat any sentence, paragraph, or heading already in the output above.\n3. Do NOT add any prefix, preamble, or "Continuing from..." text.\n4. Output ONLY the continuation HTML, nothing else.`;

                            finishReason = null;
                            for await (const result of callOpenAICompatible(useKey, useBase, currentSystemPrompt, continueUserContent, currentModel, maxTokens, useProxy, includeUsage)) {
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
                    } else {
                        // 使用原生 Google SDK
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
                        for await (const chunk of result.stream) {
                            const txt = chunk.text();
                            if (txt) {
                                chunkOutput += txt;
                                res.write(`data: ${JSON.stringify({ delta: txt })}\n\n`);
                            }
                        }
                        const aggregatedResponse = await result.response;
                        if (aggregatedResponse.usageMetadata) {
                            totalExactTokens += aggregatedResponse.usageMetadata.totalTokenCount || 0;
                        }
                        // Google SDK 截断检测（MAX_TOKENS）
                        const googleFinishReason = aggregatedResponse.candidates?.[0]?.finishReason;
                        let googleContinuations = 0;
                        let googleFinish: string | undefined = googleFinishReason as string | undefined;
                        while (googleFinish === 'MAX_TOKENS' && googleContinuations < 5) {
                            googleContinuations++;
                            console.log(`[CONTINUE] Chunk ${i + 1} truncated (MAX_TOKENS), continuation ${googleContinuations}/5`);
                            const plainTailG = chunkOutput.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(-600);
                            const htmlTailG = chunkOutput.slice(-200);
                            const continueG = `TRUNCATION CONTINUATION — DO NOT REPEAT\n\nYour previous HTML output was cut off. Last ~200 chars of raw HTML:\n\`\`\`\n${htmlTailG}\n\`\`\`\nLast ~600 chars plain text: "...${plainTailG}"\n\nRULES:\n1. Continue HTML from EXACTLY where cut — close any open tags first if needed.\n2. ABSOLUTELY DO NOT repeat any content already written.\n3. No prefix or preamble. Output ONLY continuation HTML.`;
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
                    }
                } finally {
                    clearInterval(pingInterval);
                }

                // Chunk 完成后处理（cleanOutput 和图片还原需要完整文本）
                let cleanChunk = cleanOutput(chunkOutput);
                // Truncate any hallucination loop that slipped through during main generation
                cleanChunk = truncateAtRepetitionLoop(cleanChunk);
                // Re-insert any __IMG_N__ placeholders the AI dropped (safety net)
                cleanChunk = reinjectMissingPlaceholders(chunkContent, cleanChunk);
                lastContext = cleanChunk.replace(/<[^>]+>/g, ' ');

                // Count only chapter-level H1s — exclude <h1 class="doc-title"> (document titles are not chapters)
                const h1Tags = cleanChunk.match(/<h1\b[^>]*>/gi) ?? [];
                const h1OpenInChunk = h1Tags.filter(t => !t.includes('doc-title')).length;
                cumulativeH1BeforePart += h1OpenInChunk;
                // Update cumulative per-level heading counter state
                const hcRegex = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
                let hcMatch: RegExpExecArray | null;
                while ((hcMatch = hcRegex.exec(cleanChunk)) !== null) {
                    const lvl = parseInt(hcMatch[1]);
                    if (hcMatch[2].includes('doc-title')) continue;
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

                // 还原图片
                if (imageCount > 0) {
                    cleanChunk = restoreImages(cleanChunk, imageMap);
                }

                fullRestoredText += cleanChunk;
                finalChunksUsed += 1;

                // 仅发送进度更新，前端此时已经通过流式渲染输出所有文字
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

        // 保存文档
        const pureText = fullRestoredText.replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim();
        await prisma.document.create({
            data: {
                userId: user.id,
                title: fileName.replace(/\.[^/.]+$/, "") || 'Untitled',
                content: fullRestoredText,
                preset: preset,
                wordCount: pureText.length
            }
        });

        // 估算 token 使用量(输入 + 输出) 当 API 未返回时备用
        // Gemini 计费: 约 1 token ~= 0.75 个中文字符
        let finalReportedTokens = totalExactTokens;
        if (finalReportedTokens === 0) {
            // Gemini with Chinese text: ~3 chars per token (vs GPT's ~0.75 for English)
            const inputTokens = Math.ceil(contentWithoutImages.length / 3);
            const outputTokens = Math.ceil(fullRestoredText.length / 3);
            finalReportedTokens = inputTokens + outputTokens;
            console.log(`[WARN] Using estimated tokens instead of API reported tokens.`);
        }

        // 记录使用日志
        await prisma.usageLog.create({
            data: {
                userId: user.id,
                actionType: 'generate_document',
                presetUsed: preset,
                tokenUsage: finalReportedTokens
            }
        });

        console.log(`[DONE] Document generated. Tokens: ${finalReportedTokens}`);

        // 发送完成事件
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();

    } catch (aiError: any) {
        console.error('AI API Error:', aiError);

        let errorMessage = 'AI service is temporarily unavailable. Please try again later.';
        // Clear, model-aware error messages (overrides legacy garbled messages below)
        const isApiKeyError = aiError.status === 401 || aiError.status === 403
            || String(aiError.message).includes('API key')
            || String(aiError.message).includes('Incorrect API key')
            || String(aiError.message).includes('invalid_api_key');
        if (isApiKeyError) {
            const label = requestedModelKey ?? 'AI';
            errorMessage = `[${label}] API Key invalid or not authorized. Please verify the key in backend .env`;
            if (!res.writableEnded) { res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`); res.end(); }
            return;
        } else if (String(aiError.message).includes('Connection') || String(aiError.message).includes('ECONNREFUSED') || String(aiError.message).includes('ETIMEDOUT')) {
            errorMessage = `Cannot reach ${requestedModelKey ?? 'AI'} API. Check network / proxy settings.`;
            if (!res.writableEnded) { res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`); res.end(); }
            return;
        }

        if (aiError.message?.includes('API key') || aiError.message?.includes('403')) {
            errorMessage = '[GEMINI] API Key 无效或未启用，请检查后端 .env 配置';
        } else if (aiError.message?.includes('token count') || aiError.message?.includes('limit')) {
            errorMessage = 'Document is too long or has too many images. Please reduce content size and retry.';
        } else if (aiError.message?.includes('400') || aiError.message?.includes('404')) {
            errorMessage = '当前区域暂不支持高级 AI 模型，请尝试开启全局代理或更换 API Key';
        } else {
            errorMessage += ` (Detailed Error: ${aiError.message?.substring(0, 100)}...)`;
        }

        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
            res.end();
        }
    } finally {
        if (generationSlotAcquired) {
            activeGenerations = Math.max(0, activeGenerations - 1);
        }
    }
});

export default router;




