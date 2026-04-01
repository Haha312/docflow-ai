
/**
 * Smart Chunking Utility
 * 按语义（优先章节标题边界）将长文档切分为适合 LLM 处理的片段
 */

export interface Chunk {
    index: number;
    total: number;
    content: string;
    startIndex: number;
    endIndex: number;
}

const CHUNK_SIZE_CHARS = 12000;

/**
 * 检测中文学术/技术文档中的标题行位置
 * 返回每个标题行在文档中的字符偏移量
 */
const detectHeadingPositions = (content: string): number[] => {
    const positions: number[] = [];
    let pos = 0;
    for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length > 0 && trimmed.length < 80) {
            const isHeading =
                /^第[一二三四五六七八九十百千]+[章节部篇]/.test(trimmed) ||   // 第一章 第二节
                /^[一二三四五六七八九十]+[、.]/.test(trimmed) ||               // 一、 二、
                /^\d+[、.]\s*[\u4e00-\u9fff（【]/.test(trimmed) ||             // 1. 一 / 1、（
                /^\d+\.\d+(\.\d+)*\s+[\u4e00-\u9fff（【]/.test(trimmed) ||    // 1.1 1.1.1
                /^[（(]\s*\d+\s*[)）]\s*[\u4e00-\u9fff]/.test(trimmed);       // （1） (1)
            if (isHeading) {
                positions.push(pos);
            }
        }
        pos += line.length + 1; // +1 for \n
    }
    return positions;
};

/**
 * 提取一个 chunk 里的第一个标题行（用作续写锚点）
 */
export const extractFirstHeading = (chunkContent: string): string => {
    for (const line of chunkContent.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.length > 80) continue;
        const isHeading =
            /^第[一二三四五六七八九十百千]+[章节部篇]/.test(trimmed) ||
            /^[一二三四五六七八九十]+[、.]/.test(trimmed) ||
            /^\d+[、.]\s*[\u4e00-\u9fff（【]/.test(trimmed) ||
            /^\d+\.\d+(\.\d+)*\s+[\u4e00-\u9fff（【]/.test(trimmed) ||
            /^[（(]\s*\d+\s*[)）]\s*[\u4e00-\u9fff]/.test(trimmed);
        if (isHeading) return trimmed;
    }
    // 没找到标题就返回第一行非空文本
    return chunkContent.split('\n').find(l => l.trim().length > 0)?.trim().slice(0, 60) || '';
};

/**
 * 语义分块：优先在章节标题处切分，保证每个 chunk 从完整章节开头开始
 *
 * 切分策略（优先级从高到低）：
 * 1. 在目标位置附近（70%~100% 范围内）找最靠近目标的章节标题 → 在标题前切分
 * 2. 若无标题，找最近的段落边界（\n\n）
 * 3. 若无段落，找最近的换行（\n）
 * 4. 若无换行，强制按字符数切分
 */
export const splitContentBySemantics = (content: string, maxChars: number = CHUNK_SIZE_CHARS): string[] => {
    if (content.length <= maxChars) {
        return [content];
    }

    // 预扫描所有标题位置
    const headingPositions = detectHeadingPositions(content);

    const chunks: string[] = [];
    let processed = 0;

    while (processed < content.length) {
        if (content.length - processed <= maxChars) {
            chunks.push(content.slice(processed));
            break;
        }

        const targetEnd = processed + maxChars;

        // 策略1：在 70%~100% 范围内找最后一个章节标题，在它之前切分
        const searchStart70 = processed + Math.floor(maxChars * 0.7);
        const candidateHeadings = headingPositions.filter(
            p => p > searchStart70 && p < targetEnd && p > processed
        );

        if (candidateHeadings.length > 0) {
            // 取最靠近 targetEnd 的标题（贪心：每块尽量大）
            const splitIndex = candidateHeadings[candidateHeadings.length - 1];
            chunks.push(content.slice(processed, splitIndex));
            processed = splitIndex;
            continue;
        }

        // 策略2：段落边界（\n\n）
        const windowStart = Math.max(processed, targetEnd - 1000);
        const searchWindow = content.slice(windowStart, targetEnd);
        const lastDoubleNewline = searchWindow.lastIndexOf('\n\n');
        if (lastDoubleNewline !== -1) {
            const splitIndex = windowStart + lastDoubleNewline + 2;
            chunks.push(content.slice(processed, splitIndex));
            processed = splitIndex;
            continue;
        }

        // 策略3：单换行
        const lastNewline = searchWindow.lastIndexOf('\n');
        if (lastNewline !== -1) {
            const splitIndex = windowStart + lastNewline + 1;
            chunks.push(content.slice(processed, splitIndex));
            processed = splitIndex;
            continue;
        }

        // 策略4：强制切分
        chunks.push(content.slice(processed, targetEnd));
        processed = targetEnd;
    }

    return chunks;
};
