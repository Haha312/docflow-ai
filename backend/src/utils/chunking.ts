
/**
 * Smart Chunking Utility
 * 用于将长文档语义化切分为适合 LLM 处理的片段
 */

export interface Chunk {
    index: number;
    total: number;
    content: string;
    startIndex: number;
    endIndex: number;
}

/**
 * 估算 Token 数量 (简单按字符数估算, 中文 1 char ≈ 1-2 tokens)
 * Gemini 3 Pro Preview 支持大上下文窗口和 16k output。
 * 12000 字符输入 -> 约 18000 输出字符 -> 约 12000-14000 tokens。
 * 更大的块 = 更少的 API 调用 = 更快的速度，同时保持在模型输出限制内。
 */
const CHUNK_SIZE_CHARS = 12000;
const OVERLAP_CHARS = 500; // 重叠上下文长度 (用于 prompt context, 不用于实际 content 重叠)

// 实际上我们不需要物理重叠 content (这会导致重复输出)，
// 我们需要的是将上一段的末尾作为 Context 传给 AI。

export const splitContentBySemantics = (content: string, maxChars: number = CHUNK_SIZE_CHARS): string[] => {
    if (content.length <= maxChars) {
        return [content];
    }

    const chunks: string[] = [];
    let processed = 0;

    while (processed < content.length) {
        // 剩余内容是否足够小
        if (content.length - processed <= maxChars) {
            chunks.push(content.slice(processed));
            break;
        }

        // 寻找最佳切分点
        let splitIndex = processed + maxChars;

        // 向前搜索最近的段落结束符 (\n\n)
        // 搜索范围：splitIndex 往前 1000 字符
        const searchWindow = content.slice(Math.max(processed, splitIndex - 1000), splitIndex);

        // 优先级 1: 双换行 (段落)
        const lastDoubleLine = searchWindow.lastIndexOf('\n\n');
        // 优先级 2: 单换行
        const lastSingleLine = searchWindow.lastIndexOf('\n');
        // 优先级 3: 句子结束符 (。！？)
        const lastSentenceEnd = Math.max(
            searchWindow.lastIndexOf('。'),
            searchWindow.lastIndexOf('！'),
            searchWindow.lastIndexOf('？')
        );

        let cutPointRel = -1;

        if (lastDoubleLine !== -1) {
            cutPointRel = lastDoubleLine + 2; // 包括换行符
        } else if (lastSingleLine !== -1) {
            cutPointRel = lastSingleLine + 1;
        } else if (lastSentenceEnd !== -1) {
            cutPointRel = lastSentenceEnd + 1; // 包括标点
        }

        if (cutPointRel !== -1) {
            // 找到了语义切分点
            // searchWindow 的起始位置是 Math.max(processed, splitIndex - 1000)
            const windowStart = Math.max(processed, splitIndex - 1000);
            splitIndex = windowStart + cutPointRel;
        } else {
            // 实在找不到（比如超长的一段无标点文本），强制切分
            // 保持 splitIndex = processed + maxChars
        }

        chunks.push(content.slice(processed, splitIndex));
        processed = splitIndex;
    }

    return chunks;
};
