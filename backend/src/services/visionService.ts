import OpenAI from 'openai';

interface VisionImageInput {
    name: string;
    mimeType: string;
    dataUrl: string;
}

const env = (...names: string[]): string | undefined => names.map((name) => process.env[name]).find(Boolean);

const getVisionConfig = () => ({
    apiKey: env('VISION_API_KEY', 'DOUBAO_API_KEY'),
    baseUrl: env('VISION_BASE_URL', 'DOUBAO_BASE_URL') || 'https://ark.cn-beijing.volces.com/api/v3',
    model: env('VISION_MODEL', 'DOUBAO_ENDPOINT_ID'),
});

const estimateDataUrlBytes = (dataUrl: string): number => {
    const base64 = dataUrl.split(',')[1] || '';
    return Math.floor((base64.length * 3) / 4);
};

const NO_TEXT_SENTINEL = 'NO_TEXT_FOUND';

const NO_TEXT_INSTRUCTION = `If the image contains no readable document text (e.g. it is a photo, icon, diagram, or a UI screenshot/mockup with no real body text), respond with exactly "${NO_TEXT_SENTINEL}" and nothing else. Never describe or caption the image, and never invent placeholder content.`;

const isRetryableVisionApiError = (error: unknown): boolean => {
    const message = String((error as any)?.message ?? error ?? '');
    return [
        'only support text messages',
        'invalid_image_url',
        'invalid_base64_image',
        'Invalid base64 image',
        'failed_to_download_image',
        'image_url',
        'responses api',
    ].some((needle) => message.includes(needle));
};

const extractResponseText = (response: any): string => {
    if (typeof response?.output_text === 'string') return response.output_text.trim();

    const parts: string[] = [];
    for (const item of response?.output ?? []) {
        for (const content of item?.content ?? []) {
            const text = content?.text ?? content?.output_text;
            if (typeof text === 'string') parts.push(text);
        }
    }
    return parts.join('\n').trim();
};

async function recognizeWithResponses(
    client: OpenAI,
    model: string,
    image: VisionImageInput,
    imageRef: { image_url?: string; file_id?: string },
): Promise<string> {
    const response = await client.responses.create({
        model,
        input: [
            {
                role: 'user',
                content: [
                    {
                        type: 'input_text',
                        text: [
                            'You are a document OCR and layout assistant.',
                            'Extract all visible text from the image, preserving reading order.',
                            'Recover heading hierarchy, tables, forms, lists, figures, and captions when present.',
                            'Return concise Markdown-like plain text suitable for downstream document formatting.',
                            'Do not invent content that is not visible.',
                            NO_TEXT_INSTRUCTION,
                            '',
                            `Image filename: ${image.name}`,
                        ].join('\n'),
                    },
                    {
                        type: 'input_image',
                        ...imageRef,
                    },
                ],
            },
        ],
        temperature: 0.1,
        max_output_tokens: Number(process.env.VISION_MAX_TOKENS || process.env.AI_MAX_TOKENS || 8192),
    } as any);

    const text = extractResponseText(response);
    if (!text) throw new Error('VISION_EMPTY_RESULT');
    if (text === NO_TEXT_SENTINEL) throw new Error('VISION_NO_TEXT_FOUND');
    return text;
}

async function recognizeWithChat(client: OpenAI, model: string, image: VisionImageInput): Promise<string> {
    const result = await client.chat.completions.create({
        model,
        messages: [
            {
                role: 'system',
                content: [
                    'You are a document OCR and layout assistant.',
                    'Extract all visible text from the image, preserving reading order.',
                    'Recover heading hierarchy, tables, forms, lists, figures, and captions when present.',
                    'Return concise Markdown-like plain text suitable for downstream document formatting.',
                    'Do not invent content that is not visible.',
                    NO_TEXT_INSTRUCTION,
                ].join('\n'),
            },
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: `Image filename: ${image.name}\nExtract and structure this image for document layout.`,
                    },
                    {
                        type: 'image_url',
                        image_url: { url: image.dataUrl },
                    },
                ],
            },
        ],
        temperature: 0.1,
        max_tokens: Number(process.env.VISION_MAX_TOKENS || process.env.AI_MAX_TOKENS || 8192),
    });

    const text = result.choices[0]?.message?.content?.trim();
    if (!text) throw new Error('VISION_EMPTY_RESULT');
    if (text === NO_TEXT_SENTINEL) throw new Error('VISION_NO_TEXT_FOUND');
    return text;
}

export async function recognizeImagesForLayout(images: VisionImageInput[]): Promise<string> {
    if (images.length === 0) return '';
    if (images.length > 4) throw new Error('VISION_TOO_MANY_IMAGES');

    const cfg = getVisionConfig();
    if (!cfg.apiKey || !cfg.model) throw new Error('VISION_NOT_CONFIGURED');

    const client = new OpenAI({ apiKey: cfg.apiKey, baseURL: cfg.baseUrl });
    const sections: string[] = [];

    for (const image of images) {
        if (!image.dataUrl.startsWith('data:image/')) throw new Error('VISION_INVALID_IMAGE');
        if (estimateDataUrlBytes(image.dataUrl) > 12 * 1024 * 1024) throw new Error('VISION_IMAGE_TOO_LARGE');

        let text: string;
        try {
            text = await recognizeWithChat(client, cfg.model, image);
        } catch (error) {
            if (!isRetryableVisionApiError(error)) throw error;
            text = await recognizeWithResponses(client, cfg.model, image, { image_url: image.dataUrl });
        }
        sections.push(`# Image: ${image.name}\n\n${text}`);
    }

    return sections.join('\n\n---\n\n');
}
