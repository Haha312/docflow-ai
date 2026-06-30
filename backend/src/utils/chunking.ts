
/**
 * Smart Chunking Utility
 * 按语义（优先 HTML 标题/块级边界）将长文档切分为适合 LLM 处理的片段
 */

const CHUNK_SIZE_CHARS = 12000;

const normalizeText = (s: string): string => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const detectHeadingTagPositions = (content: string): number[] => {
    const positions: number[] = [];
    const headingOpenTag = /<h[1-6]\b[^>]*>/gi;
    let match: RegExpExecArray | null;
    while ((match = headingOpenTag.exec(content)) !== null) {
        positions.push(match.index);
    }
    return positions;
};

const detectHtmlSafeSplitPositions = (content: string): number[] => {
    const positions: number[] = [];
    const blockCloseTag = /<\/(h[1-6]|p|div|section|article|table|ul|ol|li|blockquote|pre)>/gi;
    let match: RegExpExecArray | null;
    while ((match = blockCloseTag.exec(content)) !== null) {
        positions.push(match.index + match[0].length);
    }
    return positions;
};

const calcTailHeadOverlap = (a: string, b: string, maxWindow = 2000): number => {
    const left = normalizeText(a).slice(-maxWindow);
    const right = normalizeText(b).slice(0, maxWindow);
    const maxLen = Math.min(left.length, right.length);
    for (let len = maxLen; len >= 80; len--) {
        if (left.slice(-len) === right.slice(0, len)) return len;
    }
    return 0;
};

export const extractFirstHeading = (chunkContent: string): string => {
    const headingMatch = chunkContent.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i);
    if (headingMatch?.[1]) {
        const headingText = normalizeText(headingMatch[1]);
        if (headingText) return headingText.slice(0, 80);
    }
    const blockMatch = chunkContent.match(/<(p|div|section|article|li|td|th)\b[^>]*>([\s\S]*?)<\/\1>/i);
    if (blockMatch?.[2]) {
        const txt = normalizeText(blockMatch[2]);
        if (txt) return txt.slice(0, 80);
    }
    return normalizeText(chunkContent).slice(0, 80);
};

// 若切点 idx 落在 __IMG_N__ 占位符内部 → 回退到该占位符的开头(整体归入下一块),
// 避免把占位符切成两半(如 __IMG_12__ → __IMG_1 | 2__)导致图片彻底丢失。占位符很短,扫 idx 两侧窗口即可。
const snapOffPlaceholder = (content: string, idx: number): number => {
    if (idx <= 0 || idx >= content.length) return idx;
    const winStart = Math.max(0, idx - 20);
    const win = content.slice(winStart, idx + 20);
    const local = idx - winStart;
    const re = /__IMG_\d+__/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(win)) !== null) {
        const s = m.index;
        const e = m.index + m[0].length;
        if (s < local && local < e) return winStart + s; // 切点在占位符内部 → 退到其开头
    }
    return idx;
};

export const splitContentBySemantics = (content: string, maxChars: number = CHUNK_SIZE_CHARS): string[] => {
    if (content.length <= maxChars) return [content];

    const headingPositions = detectHeadingTagPositions(content);
    const safeBoundaries = detectHtmlSafeSplitPositions(content);
    const chunks: string[] = [];
    let processed = 0;

    while (processed < content.length) {
        const chunkStart = processed;
        if (content.length - processed <= maxChars) {
            const tailChunk = content.slice(processed);
            chunks.push(tailChunk);
            console.log(`[SPLIT] chunk#${chunks.length} range=[${chunkStart},${content.length}) len=${tailChunk.length} strategy=final-tail`);
            break;
        }

        const targetEnd = processed + maxChars;
        const searchStart70 = processed + Math.floor(maxChars * 0.7);

        // ── 选切点(策略级联),先不切片 ──
        let splitIndex = -1;
        let strategy = '';

        const candidateHeadings = headingPositions.filter((p) => p > searchStart70 && p < targetEnd && p > processed);
        if (candidateHeadings.length > 0) {
            splitIndex = candidateHeadings[candidateHeadings.length - 1];
            strategy = 'heading-tag';
        } else {
            const candidateSafe = safeBoundaries.filter((p) => p > searchStart70 && p <= targetEnd && p > processed);
            if (candidateSafe.length > 0) {
                splitIndex = candidateSafe[candidateSafe.length - 1];
                strategy = 'html-safe-boundary';
            } else {
                const windowStart = Math.max(processed, targetEnd - 1000);
                const searchWindow = content.slice(windowStart, targetEnd);
                const lastDoubleNewline = searchWindow.lastIndexOf('\n\n');
                const lastNewline = searchWindow.lastIndexOf('\n');
                if (lastDoubleNewline !== -1) {
                    splitIndex = windowStart + lastDoubleNewline + 2;
                    strategy = 'double-newline';
                } else if (lastNewline !== -1) {
                    splitIndex = windowStart + lastNewline + 1;
                    strategy = 'newline';
                } else {
                    // 兜底:不在行/词中间硬切。从 targetEnd 向后找最近换行(限 2000 字),再退而求其次找空白;
                    // 实在没有(整段无空白)才在 targetEnd 硬切。
                    const fwd = content.slice(targetEnd, Math.min(content.length, targetEnd + 2000));
                    const nl = fwd.indexOf('\n');
                    const sp = fwd.search(/\s/);
                    if (nl !== -1) { splitIndex = targetEnd + nl + 1; strategy = 'hard-cut-extend-newline'; }
                    else if (sp !== -1) { splitIndex = targetEnd + sp + 1; strategy = 'hard-cut-extend-space'; }
                    else { splitIndex = targetEnd; strategy = 'hard-cut'; }
                }
            }
        }

        // ── 任何切点都避开半个占位符;死循环兜底 ──
        const snapped = snapOffPlaceholder(content, splitIndex);
        if (snapped > processed) splitIndex = snapped;
        if (splitIndex <= processed) splitIndex = Math.min(content.length, targetEnd);

        const chunk = content.slice(processed, splitIndex);
        chunks.push(chunk);
        console.log(`[SPLIT] chunk#${chunks.length} range=[${chunkStart},${splitIndex}) len=${chunk.length} strategy=${strategy}`);
        processed = splitIndex;
    }

    return chunks;
};

export const compressChunksByCoverage = (
    chunks: string[],
    overlapThreshold = 0.78,
    minOverlapChars = 240
): { chunks: string[]; dropped: number } => {
    if (chunks.length <= 1) return { chunks, dropped: 0 };
    const compressed: string[] = [chunks[0]];
    let dropped = 0;
    for (let i = 1; i < chunks.length; i++) {
        const prev = compressed[compressed.length - 1];
        const curr = chunks[i];
        const overlap = calcTailHeadOverlap(prev, curr, 2600);
        const currHeadLen = Math.min(normalizeText(curr).length, 2600);
        const coverage = currHeadLen > 0 ? overlap / currHeadLen : 0;
        if (overlap >= minOverlapChars && coverage >= overlapThreshold) {
            dropped += 1;
            continue;
        }
        compressed.push(curr);
    }
    return { chunks: compressed, dropped };
};
