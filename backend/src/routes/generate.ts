
import { Router, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { AuthRequest, GenerateRequest, DocPreset, StyleConfig } from '../types';
import { successResponse, errorResponse } from '../utils/response';
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



// Tier Configuration - 简化版会员体系
const TIER_LIMITS = {
    'FREE': 3,      // 3次/日
    'PRO': 50,      // 50次/月
    'TEAM': 500     // 500次/月
};

// 统一使用 Gemini 3 Pro Preview 模型
const TIER_MODELS = {
    'FREE': 'gemini-3-pro-preview',
    'PRO': 'gemini-3-pro-preview',
    'TEAM': 'gemini-3-pro-preview'
};

// OpenAI Compatible 使用的模型（通过代理访问 Gemini）
const OPENAI_COMPATIBLE_MODELS = {
    'FREE': 'gemini-3-pro-preview',
    'PRO': 'gemini-3-pro-preview',
    'TEAM': 'gemini-3-pro-preview'
};

// OpenAI Compatible API Call (for Gemini via proxy)
async function* callOpenAICompatible(
    apiKey: string,
    baseUrl: string,
    systemPrompt: string,
    userContent: string,
    modelName: string,
    maxTokens?: number
): AsyncGenerator<string> {
    console.log('DEBUG: callOpenAICompatible start', { baseUrl, modelName, apiKeyLength: apiKey?.length, maxTokens });

    try {
        const client = new OpenAI({
            apiKey: apiKey,
            baseURL: baseUrl
        });

        const stream = await client.chat.completions.create({
            model: modelName,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
            ],
            stream: true,
            temperature: 0.7,
            max_tokens: maxTokens
        });

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content || '';
            if (content) yield content;
        }
    } catch (err: any) {
        console.error('❌ callOpenAICompatible Error:', err);
        if (err.response) {
            console.error('❌ status:', err.status);
            console.error('❌ data:', err.response.data);
        }
        throw new Error(`OpenAI Compatible Error: ${err.message}`);
    }
}

/**
 * POST /api/generate
 * 文档生成接口 (需要认证和限流)
 * 统一使用 Gemini API
 */
router.post('/', authenticate, checkRateLimit, async (req: AuthRequest, res: Response): Promise<void> => {
    let geminiApiKey: string | undefined;
    let fullRestoredText = '';

    try {
        const user = req.user;
        if (!user) {
            res.status(401).json(errorResponse('未认证', 401));
            return;
        }

        // 0. Fetch Dynamic System Config
        let dbConfig: Record<string, string> = {};
        try {
            const configs = await (prisma as any).systemConfig.findMany();
            dbConfig = configs.reduce((acc: any, curr: any) => ({ ...acc, [curr.key]: curr.value }), {});
        } catch (err) {
            // SystemConfig table might not exist
        }

        const { content, preset, fileName, styleConfig }: GenerateRequest = req.body;

        if (!content || !preset || !fileName || !styleConfig) {
            res.status(400).json(errorResponse('缺少必要参数', 400));
            return;
        }

        // 获取用户等级与配置
        const userTier = (user.subscriptionStatus as keyof typeof TIER_LIMITS) || 'FREE';

        geminiApiKey = dbConfig['GOOGLE_API_KEY'] || process.env.GOOGLE_API_KEY;

        if (!geminiApiKey) {
            res.status(500).json(errorResponse('Server Config Error: Missing GOOGLE_API_KEY', 500));
            return;
        }

        // Usage Check
        const currentMonthStart = new Date();
        currentMonthStart.setDate(1);
        currentMonthStart.setHours(0, 0, 0, 0);

        const usageCount = await prisma.usageLog.count({
            where: {
                userId: user.id,
                actionType: 'generate_document',
                createdAt: {
                    gte: currentMonthStart
                }
            }
        });

        const limit = TIER_LIMITS[userTier] || 10;

        if (usageCount >= limit) {
            res.status(403).json(errorResponse(`本月生成额度已用完 (${usageCount}/${limit})。请升级套餐以获取更多额度。`, 403));
            return;
        }

        // Determine Model based on tier
        const geminiModelName = TIER_MODELS[userTier] || 'gemini-1.5-flash';
        const openAIModelName = OPENAI_COMPATIBLE_MODELS[userTier] || 'gemini-1.5-flash';

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
         - **LISTS (CRITICAL)**: If the source text contains items starting with "1.", "1)", "(1)", you MUST respect the list structure.
         - **SEQUENTIAL NUMBERING (CRITICAL)**: 
             - You MUST check your output for lists. 
             - If you see "1. Item... 1. Item...", you MUST FIX it to "1. Item... 2. Item...".
             - ENSURE loose lists are consolidated into a single ordered list.
             - FORBIDDEN: Outputting multiple items with the same number "1." in a row.
         - Use standard Markdown list syntax.

      4. **Content Integrity (STRICT)**: 
         - **ZERO DATA LOSS**. Output every sentence, row, and list item.
         - **VERBATIM BODY TEXT**. Do not summarize.
         - **PRESERVE IMAGES (HIGHEST PRIORITY)**: 
            - You will see placeholders like \`__IMG_0__\`.
            - You MUST output them **EXACTLY** as is.
            - DO NOT put them inside headers (h1-h6).
            - DO NOT rename them (e.g. to \`__IMG_1__\` if it was \`__IMG_0__\`).
            - DO NOT delete them. If input has 5 images, output MUST have 5 images.

       5. **MATH & FORMULAS (HIGHEST PRIORITY)**:
          - Use **LaTeX** for ALL mathematical expressions (e.g. variables \`$x$\`, equations).
          - DELIMITERS:
             - Use \`$$\` for Display/Block Math (e.g. \`$$ E=mc^2 $$\`).
             - Use \`$\` for Inline Math (e.g. \`$(x, y)$\`).
          - **STRICT ACCURACY**:
             - Do NOT change variable names (e.g. \`a_0\` must remain \`a_0\`).
             - Do NOT simplify or solve equations.
             - Reproduce the exact notation from the source text.

      6. **IMAGES & FIGURES (CRITICAL)**:
         - **MANDATORY**: Generate a FIGURE CAPTION for EVERY image based on context.
         - Position: **IMMEDIATELY BELOW** the image.
         - Format: \`<div class="figure-caption">图 {N} {Description}</div>\`
         - Example: 
           \`__IMG_0__\`
           \`<div class="figure-caption">图 1 系统架构示意图</div>\`

      7. **TABLES (CRITICAL)**:
         - **MANDATORY**: Generate a TABLE TITLE for EVERY table.
         - Position: **IMMEDIATELY ABOVE** the table.
         - Format: \`<div class="table-caption">表 {N} {Description}</div>\`
         - Example: \`<div class="table-caption">表 1 价格方案对比</div>\n<table>...</table>\`

      8. **CAPTION STYLE**:
         - Use generic counters (图 1, 图 2... 表 1, 表 2...) unless specific numbering is required.
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
            - Example: In Chapter 1, use "图 1-1", "图 1-2". In Chapter 2, use "图 2-1".
            - Format: \`<div class="figure-caption">图 {Chapter}-{Sequence} {Description}</div>\`
            `;
        } else {
            figureInstruction = `
          - **FIGURE CAPTIONS (SEQUENTIAL)**:
            - Use continuous numbering across the document "图[Sequence]".
            - Format: \`<div class="figure-caption">图 {Sequence} {Description}</div>\`
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
            - Example: "表 1-1", "表 2-1".
            - Format: \`<div class="table-caption">表 {Chapter}-{Sequence} {Description}</div>\`
            `;
        } else {
            tableInstruction = `
          - **TABLE CAPTIONS (SEQUENTIAL)**:
            - Use continuous numbering across the document.
            - Format: \`<div class="table-caption">表 {Sequence} {Description}</div>\`
            `;
        }

        const systemInstruction = BASE_SYSTEM_PROMPTS[preset] + `
      
      ${BASE_SHARED_PROMPT}

      *** DYNAMIC NUMBERING RULES (OVERRIDE DEFAULTS) ***
      ${figureInstruction}
      ${tableInstruction}
        `;

        const { splitContentBySemantics } = require('../utils/chunking');

        // 1. 提取图片 (全局处理)
        const { textOnly: contentWithoutImages, imageMap } = extractImagesAsPlaceholders(content);
        const imageCount = Object.keys(imageMap).length;
        if (imageCount > 0) console.log(`📷 Extracted ${imageCount} images`);

        // 2. 语义切分 (TEAM 用户跳过，直接单次处理)
        let chunks: string[] = [];
        if (userTier === 'TEAM') {
            console.log('🚀 TEAM Mode: Skipping chunking for Gemini 3 Pro (Single Pass)');
            chunks = [contentWithoutImages];
        } else {
            chunks = splitContentBySemantics(contentWithoutImages);
        }
        console.log(`🧩 Document split into ${chunks.length} smart chunks`);

        let lastContext = '';

        // 设置 SSE 响应头
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        // 3. 循环处理 Chunks
        for (let i = 0; i < chunks.length; i++) {
            const chunkContent = chunks[i];
            console.log(`Processing Chunk ${i + 1}/${chunks.length} (${chunkContent.length} chars)...`);

            // 动态构建 System Prompt
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

            const userContent = `Filename: ${fileName}\n\nContent Part ${i + 1}:\n${chunkContent}`;
            let chunkOutput = '';

            try {
                // 检查是否使用 OpenAI Compatible 代理
                const geminiOpenAIBaseUrl = dbConfig['GEMINI_OPENAI_BASE_URL'] || process.env.GEMINI_OPENAI_BASE_URL;

                if (geminiOpenAIBaseUrl) {
                    // 使用 OpenAI Compatible Endpoint (如 hiapi.online)
                    const maxTokens = userTier === 'TEAM' ? 32000 : 16000;
                    for await (const delta of callOpenAICompatible(geminiApiKey!, geminiOpenAIBaseUrl, currentSystemPrompt, userContent, openAIModelName, maxTokens)) {
                        chunkOutput += delta;
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
                        {
                            model: geminiModelName,
                            systemInstruction: currentSystemPrompt
                        },
                        { customFetch } as any
                    );
                    const result = await model.generateContentStream([userContent]);
                    for await (const chunk of result.stream) {
                        const txt = chunk.text();
                        if (txt) chunkOutput += txt;
                    }
                }

                // Chunk 完成处理
                let cleanChunk = cleanOutput(chunkOutput);
                lastContext = cleanChunk.replace(/<[^>]+>/g, ' ');

                // 还原图片
                if (imageCount > 0) {
                    cleanChunk = restoreImages(cleanChunk, imageMap);
                }

                fullRestoredText += cleanChunk;

                // 发送进度
                res.write(`data: ${JSON.stringify({
                    delta: cleanChunk,
                    progress: {
                        current: i + 1,
                        total: chunks.length,
                        status: `正在生成第 ${i + 1}/${chunks.length} 部分...`,
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

        // 估算 token 使用量 (输入 + 输出)
        // Gemini 计费: 约 1 token ≈ 0.75 个中文字符
        const inputTokens = Math.ceil(contentWithoutImages.length / 0.75);
        const outputTokens = Math.ceil(fullRestoredText.length / 0.75);
        const totalTokens = inputTokens + outputTokens;

        // 记录使用日志
        await prisma.usageLog.create({
            data: {
                userId: user.id,
                actionType: 'generate_document',
                presetUsed: preset,
                tokenUsage: totalTokens
            }
        });

        console.log(`✅ Document generated. Tokens: ${totalTokens} (input: ${inputTokens}, output: ${outputTokens})`);

        // 发送完成事件
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();

    } catch (aiError: any) {
        console.error('AI API Error:', aiError);

        let errorMessage = 'AI 服务暂时不可用,请稍后重试';

        if (aiError.message?.includes('API key') || aiError.message?.includes('403')) {
            errorMessage = '[GEMINI] API Key 无效或未启用，请检查后端 .env 配置';
        } else if (aiError.message?.includes('token count') || aiError.message?.includes('limit')) {
            errorMessage = '文档内容过长或图片过多，请尝试删除大型装饰性图片';
        } else if (aiError.message?.includes('400') || aiError.message?.includes('404')) {
            errorMessage = '当前区域暂不支持高级 AI 模型，请尝试开启全局代理或更换 API Key';
        } else {
            errorMessage += ` (Detailed Error: ${aiError.message?.substring(0, 100)}...)`;
        }

        if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
            res.end();
        }
    }
});

export default router;
