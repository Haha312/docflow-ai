
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


// Helper to clean Markdown code blocks from the output
const cleanOutput = (text: string): string => {
    return text.replace(/```html/g, '').replace(/```/g, '').trim();
};



import { TIER_LIMITS } from '../config/tierConfig';
import { splitContentBySemantics } from '../utils/chunking';

const PRIMARY_MODEL = process.env.GEMINI_MODEL || 'gemini-3-pro-preview';
const MAX_CONCURRENT_GENERATIONS = Math.max(1, Number(process.env.MAX_CONCURRENT_GENERATIONS || 50));

interface ModelConfig { apiKey: string; baseUrl: string; modelId: string; needsProxy?: boolean; maxOutputTokens?: number; }

function getModelConfig(modelKey: string, dbConfig: Record<string, string>): ModelConfig | null {
    const geminiKey  = dbConfig['GOOGLE_API_KEY']        || process.env.GOOGLE_API_KEY        || '';
    const geminiBase = dbConfig['GEMINI_OPENAI_BASE_URL'] || process.env.GEMINI_OPENAI_BASE_URL || '';
    const registry: Record<string, ModelConfig> = {
        'gemini-flash': { apiKey: geminiKey,  baseUrl: geminiBase, modelId: 'gemini-2.0-flash',                          needsProxy: true,  maxOutputTokens: 16000 },
        'gemini-pro':   { apiKey: geminiKey,  baseUrl: geminiBase, modelId: process.env.GEMINI_MODEL || 'gemini-3-pro-preview', needsProxy: true,  maxOutputTokens: 32000 },
        'doubao':       { apiKey: process.env.DOUBAO_API_KEY   || '', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',        modelId: process.env.DOUBAO_ENDPOINT_ID || '', needsProxy: false, maxOutputTokens: 4096 },
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
): AsyncGenerator<{ content: string; usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } }> {
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

            yield {
                content,
                usage: usage ? {
                    prompt_tokens: usage.prompt_tokens,
                    completion_tokens: usage.completion_tokens,
                    total_tokens: usage.total_tokens
                } : undefined
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

        // Usage Check
        let usageCount = 0;

        if (userTier === 'FREE') {
            usageCount = await prisma.usageLog.count({
                where: {
                    userId: user.id,
                    actionType: 'generate_document'
                }
            });
        } else {
            const currentMonthStart = new Date();
            currentMonthStart.setDate(1);
            currentMonthStart.setHours(0, 0, 0, 0);

            usageCount = await prisma.usageLog.count({
                where: {
                    userId: user.id,
                    actionType: 'generate_document',
                    createdAt: {
                        gte: currentMonthStart
                    }
                }
            });
        }

        const limit = TIER_LIMITS[userTier] || 10;

        if (usageCount >= limit) {
            const extraMsg = userTier === 'FREE' ? 'Free quota exhausted' : 'Monthly quota exhausted';
            res.status(403).json(errorResponse(`${extraMsg} (${usageCount}/${limit})`, 403));
            return;
        }

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
         - **LISTS (CRITICAL)**:
             - ONLY convert to a list if the source text EXPLICITLY has list markers ("1.", "1)", "(1)", "-", "•") on CONSECUTIVE lines (2+ items in a row).
             - A single sentence that happens to start with "1." is NOT a list — keep it as a paragraph.
             - FORBIDDEN: Adding list numbers (1. 2. 3.) to normal body paragraphs that are NOT lists in the source.
             - FORBIDDEN: Converting regular paragraphs or steps described in prose into numbered lists.
             - FORBIDDEN: Outputting multiple items with the same number "1." in a row.
             - If you see "1. Item... 1. Item..." in an actual list, FIX it to "1. Item... 2. Item...".
             - PRESERVE the source structure: if the source uses prose paragraphs, keep them as paragraphs.
         - Use standard HTML list tags (\`<ul>\`, \`<ol>\`, \`<li>\`) only for genuine lists.

      4. **Content Integrity (STRICT)**:
         - **ZERO DATA LOSS**. Output every sentence, row, and list item.
         - **VERBATIM BODY TEXT**. Do not summarize.
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
          - **VARIABLE DEFINITION LISTS (CRITICAL)**:
             - When the source text has patterns like "vx, vy: meaning" or "x, y—meaning" or "a0 constant term", treat these as **definition items**, NOT standalone list items.
             - NEVER convert variable names (latin letters, subscripts) into Chinese punctuation or other characters.
             - Keep the original variable identifiers (e.g. $v_x$, $v_y$) in their LaTeX form.
             - Format each variable definition as: \`<p>$v_x$, $v_y$: meaning</p>\`
             - Do NOT turn "vx, vy:" into bullet points.

       6. **IMAGES & FIGURES (CRITICAL)**:
         - **MANDATORY**: Generate a FIGURE CAPTION for EVERY image based on context.
         - Position: **IMMEDIATELY BELOW** the image.
         - Format: \`<div class="figure-caption">图{N} {Description}</div>\`
         - Example:
           \`__IMG_0__\`
           \`<div class="figure-caption">图1 系统架构示意图</div>\`

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


        // 1. 提取图片 (全局处理)
        const { textOnly: contentWithoutImages, imageMap } = extractImagesAsPlaceholders(content);
        const imageCount = Object.keys(imageMap).length;
        if (imageCount > 0) console.log(`[IMG] Extracted ${imageCount} images`);

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

        // 按模型输出 token 上限动态调整输入 chunk 大小，防止输出被截断
        const chunkMaxChars: Record<string, number> = {
            'gemini-flash': 12000,
            'gemini-pro':   16000,
            'doubao':        3500,
            'deepseek':      7000,
            'qwen-max':      7000,
        };
        const safeChunkSize = (requestedModelKey && chunkMaxChars[requestedModelKey]) || 12000;

        let chunks: string[] = [];
        if (userTier === 'ULTRA') {
            console.log('[ULTRA] Mode: Single-pass full document processing');
            chunks = [contentWithoutImages];
        } else {
            chunks = splitContentBySemantics(contentWithoutImages, safeChunkSize);
        }
        console.log(`[SPLIT] Document split into ${chunks.length} chunk(s)`);

        let lastContext = '';

        // 设置 SSE 响应头
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // 如果有图片，将图片映射字典发给前端，让前端实时流式渲染时可以替换回真实的 img 标签
        if (imageCount > 0) {
            res.write(`data: ${JSON.stringify({ imageMap })}\n\n`);
        }

        let totalExactTokens = 0;

        // 3. 循环处理 Chunks
        for (let i = 0; i < chunks.length; i++) {
            const chunkContent = chunks[i];
            console.log(`[CHUNK] Processing ${i + 1}/${chunks.length} (${chunkContent.length} chars) Model: ${currentModel}`);

            // 动态构建 System Prompt
            let currentSystemPrompt = systemInstruction;

            if (i > 0) {
                currentSystemPrompt += `

                --- CONTINUATION MODE ACTIVATED ---
                You are processing **PART ${i + 1} of ${chunks.length}** of a long document.

                **PREVIOUS CONTEXT (ReadOnly)**:
                "...${lastContext.slice(-800)}"

                **CRITICAL INSTRUCTIONS**:
                1. **CONTINUITY**: Do NOT assume this is the start of a document (unless it looks like a new H1).
                2. **NUMBERING**: Look at the "PREVIOUS CONTEXT". If it ended with Section 2.1, you MUST start with 2.2 (or 2.1.1).
                3. **NO REPETITION**: Do NOT repeat the "PREVIOUS CONTEXT". Start formatting EXACTLY from the provided user input.
                `;
            } else {
                currentSystemPrompt += `\n\n**MODE**: PART 1 (Start of Document). Start numbering from the beginning.`;
            }

            const userContent = `Filename: ${safeFileName}\n\nContent Part ${i + 1}:\n${chunkContent}`;
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
                        for await (const result of callOpenAICompatible(useKey, useBase, currentSystemPrompt, userContent, currentModel, maxTokens, useProxy, includeUsage)) {
                            if (result.content) {
                                chunkOutput += result.content;
                                // 真实流式输出：直接把 delta 推给前端
                                res.write(`data: ${JSON.stringify({ delta: result.content })}\n\n`);
                            }
                            if (result.usage) {
                                totalExactTokens += result.usage.total_tokens || 0;
                            }
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
                                // 真实流式输出：直接把 delta 推给前端
                                res.write(`data: ${JSON.stringify({ delta: txt })}\n\n`);
                            }
                        }
                        // 流结束后，从聚合响应中提取精确的 token 用量
                        const aggregatedResponse = await result.response;
                        if (aggregatedResponse.usageMetadata) {
                            totalExactTokens += aggregatedResponse.usageMetadata.totalTokenCount || 0;
                        }
                    }
                } finally {
                    clearInterval(pingInterval);
                }

                // Chunk 完成后处理（cleanOutput 和图片还原需要完整文本）
                let cleanChunk = cleanOutput(chunkOutput);
                lastContext = cleanChunk.replace(/<[^>]+>/g, ' ');

                // 还原图片
                if (imageCount > 0) {
                    cleanChunk = restoreImages(cleanChunk, imageMap);
                }

                fullRestoredText += cleanChunk;

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




