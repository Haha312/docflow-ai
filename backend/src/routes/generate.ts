
import { Router, Response } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { AuthRequest, GenerateRequest, DocPreset, StyleConfig } from '../types';
import { successResponse, errorResponse } from '../utils/response';
import { authenticate } from '../middleware/auth';
import { checkRateLimit } from '../middleware/rateLimit';
import prisma from '../config/database';

const router = Router();

// Helper to generate instructions based on the numbering style
const getNumberingInstruction = (style: string): string => {
    switch (style) {
        case 'chinese-hierarchical':
            return `
        - **H1 (Section Level 1)**: MUST use Chinese numbers "一、", "二、", "三、"...
        - **H2 (Section Level 2)**: MUST use parenthesized Chinese numbers "(一)", "(二)"...
        - **H3 (Section Level 3)**: MUST use Arabic numbers "1.", "2."...
        - **H4 (Section Level 4)**: MUST use parenthesized Arabic numbers "(1)", "(2)"...
      `;
        case 'decimal-nested':
            return `
        - **H1**: "1.", "2."...
        - **H2**: "1.1", "1.2"...
        - **H3**: "1.1.1", "1.1.2"...
      `;
        case 'decimal':
            return `
        - **H1**: "1.", "2."...
        - **H2**: "2.1", "2.2"...
      `;
        case 'chapter':
            return `
        - **H1**: "第一章", "第二章"...
        - **H2**: "第一节", "第二节"...
        - **H3**: "一、", "二、"...
      `;
        default:
            return `- Use semantic HTML headings (h1-h6) based on the text's logical structure.`;
    }
};

const BASE_SYSTEM_PROMPTS: Record<DocPreset, string> = {
    [DocPreset.CORPORATE]: `
    Role: Document Formatter (Strict).
    Task: Apply formal Chinese Corporate Document structure (headings, numbering) to the text.
    CRITICAL: ZERO DATA LOSS. You MUST output EVERY sentence, paragraph, and table row from the input. NO OMMISSIONS allowed.
  `,
    [DocPreset.ACADEMIC]: `
    Role: Academic Formatter (Strict).
    Task: Apply Academic Paper structure to the text.
    CRITICAL: ZERO DATA LOSS. You MUST output EVERY sentence, paragraph, and table row from the input. NO OMMISSIONS allowed.
  `,
    [DocPreset.ACADEMIC_JOURNAL]: `
    Role: Journal Typesetter (Strict).
    Task: Apply rigorous "Chinese Journal of Computers" style.
    CRITICAL: ZERO DATA LOSS. Output EVERY sentence.
  `,
    [DocPreset.CREATIVE]: `
    Role: Book Typesetter.
    Task: Apply Narrative structure to the text.
    CRITICAL: ZERO DATA LOSS. You MUST output EVERY sentence, paragraph, and table row from the input. NO OMMISSIONS allowed.
  `,
    [DocPreset.MINIMALIST]: `
    Role: Technical Formatter.
    Task: Apply clean structure to the text.
    CRITICAL: ZERO DATA LOSS. You MUST output EVERY sentence, paragraph, and table row from the input. NO OMMISSIONS allowed.
  `
};

// Helper to clean Markdown code blocks from the output
const cleanOutput = (text: string): string => {
    return text.replace(/```html/g, '').replace(/```/g, '').trim();
};

// Helper to convert HTML string with base64 images into Gemini Parts (Vertex/New SDK style parts -> Generative AI SDK parts)
// The new SDK accepts: { inlineData: { mimeType, data } } or { text }
// This format is actually compatible with the new SDK too.
const htmlToParts = (html: string): any[] => {
    const parts: any[] = [];
    const imgRegex = /(<img\s+[^>]*src="data:image\/([^;]+);base64,([^"]+)"[^>]*>)/g;

    let lastIndex = 0;
    let match;

    while ((match = imgRegex.exec(html)) !== null) {
        const mimeType = match[2];
        const base64Data = match[3];

        const preText = html.substring(lastIndex, match.index);
        if (preText) parts.push({ text: preText });

        parts.push({
            inlineData: {
                mimeType: `image/${mimeType}`,
                data: base64Data
            }
        });

        parts.push({ text: "\n[The image above is likely a formula or figure. If it's a formula, transcribe it to LaTeX wrapped in $$. If it's a diagram, describe it.]\n" });

        lastIndex = imgRegex.lastIndex;
    }

    const remaining = html.substring(lastIndex);
    if (remaining) parts.push({ text: remaining });

    return parts.length > 0 ? parts : [{ text: html }];
};

// Tier Configuration
const TIER_LIMITS = {
    'FREE': 3,
    'PRO': 30,
    'PRO_PLUS': 100,
    'ULTRA': 300
};

// Using Standard Model Names for @google/generative-ai
const TIER_MODELS = {
    'FREE': 'gemini-1.5-flash',         // Safest default
    'PRO': 'gemini-2.0-flash-exp',
    'PRO_PLUS': 'gemini-2.0-flash-exp',
    'ULTRA': 'gemini-2.0-flash-exp'
};

/**
 * POST /api/generate
 * 文档生成接口 (需要认证和限流)
 */
router.post('/', authenticate, checkRateLimit, async (req: AuthRequest, res: Response): Promise<void> => {
    try {
        const user = req.user;
        if (!user) {
            res.status(401).json(errorResponse('未认证', 401));
            return;
        }

        const { content, preset, fileName, styleConfig }: GenerateRequest = req.body;

        // 验证输入
        if (!content || !preset || !fileName || !styleConfig) {
            res.status(400).json(errorResponse('缺少必要参数', 400));
            return;
        }

        // 检查 API Key
        const apiKey = process.env.GOOGLE_API_KEY;
        if (!apiKey) {
            res.status(500).json(errorResponse('服务器配置错误: 缺少 GOOGLE_API_KEY', 500));
            return;
        }

        // ===== NEW: Tier Usage Check =====
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

        const userTier = (user.subscriptionStatus as keyof typeof TIER_LIMITS) || 'FREE';
        const limit = TIER_LIMITS[userTier] || 10;

        if (usageCount >= limit) {
            res.status(403).json(errorResponse(`本月生成额度已用完 (${usageCount}/${limit})。请升级套餐以获取更多额度。`, 403));
            return;
        }

        // Determine Model
        const modelName = TIER_MODELS[userTier] || 'gemini-1.5-flash';

        // 构建系统指令
        let systemInstruction = BASE_SYSTEM_PROMPTS[preset];
        const numberingRules = getNumberingInstruction(styleConfig.headingNumbering);

        systemInstruction += `
      \nFormatting & Structural Analysis Rules:
      1. **DOCUMENT TITLE vs HEADINGS (CRITICAL)**:
         - Identify the **Document Title**. Wrap it in \`<h1 class="doc-title">\`. NO numbering.
         - Start numbering from the **first content section**.

      2. **IDENTIFY SECTIONS**: 
         - Analyze semantic structure. Tag <h1>, <h2>... <h6>.
      
      3. **APPLY NUMBERING SCHEME**: 
         - ${numberingRules}

      4. **Content Integrity (STRICT)**: 
         - **ZERO DATA LOSS**. Output every sentence, row, and list item.
         - **VERBATIM BODY TEXT**. Do not summarize.

      5. **MATH & FORMULAS (HIGHEST PRIORITY)**:
         - All mathematical formulas MUST be output as **LaTeX wrapped in $$**.
         - DO NOT use HTML <sub>, <sup>, or entities for math. Use LaTeX.

      6. **Output**: Return ONLY raw semantic HTML body content.
    `;

        // 初始化 Gemini AI (Standard SDK with Proxy Support)
        const httpProxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
        let genAI: GoogleGenerativeAI;

        if (httpProxy) {
            console.log(`Using Proxy: ${httpProxy}`);
            const dispatcher = new ProxyAgent(httpProxy);
            const customFetch = (url: any, init?: any) => {
                return undiciFetch(url, {
                    ...init,
                    dispatcher
                });
            };
            // @ts-ignore - customFetch is supported but typings might be strict
            genAI = new GoogleGenerativeAI(apiKey);
            // Note: Official SDK might not expose fetch override in constructor easily in v0.1
            // But checking latest docs, we can pass requestOptions in getGenerativeModel? No.
            // Wait, for Node environment, the SDK uses `fetch` globally if available.
            // We can overwrite global.fetch or pass it if the SDK allows.
            // Actually, the new SDK allows setting a custom fetch implementation via RequestOptions? No.

            // Hack/Workaround for Node: Overwrite global fetch if we really need proxy 
            // But that affects everything.
            // Better Check: Does `GoogleGenerativeAI` constructor options support `fetch`?
            // current typings: constructor(apiKey: string)

            // Let's try the `global.fetch` patch method locally for this scope if possible, 
            // OR use `undici` global dispatcher.

            // Preferred: Use the SDK's RequestOptions if available. 
            // Since I am already using `model.generateContentStream`, let's see if 
            // `getGenerativeModel` supports `requestOptions`.
            // definition: getGenerativeModel(modelParams: ModelParams, requestOptions?: RequestOptions): GenerativeModel
            // RequestOptions = { timeout?: number; apiVersion?: string; ... customHeaders? }
            // No fetch override.

            // So we MUST patch global fetch or set global dispatcher.
            // Ideally, set global dispatcher for undici if node 18+ uses undici internally.

            // Let's try patching global.fetch for this scope effectively or globally.
            // @ts-ignore
            global.fetch = customFetch as any;
            genAI = new GoogleGenerativeAI(apiKey);
        } else {
            genAI = new GoogleGenerativeAI(apiKey);
        }

        const contentParts = htmlToParts(content);

        // 设置 SSE 响应头
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        let fullText = '';
        let hasError = false;

        try {
            // Fallback Strategy: Try models in order until one works
            const candidateModels = [
                'gemini-3-pro-preview'             // Legacy
            ];
            // const candidateModels = [
            //     modelName,               // Custom per tier
            //     'gemini-2.0-flash-exp',  // Latest Preview
            //     'gemini-1.5-pro',        // Standard High Quality
            //     'gemini-1.5-flash',      // Standard Fast
            //     'gemini-1.5-pro-latest', // Alias
            //     'gemini-pro'             // Legacy
            // ];

            // Remove duplicates
            const uniqueModels = [...new Set(candidateModels)];

            let lastError: any = null;
            let success = false;

            for (const currentModel of uniqueModels) {
                try {
                    console.log(`Attempting to generate with model: ${currentModel}`);

                    // Standard SDK Usage
                    const model = genAI.getGenerativeModel({
                        model: currentModel,
                        systemInstruction: systemInstruction
                    });

                    // Streaming Call (SDK format: .stream)
                    const result = await model.generateContentStream([
                        `Filename: ${fileName}\n\nContent to reformat:\n`,
                        ...contentParts
                    ]);

                    for await (const chunk of result.stream) {
                        const chunkText = chunk.text(); // .text() is a function in this SDK
                        if (chunkText) {
                            fullText += chunkText;
                            res.write(`data: ${JSON.stringify({ text: cleanOutput(fullText) })}\n\n`);
                        }
                    }

                    success = true;
                    console.log(`✅ Success with model: ${currentModel}`);
                    break; // Stop if successful

                } catch (err: any) {
                    console.warn(`⚠️ Failed with model ${currentModel}: ${err.message?.split('\n')[0]}`);
                    lastError = err;

                    // IF error is NOT a 404/Not Found, might be a real issue (like rate limit), so maybe don't loop?
                    if (err.message?.includes('API key') || err.message?.includes('403')) {
                        throw err;
                    }
                    // For other errors (404, 503, Overloaded), continue to next model
                }
            }

            if (!success) {
                throw lastError;
            }

            // 记录使用日志
            await prisma.usageLog.create({
                data: {
                    userId: user.id,
                    actionType: 'generate_document',
                    presetUsed: preset
                }
            });

            // 保存生成的文档到数据库
            const cleanContent = cleanOutput(fullText);
            await prisma.document.create({
                data: {
                    userId: user.id,
                    title: fileName.replace(/\.[^/.]+$/, "") || 'Untitled', // 去掉扩展名
                    content: cleanContent,
                    preset: preset,
                    wordCount: cleanContent.length // 简单估算
                }
            });

            // 发送完成事件
            res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
            res.end();

        } catch (aiError: any) {
            hasError = true;
            console.error('Gemini API Error:', aiError);
            console.error('DEBUG: API Key configured:', !!apiKey, 'Length:', apiKey?.length, 'Ends with:', apiKey?.slice(-4));

            let errorMessage = 'AI 服务暂时不可用,请稍后重试';

            if (aiError.message?.includes('API key') || aiError.message?.includes('403')) {
                errorMessage = 'API Key 无效或未启用，请检查后端 .env 配置';
            } else if (aiError.message?.includes('token count') || aiError.message?.includes('limit')) {
                errorMessage = '文档内容过长或图片过多，请尝试删除大型装饰性图片';
            } else if (aiError.message?.includes('400') || aiError.message?.includes('404')) {
                errorMessage = '当前区域暂不支持高级 AI 模型，请尝试开启全局代理或更换 API Key';
            } else {
                errorMessage += ` (Detailed Error: ${aiError.message?.substring(0, 100)}...)`;
            }

            res.write(`data: ${JSON.stringify({ error: errorMessage })}\n\n`);
            res.end();
        }

    } catch (error) {
        console.error('Generate error:', error);
        res.status(500).json(errorResponse('文档生成失败', 500));
    }
});

export default router;
