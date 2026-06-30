/**
 * 结构先行(两遍式)的核心:把前端从 Word XML 确定性抽取的 preComputedHeadings
 * 规整成「输出约定」下的权威骨架,作为全流程唯一的层级/章节真相来源 ——
 * 提示词(锁层级)、后处理(按骨架编号)、完整性(双向校验)都以它为准。
 *
 * 关键层级偏移:源文层级 1 = 顶层章;而输出 HTML 约定 h1 = 文档标题(无编号)、h2 = 章。
 * 故 outputLevel = sourceLevel + 1(封顶 6)。历史代码在提示词里把"章"写成 <h{sourceLevel}>=<h1>,
 * 与"h1 仅文档标题"自相矛盾,是 6→10 章漂移的根因之一;此处一次性消除。
 */
import { normalizeHeadingText, isNonNumberedHeading } from './headingText';

export type PreComputedHeading = { level: number; text: string; number: string };

export interface SkeletonNode {
    id: string;          // 稳定 id,如 "sk0"(供输出标记 data-sk + 按 id 归位)
    sourceLevel: number; // 源文层级:1 = 顶层章(Word XML 抽取,已过 LEVEL_NORM)
    outputLevel: number; // 输出 HTML 标题级:章 = h2 → min(sourceLevel + 1, 6)
    number: string;      // 源文层级号(如 "2.2.6"),仅用于提示词提示;最终编号由 scheme 决定
    text: string;        // 标题文本(无编号前缀)
    norm: string;        // 归一化文本,用于匹配/去重(口径与 postProcess/integrity 一致)
}

/**
 * 构建权威骨架。输入应为「已过 LEVEL_NORM」的 preComputedHeadings(最小层级=1)。
 * 过滤掉空文本/非法层级项;保持文档顺序;id 按顺序稳定分配。
 */
export const buildSkeleton = (headings: PreComputedHeading[]): SkeletonNode[] => {
    if (!Array.isArray(headings)) return [];
    return headings
        .filter((h) => h && typeof h.level === 'number' && h.level >= 1 && (h.text ?? '').trim().length > 0)
        .map((h, i) => {
            const sourceLevel = Math.max(1, Math.min(6, Math.round(h.level)));
            return {
                id: `sk${i}`,
                sourceLevel,
                outputLevel: Math.min(sourceLevel + 1, 6),
                number: (h.number ?? '').trim(),
                text: h.text.trim(),
                norm: normalizeHeadingText(h.text),
            } as SkeletonNode;
        })
        .filter((n) => n.norm.length > 0);
};

/**
 * 骨架里章级(输出 h2)节点数 = 文档应有的章数。完整性双向校验用。
 * 排除前置事务性标题(目录/摘要/前言…)——它们虽是 h2 级但不编号、不算章。
 */
export const expectedChapterCount = (skeleton: SkeletonNode[]): number =>
    skeleton.filter((n) => n.outputLevel === 2 && !isNonNumberedHeading(n.text)).length;

export interface SkeletonMatch { node: SkeletonNode; index: number }

// 归一化编辑距离相似度 —— 用于「轻微改写的标题」兜底匹配(增删一两个字 / 改标点)。
const levenshtein = (a: string, b: string): number => {
    const m = a.length, n = b.length;
    if (m === 0) return n;
    if (n === 0) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
        const cur = [i];
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        }
        prev = cur;
    }
    return prev[n];
};
const similarity = (a: string, b: string): number => {
    const maxLen = Math.max(a.length, b.length);
    return maxLen === 0 ? 0 : 1 - levenshtein(a, b) / maxLen;
};
const FUZZY_THRESHOLD = 0.85;

/**
 * 顺序对齐匹配器:按文档顺序把输出标题对到骨架节点,天然处理重名标题。
 * 策略:维护游标 cursor,优先匹配「游标及之后」第一个未用且 norm 相等的节点(顺序优先);
 * 找不到再全局回退到任意未用且相等的节点(乱序/重名兜底)。每个节点至多用一次。
 */
export const createSkeletonMatcher = (skeleton: SkeletonNode[]) => {
    let cursor = 0;
    const used = new Set<number>();
    return {
        match(norm: string): SkeletonMatch | null {
            if (!norm) return null;
            for (let i = cursor; i < skeleton.length; i++) {
                if (!used.has(i) && skeleton[i].norm === norm) {
                    used.add(i);
                    cursor = i + 1;
                    return { node: skeleton[i], index: i };
                }
            }
            for (let i = 0; i < skeleton.length; i++) {
                if (!used.has(i) && skeleton[i].norm === norm) {
                    used.add(i);
                    cursor = Math.max(cursor, i + 1);
                    return { node: skeleton[i], index: i };
                }
            }
            // 模糊兜底:AI 轻微改写了标题(如"风场尾流效应分析"→"风场尾流效应的分析")→ 精确匹配失败。
            // 取相似度 ≥ 阈值且最高的未用节点,避免把真章误判为缺失/被降级。短标题(<3字)不模糊,防误配。
            if (norm.length >= 3) {
                let best = -1;
                let bestScore = 0;
                for (let i = 0; i < skeleton.length; i++) {
                    if (used.has(i)) continue;
                    const s = similarity(skeleton[i].norm, norm);
                    if (s >= FUZZY_THRESHOLD && s > bestScore) { bestScore = s; best = i; }
                }
                if (best >= 0) {
                    used.add(best);
                    cursor = Math.max(cursor, best + 1);
                    return { node: skeleton[best], index: best };
                }
            }
            return null;
        },
        usedCount: () => used.size,
        unusedNodes: (): SkeletonNode[] => skeleton.filter((_, i) => !used.has(i)),
    };
};
