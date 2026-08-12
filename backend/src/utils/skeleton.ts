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

/** 中文数字 → 阿拉伯数字(一~九十九,够章节用);认不出返回 null */
const cnToNumber = (cn: string): number | null => {
    const digits: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const s = (cn || '').trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (digits[s]) return digits[s];
    const m = s.match(/^(.?)十(.?)$/);
    if (m) {
        const tens = m[1] === '' ? 1 : digits[m[1]];
        const ones = m[2] === '' ? 0 : digits[m[2]];
        if (tens === undefined || ones === undefined) return null;
        return tens * 10 + ones;
    }
    return null;
};

/**
 * 取标题行自带的「本级序号」。源文写第三章就是第三章 —— 拿不到就返回 null,由计数器接手。
 * 注意只取本级:「1.2 负荷构成」的本级序号是 2,父级 1 由上一条章标题的计数提供。
 */
const visibleOwnNumber = (line: string): number | null => {
    let m = line.match(/^第\s*([一二三四五六七八九十0-9]+)\s*[章篇部]/);
    if (m) return cnToNumber(m[1]);
    m = line.match(/^([一二三四五六七八九十]+)\s*、/);
    if (m) return cnToNumber(m[1]);
    m = line.match(/^[（(]\s*([一二三四五六七八九十\d]+)\s*[）)]/);
    if (m) return cnToNumber(m[1]);
    m = line.match(/^(\d+(?:\.\d+)*)(?:\s|[.、．])/);
    if (m) {
        const parts = m[1].split('.');
        const n = parseInt(parts[parts.length - 1], 10);
        return Number.isFinite(n) && n > 0 ? n : null;
    }
    return null;
};

/**
 * 伪骨架推断:输入既无 STRUCTURE_DATA 也无任何 <h> 标签(纯文本粘贴 / 无样式且无
 * 大纲级别的 Word)时,标题结构只能靠 AI 猜 —— 实测同一文档两次生成结构都不一样
 * (「第一章」被当大标题、「第二章」被当正文)。这里按行模式确定性识别章节。
 * 规则:行长 ≤40 才算标题候选(长段落即便带 1.1 前缀也是正文);以句号/分号结尾的
 * 是列表项或整句(如「1. 完成数据标准体系建设,发布数据接入规范。」)不算标题;
 * 至少 2 个候选且含章级才启用,避免把零星短句误判成结构。
 * 返回空数组表示「推断不出可信结构」,调用方应保持原有行为。
 */
export const derivePseudoHeadings = (contentHtml: string): PreComputedHeading[] => {
    const html = contentHtml || '';
    if (/<h[1-6]\b/i.test(html)) return [];
    const lineTexts: string[] = [];
    if (/<p\b/i.test(html)) {
        const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
        let pm: RegExpExecArray | null;
        while ((pm = pRe.exec(html)) !== null) lineTexts.push(pm[1].replace(/<[^>]+>/g, '').trim());
    } else {
        lineTexts.push(...html.split(/\r?\n/).map((s) => s.replace(/<[^>]+>/g, '').trim()));
    }
    const derived: PreComputedHeading[] = [];
    for (const line of lineTexts) {
        if (!line || line.length > 40) continue;
        if (/[。;；,，]$/.test(line)) continue;
        let level = 0;
        if (/^第\s*[一二三四五六七八九十百0-9]+\s*[章篇部]/.test(line)) level = 1;
        else if (/^[一二三四五六七八九十]+\s*、/.test(line)) level = 1;
        else if (/^\d+\.\d+\.\d+(?:\s|[.、．])/.test(line)) level = 3;
        else if (/^\d+\.\d+(?:\s|[.、．])/.test(line)) level = 2;
        else if (/^\d+\s*[.、．]\s*\S/.test(line) && !/^\d+\s*[.、．]\s*\d/.test(line)) level = 1;
        else if (/^[（(]\s*[一二三四五六七八九十]+\s*[）)]/.test(line)) level = 2;
        if (level > 0) derived.push({ level, text: line, number: '' });
    }
    if (derived.length < 2 || !derived.some((h) => h.level === 1)) return [];
    // 计数器只在标题行没写序号时兜底。之前无条件自增,等于把源文写的序号丢掉 ——
    // 一本书的第 3 章粘进来会被算成第 1 章,后处理再也无从知道原本是几(实测)。
    const counters = [0, 0, 0, 0, 0, 0];
    for (const h of derived) {
        const own = visibleOwnNumber(h.text);
        counters[h.level - 1] = own ?? counters[h.level - 1] + 1;
        for (let k = h.level; k < 6; k += 1) counters[k] = 0;
        h.number = counters.slice(0, h.level).join('.');
    }
    return derived;
};

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
