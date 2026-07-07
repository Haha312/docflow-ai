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
    tables: number;
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
    const imgTags = (safe.match(/<img\b/gi) ?? []).length;
    const imagePlaceholders = (safe.match(/__IMG_\d+__/g) ?? []).length;
    const images = imgTags + imagePlaceholders;
    const tables = (safe.match(/<table\b/gi) ?? []).length;

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

    return { paragraphs, headings, headingsByLevel, listItems, charCount, images, tables };
};

/**
 * 后处理后的结构绊线:断言"最多一个文档大标题"等不变量。
 * postProcess(P0-3)已保证编号连续、单标题;这里在它之后再断言一次,
 * 触发即说明后处理出现回归 → critical,让问题可见而非静默。
 */
export const detectStructuralAnomalies = (html: string): IntegrityIssue[] => {
    const issues: IntegrityIssue[] = [];
    // (?!-) 排除 doc-title-en(英文题名,与中文 doc-title 并存是学术期刊预设的正常结构,
    // \bdoc-title\b 本身会误配到 "doc-title-en" 里的 "doc-title" 前缀,导致双语标题被误报成重复标题)
    const docTitleCount = (html.match(/class\s*=\s*"[^"]*\bdoc-title\b(?!-)[^"]*"/gi) ?? []).length;
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

export const validateFinalIntegrity = (
    input: StructuralCounts,
    output: StructuralCounts,
): IntegrityIssue[] => {
    const issues: IntegrityIssue[] = [];

    if (input.images > 0 && output.images < input.images) {
        issues.push({
            type: 'images_reduced',
            severity: 'critical',
            detail: `图片数量少于原文: 原文 ${input.images} 张, 成稿 ${output.images} 张, 请检查是否有图片遗漏`,
        });
    }

    if (input.tables > 0 && output.tables < input.tables) {
        const lost = input.tables - output.tables;
        const severe = output.tables === 0 || lost / input.tables >= 0.3;
        issues.push({
            type: 'tables_reduced',
            severity: severe ? 'critical' : 'warning',
            detail: `表格数量少于原文: 原文 ${input.tables} 个, 成稿 ${output.tables} 个, 可能有表格遗漏`,
        });
    }

    if (input.listItems >= 5 && output.listItems < Math.floor(input.listItems * 0.7)) {
        const severe = output.listItems < Math.floor(input.listItems * 0.4);
        issues.push({
            type: 'list_items_reduced',
            severity: severe ? 'critical' : 'warning',
            detail: `列表条目明显减少: 原文 ${input.listItems} 条, 成稿 ${output.listItems} 条, 请核对条款/要点是否完整`,
        });
    }

    if (input.paragraphs >= 10 && output.paragraphs < Math.floor(input.paragraphs * 0.35) && output.charCount < input.charCount * 0.9) {
        issues.push({
            type: 'paragraphs_reduced',
            severity: output.charCount < input.charCount * 0.75 ? 'critical' : 'warning',
            detail: `段落数量明显减少: 原文 ${input.paragraphs} 段, 成稿 ${output.paragraphs} 段, 可能存在正文合并或遗漏`,
        });
    }

    if (input.charCount >= 1000 && output.charCount < Math.floor(input.charCount * 0.85)) {
        issues.push({
            type: 'content_reduced',
            severity: output.charCount < Math.floor(input.charCount * 0.7) ? 'critical' : 'warning',
            detail: `正文保留率偏低: 原文约 ${input.charCount} 字, 成稿约 ${output.charCount} 字, 请核对是否有内容遗漏`,
        });
    }

    if (input.charCount >= 1000 && output.charCount > input.charCount * 3) {
        issues.push({
            type: 'content_expanded',
            severity: output.charCount > input.charCount * 4 ? 'critical' : 'warning',
            detail: `成稿篇幅异常膨胀: 原文约 ${input.charCount} 字, 成稿约 ${output.charCount} 字, 可能存在重复生成`,
        });
    }

    return issues;
};

const extractTables = (html: string): string[] => {
    const tables: string[] = [];
    const re = /<table\b[\s\S]*?<\/table>/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html || '')) !== null) tables.push(match[0]);
    return tables;
};

const normalizeTableFingerprint = (html: string): string =>
    html
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, '')
        .replace(/&amp;/gi, '&')
        .replace(/\s+/g, '')
        .toLowerCase();

const tableMatches = (sourceKey: string, outputKey: string): boolean => {
    if (!sourceKey || !outputKey) return false;
    if (sourceKey === outputKey || outputKey.includes(sourceKey) || sourceKey.includes(outputKey)) return true;
    if (sourceKey.length < 160) return false;
    return outputKey.includes(sourceKey.slice(0, 80)) && outputKey.includes(sourceKey.slice(-80));
};

export const reconcileMissingTables = (
    sourceHtml: string,
    outputHtml: string,
): { text: string; issues: IntegrityIssue[] } => {
    const sourceTables = extractTables(sourceHtml);
    if (sourceTables.length === 0) return { text: outputHtml, issues: [] };

    const outputKeys = extractTables(outputHtml).map(normalizeTableFingerprint);
    const usedOutputIndexes = new Set<number>();
    const missingTables: string[] = [];

    for (const table of sourceTables) {
        const sourceKey = normalizeTableFingerprint(table);
        if (sourceKey.length < 2) continue;
        const matchIndex = outputKeys.findIndex((outKey, index) =>
            !usedOutputIndexes.has(index) && tableMatches(sourceKey, outKey),
        );
        if (matchIndex >= 0) {
            usedOutputIndexes.add(matchIndex);
        } else {
            missingTables.push(table);
        }
    }

    if (missingTables.length === 0) return { text: outputHtml, issues: [] };

    const appendix = [
        '<p><strong>附录: 未能定位到原位置的表格</strong></p>',
        ...missingTables.map((table, index) => `<div class="table-caption">原始表格 ${index + 1}</div>${table}`),
    ].join('');

    return {
        text: outputHtml + appendix,
        issues: [{
            type: 'table_missing',
            severity: 'warning',
            detail: `${missingTables.length} 个原文表格未能定位到成稿正文, 已补到文末附录, 请核对表格位置`,
        }],
    };
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
