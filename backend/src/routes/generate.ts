
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

// ===== 图片占位符处理 =====
// 提取图片并替换为占位符,返回纯文本和图片映射表
interface ImageMap {
    [placeholder: string]: string; // placeholder -> original img tag
}

const extractImagesAsPlaceholders = (html: string): { textOnly: string; imageMap: ImageMap } => {
    const imageMap: ImageMap = {};
    // 支持单引号和双引号的 src
    const imgRegex = /<img\s+[^>]*src=["'][^"']*["'][^>]*>/gi;
    let index = 0;

    const textOnly = html.replace(imgRegex, (match) => {
        // 使用更明显的占位符,防止 AI 误修改
        const placeholder = `__IMG_${index}__`;
        imageMap[placeholder] = match;
        index++;
        return placeholder;
    });

    return { textOnly, imageMap };
};

// 将占位符还原为原始图片标签
const restoreImages = (text: string, imageMap: ImageMap): string => {
    let result = text;
    for (const [placeholder, imgTag] of Object.entries(imageMap)) {
        // 全局替换
        result = result.split(placeholder).join(imgTag);
    }
    return result;
};

// Helper to convert text to parts for Gemini (仅用于 Gemini API)
const htmlToParts = (html: string): any[] => {
    // 不再发送图片给 AI,只发送文本
    return [{ text: html }];
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

// 豆包模型配置 (用于 FREE 和 PRO 用户) - 使用256k版本支持超长文档
const DOUBAO_MODELS = {
    'FREE': 'doubao-seed-1-6-251015',           // Seed 1.6 256k 版本
    'PRO': 'doubao-seed-1-6-251015',            // Seed 1.6 256k 版本
};

// 豆包 API 配置
const DOUBAO_API_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

// 使用豆包API的用户等级
const USE_DOUBAO_TIERS = ['FREE', 'PRO'];

// 豆包 API 流式调用函数
async function* callDoubaoAPI(
    apiKey: string,
    endpointId: string,
    systemPrompt: string,
    userContent: string,
    modelName: string
): AsyncGenerator<string> {
    const response = await fetch(DOUBAO_API_ENDPOINT, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: endpointId || modelName,  // 优先使用 endpoint ID
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
            ],
            stream: true,
            temperature: 0.7,
            max_tokens: 16000
        })
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`豆包 API 错误 (${response.status}): ${errorText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('无法读取豆包 API 响应流');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;

            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') continue;

            try {
                const json = JSON.parse(data);
                const content = json.choices?.[0]?.delta?.content;
                if (content) {
                    yield content;
                }
            } catch (e) {
                // 忽略解析错误
            }
        }
    }
}

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

        // 获取用户等级
        const userTier = (user.subscriptionStatus as keyof typeof TIER_LIMITS) || 'FREE';

        // 检查 API Key (根据用户等级检查对应的 API Key)
        const useDoubao = USE_DOUBAO_TIERS.includes(userTier);
        const doubaoApiKey = process.env.DOUBAO_API_KEY;
        const doubaoEndpointId = process.env.DOUBAO_ENDPOINT_ID;
        const geminiApiKey = process.env.GOOGLE_API_KEY;

        if (useDoubao) {
            if (!doubaoApiKey) {
                res.status(500).json(errorResponse('服务器配置错误: 缺少 DOUBAO_API_KEY', 500));
                return;
            }
        } else {
            if (!geminiApiKey) {
                res.status(500).json(errorResponse('服务器配置错误: 缺少 GOOGLE_API_KEY', 500));
                return;
            }
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

        // userTier 已在上面声明
        const limit = TIER_LIMITS[userTier] || 10;

        if (usageCount >= limit) {
            res.status(403).json(errorResponse(`本月生成额度已用完 (${usageCount}/${limit})。请升级套餐以获取更多额度。`, 403));
            return;
        }

        // Determine Model based on tier and provider
        const doubaoModelName = DOUBAO_MODELS[userTier as keyof typeof DOUBAO_MODELS] || 'doubao-1-5-lite-32k-250115';
        const geminiModelName = TIER_MODELS[userTier] || 'gemini-1.5-flash';

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

      4. **Content Integrity (STRICT)**: 
         - **ZERO DATA LOSS**. Output every sentence, row, and list item.
         - **VERBATIM BODY TEXT**. Do not summarize.
         - **PRESERVE IMAGES**. You will see placeholders like "__IMG_0__". You MUST keep them exactly as is, in their original relative position. DO NOT remove or modify them.

      5. **MATH & FORMULAS (HIGHEST PRIORITY)**:
         - All mathematical formulas MUST be output as **LaTeX wrapped in $$**.
         - DO NOT use HTML <sub>, <sup>, or entities for math. Use LaTeX.

      6. **IMAGES & FIGURES (CRITICAL)**:
         - Keep all __IMG_N__ markers exactly as they appear.
         - Figure captions (图注) MUST be placed AFTER the image placeholder.
         - Format: __IMG_0__ followed by <p>图 1 xxxx</p>

      7. **TABLES (CRITICAL)**:
         - Table titles (表题) MUST be placed BEFORE the table.
         - Format: <div class="table-caption">表 1 xxxx</div>
         - Use standard HTML <table> structure.

      8. **FIGURE CAPTIONS**:
         - Place captions BELOW images.
         - Format: <div class="figure-caption">图 1 xxxx</div>

      9. **TOC HANDLING**:
         - Do NOT output the actual TOC items - the system will generate Word native TOC.

      10. **Output**: Return ONLY raw semantic HTML body content.
    `;

        const systemInstruction = BASE_SYSTEM_PROMPTS[preset] + BASE_SHARED_PROMPT;

        // 设置 SSE 响应头
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        let fullText = '';

        try {
            // ===== 图片占位符处理 =====
            const { textOnly: contentWithoutImages, imageMap } = extractImagesAsPlaceholders(content);
            const imageCount = Object.keys(imageMap).length;
            if (imageCount > 0) {
                console.log(`📷 Extracted ${imageCount} images as placeholders`);
            }

            // ===== 根据用户等级选择 API =====
            if (useDoubao) {
                // 使用豆包 API (FREE 和 PRO 用户)
                console.log(`🤖 Using Doubao API for ${userTier} user, model: ${doubaoModelName}`);

                const userContent = `Filename: ${fileName}\n\nContent to reformat:\n${contentWithoutImages}`;

                try {
                    for await (const chunk of callDoubaoAPI(
                        doubaoApiKey!,
                        doubaoEndpointId || doubaoModelName,
                        systemInstruction,
                        userContent,
                        doubaoModelName
                    )) {
                        fullText += chunk;
                        res.write(`data: ${JSON.stringify({ text: cleanOutput(fullText) })}\n\n`);
                    }
                    console.log(`✅ Doubao API generation successful`);
                } catch (doubaoError: any) {
                    console.error('❌ Doubao API Error:', doubaoError.message);
                    throw doubaoError;
                }
            } else {
                // 使用 Gemini API (PRO_PLUS 和 ULTRA 用户)
                console.log(`🤖 Using Gemini API for ${userTier} user, model: ${geminiModelName}`);

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
                    // @ts-ignore
                    global.fetch = customFetch as any;
                    genAI = new GoogleGenerativeAI(geminiApiKey!);
                } else {
                    genAI = new GoogleGenerativeAI(geminiApiKey!);
                }

                const contentParts = htmlToParts(contentWithoutImages);

                // Fallback Strategy: Try models in order until one works
                const candidateModels = [
                    geminiModelName,
                    'gemini-2.0-flash-exp',
                    'gemini-1.5-flash'
                ];

                const uniqueModels = Array.from(new Set(candidateModels));
                let lastError: any = null;
                let success = false;

                for (const currentModel of uniqueModels) {
                    try {
                        console.log(`Attempting to generate with model: ${currentModel}`);

                        const model = genAI.getGenerativeModel({
                            model: currentModel,
                            systemInstruction: systemInstruction
                        });

                        const result = await model.generateContentStream([
                            `Filename: ${fileName}\n\nContent to reformat:\n`,
                            ...contentParts
                        ]);

                        for await (const chunk of result.stream) {
                            const chunkText = chunk.text();
                            if (chunkText) {
                                fullText += chunkText;
                                res.write(`data: ${JSON.stringify({ text: cleanOutput(fullText) })}\n\n`);
                            }
                        }

                        success = true;
                        console.log(`✅ Success with Gemini model: ${currentModel}`);
                        break;

                    } catch (err: any) {
                        console.warn(`⚠️ Failed with model ${currentModel}: ${err.message?.split('\n')[0]}`);
                        lastError = err;

                        if (err.message?.includes('API key') || err.message?.includes('403')) {
                            throw err;
                        }
                    }
                }

                if (!success) {
                    throw lastError;
                }
            }

            // 记录使用日志
            await prisma.usageLog.create({
                data: {
                    userId: user.id,
                    actionType: 'generate_document',
                    presetUsed: preset
                }
            });

            // ===== 还原图片 =====
            let cleanContent = cleanOutput(fullText);
            if (imageCount > 0) {
                cleanContent = restoreImages(cleanContent, imageMap);
                console.log(`📷 Restored ${imageCount} images in output`);
            }

            // 发送最终结果(含图片)
            res.write(`data: ${JSON.stringify({ text: cleanContent })}\n\n`);

            // 保存生成的文档到数据库
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
            console.error('AI API Error:', aiError);
            console.error('DEBUG: useDoubao:', useDoubao, 'doubaoApiKey:', !!doubaoApiKey, 'geminiApiKey:', !!geminiApiKey);

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
