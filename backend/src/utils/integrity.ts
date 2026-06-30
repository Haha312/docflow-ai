/**
 * 内容完整性证明:对比 AI 排版前后的结构计数,并汇总生成期间触发的(原本静默的)
 * 丢失/截断/跳过等防护事件,产出一份用户可见的 IntegrityReport。
 *
 * 注意:这些类型需与前端 frontend/types.ts 中的镜像保持一致(手动同步)。
 */

import { normalizeHeadingText } from './headingText';

export type IntegritySeverity = 'info' | 'warning' | 'critical';

export interface IntegrityIssue {
    type: string;            // 机器可读类别,如 'loop_truncated' / 'chunk_skipped'
    severity: IntegritySeverity;
    detail: string;          // 人类可读说明(中文)
}

export interface StructuralCounts {
    paragraphs: number;
    headings: number;
    headingsByLevel: Record<number, number>; // { 1: n, 2: n, ... }
    listItems: number;
    charCount: number;       // 去标签去空白后的纯文本字符数
    images: number;
}

export interface IntegrityReport {
    input: StructuralCounts;
    output: StructuralCounts;
    charRetentionPct: number;  // round(output.charCount / input.charCount * 100)
    headingsMatched: boolean;  // output.headings >= input.headings
    issues: IntegrityIssue[];
    truncated: boolean;        // 是否有截断/幻觉/提前停止类事件
}

/**
 * 统计一段 HTML 的结构计数。正则风格与 generate.ts 里既有的 guard 保持一致。
 */
export const countStructure = (html: string): StructuralCounts => {
    const safe = html || '';

    const paragraphs = (safe.match(/<p\b/gi) ?? []).length;
    const images = (safe.match(/<img\b/gi) ?? []).length;

    // 列表项:<li> 数 与 (N)/（N）显式编号 取较大者(复用 countNumberedItems 思路)
    const liCount = (safe.match(/<li\b/gi) ?? []).length;
    const explicitNum = (safe.match(/[（(]\s*\d+\s*[）)]/g) ?? []).length;
    const listItems = Math.max(liCount, explicitNum);

    // 标题:逐级统计,跳过文档大标题 doc-title(它不是内容章节)
    const headingsByLevel: Record<number, number> = {};
    let headings = 0;
    const re = /<h([1-6])\b([^>]*)>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(safe)) !== null) {
        const level = parseInt(m[1], 10);
        const attrs = m[2] || '';
        if (/doc-title/i.test(attrs)) continue;
        headingsByLevel[level] = (headingsByLevel[level] ?? 0) + 1;
        headings += 1;
    }

    // 纯文本字符数(与 generate.ts line ~1513 的 pureText 口径一致)
    const charCount = safe.replace(/<[^>]+>/g, '').replace(/\s+/g, '').trim().length;

    return { paragraphs, headings, headingsByLevel, listItems, charCount, images };
};

/**
 * 后处理后的结构绊线:断言"最多一个文档大标题"等不变量。
 * postProcess(P0-3)已保证编号连续、单标题;这里在它之后再断言一次,
 * 触发即说明后处理出现回归 → critical,让问题可见而非静默。
 */
export const detectStructuralAnomalies = (html: string): IntegrityIssue[] => {
    const issues: IntegrityIssue[] = [];
    const docTitleCount = (html.match(/class\s*=\s*"[^"]*\bdoc-title\b[^"]*"/gi) ?? []).length;
    if (docTitleCount > 1) {
        issues.push({ type: 'multiple_titles', severity: 'critical', detail: `检测到 ${docTitleCount} 个文档大标题(应为 1 个),排版可能异常` });
    }

    // 文本级绊线:重复标题被降级时会被抹掉 doc-title class,只数 class 会漏检。
    // 故再按"与文档标题同文本的 h2~h6"检测——分块边界重复吐出的标题若残留,会在此暴露(critical)。
    const title = normalizeHeadingText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
    if (title) {
        let dupAsHeading = 0;
        const re = /<h([2-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html)) !== null) {
            if (normalizeHeadingText(m[2]) === title) dupAsHeading += 1;
        }
        if (dupAsHeading > 0) {
            issues.push({
                type: 'title_text_duplicated_as_heading',
                severity: 'critical',
                detail: `检测到 ${dupAsHeading} 处与文档标题同文本的章节标题(疑似重复标题残留),排版可能异常`,
            });
        }
    }
    return issues;
};

/**
 * 组装最终报告。inputCounts/outputCounts 由调用方用 countStructure 算好后传入,
 * 这里只做派生字段(保留率 / 标题是否齐 / 是否截断)。
 */
export const buildIntegrityReport = (
    input: StructuralCounts,
    output: StructuralCounts,
    issues: IntegrityIssue[],
): IntegrityReport => {
    const charRetentionPct = input.charCount > 0
        ? Math.round((output.charCount / input.charCount) * 100)
        : 100;
    const truncated = issues.some(
        (x) => x.type === 'loop_truncated' || x.type === 'stream_hallucination' || x.type === 'early_stop',
    );
    // headingsMatched 需与"权威缺失信号"一致:骨架对齐报了 heading_missing,或计数差报了 early_stop/headings_reduced 时,
    // 即便原始计数 output>=input(例如误升标题被降级后总数不变)也不能宣称"标题齐",否则与 issues 自相矛盾。
    const hasHeadingLossIssue = issues.some(
        (x) => x.type === 'heading_missing' || x.type === 'early_stop' || x.type === 'headings_reduced',
    );
    return {
        input,
        output,
        charRetentionPct,
        headingsMatched: output.headings >= input.headings && !hasHeadingLossIssue,
        issues,
        truncated,
    };
};
