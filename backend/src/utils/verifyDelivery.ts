/**
 * 交付前完整校验(P1):在把成稿交给用户之前,逐项核对"原文 → 成稿"是否真的对得上。
 *
 * 与既有两层的分工(不要重复造轮子):
 *   - postProcess.ts  = 确定性「修正」层(标题/图表重编号、重复标题降级、图片占位符对账…)
 *   - integrity.ts    = 结构「计数」层(段落/表格/列表数量比例、整表指纹恢复)
 *   - 本文件          = 交付前「逐项核对」层,查 计数层查不出来 的三类问题:
 *       (a) 表格结构不完整 —— 计数层只数 <table> 个数,一个表少一半单元格它看不见
 *       (b) 图表编号不连续 —— postProcess 在 skeleton 且 caption 自带编号时会跳过重编号,
 *                             那条支路的错号/跳号此前完全无人检查(见 postProcess.ts renumberStructure 的 carve-out)
 *       (c) 整句内容丢失/凭空多出 —— 计数层只看字数比例,句子级的丢失被平均掉了
 *
 * 校验粒度(产品决策):正文逐句核对,容忍标点/空白/全半角差异,不做逐字精确比对
 * —— AI 正常的排版行为(统一标点、去多余空格)不应被判为错误。
 */

import type { IntegrityIssue } from './integrity';

// ─────────────────────────────────────────────────────────────
// 通用文本归一
// ─────────────────────────────────────────────────────────────

/** 去标签 → 解实体 → 全角标点归一 → 去所有空白。用于"内容是否等价"的比较。 */
export const normalizeForCompare = (html: string): string =>
    (html || '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/gi, '')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/[，、]/g, ',')
        .replace(/[。．]/g, '.')
        .replace(/[；]/g, ';')
        .replace(/[：]/g, ':')
        .replace(/[？]/g, '?')
        .replace(/[！]/g, '!')
        .replace(/[（）]/g, (c) => (c === '（' ? '(' : ')'))
        // 引号一律折成 ASCII 双引号。必须写成显式转义:这行原本是直接贴的弯引号,
        // 某次编码往返把它压成了两个 ASCII 引号(U+22 U+22 U+27 U+27),规则等于没生效 ——
        // 于是模型把 "xx" 排成 “xx” 时,整句比对失败,报出并不存在的「缺失句子」(七题材跑批实测)。
        // ★ ● ※ 这类装饰符是排版符号不是内容:源文标题「★ 3.2 实施范围」排版时把它
        // 与旧编号一并剥掉,字一个没少却被判成整句丢失(真实文档实测)。两侧同折,比对才对等。
        .replace(/[\u2605\u2606\u25CF\u25CB\u25C6\u25C7\u25A0\u25A1\u25B2\u25B3\u25BD\u25BC\u203B\u25CE\u2666\u2022]/g, '')
        .replace(/[“”‘’「」『』«»'"]/g, '"')
        .replace(/\s+/g, '')
        .toLowerCase();

// ─────────────────────────────────────────────────────────────
// (a) 表格结构完整性
// ─────────────────────────────────────────────────────────────

export interface TableRowShape {
    /** 该行的"列宽":每个单元格按 colspan 累加,rowspan 不影响本行宽度 */
    width: number;
    cellCount: number;
}

/**
 * 解析单个 <table>...</table> 片段里每一行的形状。
 * 用正则而非 DOM:后端无 DOM,且此处只需行/单元格粒度,正则足够且更快。
 */
export const parseTableRows = (tableHtml: string): TableRowShape[] => {
    const rows: TableRowShape[] = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(tableHtml)) !== null) {
        const inner = m[1] || '';
        const cellRe = /<(td|th)\b([^>]*)>/gi;
        let c: RegExpExecArray | null;
        let width = 0;
        let cellCount = 0;
        while ((c = cellRe.exec(inner)) !== null) {
            const attrs = c[2] || '';
            const colspanMatch = attrs.match(/colspan\s*=\s*["']?(\d+)/i);
            const span = colspanMatch ? Math.max(1, parseInt(colspanMatch[1], 10) || 1) : 1;
            width += span;
            cellCount += 1;
        }
        rows.push({ width, cellCount });
    }
    return rows;
};

/**
 * 表格结构校验。检出三类问题:
 *   1. 未闭合的 <table>(开闭标签数量不匹配)
 *   2. 行宽不一致(某些行缺单元格 —— 就是你看到的"表格没画完整")
 *   3. 空表(有 <table> 但一行都没有 / 所有行都没有单元格)
 *
 * 说明:rowspan 会让被跨越行的实际单元格数少于表格列数,属于合法结构,
 * 因此这里用"众数行宽"作基准,并只在偏差行占比不高时才报(避免对合法的复杂表格误报)。
 */
export const verifyTableStructure = (html: string): IntegrityIssue[] => {
    const issues: IntegrityIssue[] = [];
    // 注释里的标签不是页面上的表格,不能参与计数(否则被注释掉的 <table> 会误报未闭合)。
    // cleanOutput 已经会剔除注释,这里再挡一道 —— 本函数也被别处直接调用。
    const safe = (html || '').replace(/<!--[\s\S]*?-->/g, '');

    // 1) 未闭合表格
    const openCount = (safe.match(/<table\b/gi) ?? []).length;
    const closeCount = (safe.match(/<\/table>/gi) ?? []).length;
    if (openCount > closeCount) {
        issues.push({
            type: 'table_unclosed',
            severity: 'critical',
            detail: `检测到 ${openCount - closeCount} 个未闭合的表格标签,表格可能显示不完整`,
        });
    }

    // 2) & 3) 逐表检查行结构
    const tableRe = /<table\b[\s\S]*?<\/table>/gi;
    let t: RegExpExecArray | null;
    let index = 0;
    const malformed: number[] = [];
    const empty: number[] = [];

    while ((t = tableRe.exec(safe)) !== null) {
        index += 1;
        const rows = parseTableRows(t[0]);
        const nonEmptyRows = rows.filter((r) => r.cellCount > 0);

        if (nonEmptyRows.length === 0) {
            empty.push(index);
            continue;
        }

        // 含 rowspan 的表:被跨越行的单元格数天然少于列数,行宽模型判不了对错
        // (真实文档的报价明细表大量纵向合并,逐行宽度检查全是误报)。跳过行宽检查,
        // 空表/未闭合检查仍生效。
        if (/\browspan\s*=/i.test(t[0])) continue;

        // 众数行宽作为该表的"应有列数"
        const freq = new Map<number, number>();
        for (const r of nonEmptyRows) freq.set(r.width, (freq.get(r.width) ?? 0) + 1);
        let expectedWidth = 0;
        let bestFreq = 0;
        for (const [w, f] of freq) {
            if (f > bestFreq || (f === bestFreq && w > expectedWidth)) {
                expectedWidth = w;
                bestFreq = f;
            }
        }

        // 偏离众数宽度的行。rowspan 合法场景下通常只有少数行偏离,
        // 故只在"偏离行 >= 1 且 众数行仍占多数"时判为结构缺损,避免误伤复杂合并表。
        const deviating = nonEmptyRows.filter((r) => r.width !== expectedWidth);
        if (deviating.length > 0 && bestFreq >= nonEmptyRows.length / 2) {
            malformed.push(index);
        }
    }

    if (empty.length > 0) {
        issues.push({
            type: 'table_empty',
            severity: 'warning',
            detail: `第 ${empty.join('、')} 个表格没有任何单元格内容,可能未生成完整`,
        });
    }
    if (malformed.length > 0) {
        issues.push({
            type: 'table_malformed',
            severity: 'warning',
            detail: `第 ${malformed.join('、')} 个表格存在行列数不一致(疑似缺单元格),请核对表格是否完整`,
        });
    }

    return issues;
};

// ─────────────────────────────────────────────────────────────
// (b) 图表编号连续性
// ─────────────────────────────────────────────────────────────

export interface CaptionNumber {
    /** 章节相对编号的章号;非章节相对时为 null */
    chapter: number | null;
    /** 序号 */
    seq: number;
    raw: string;
}

/**
 * 章节相对编号的分隔符。Word 文档里这一位极易是「看起来像减号但不是减号」的字符:
 * U+2011 不换行连字符(Word 自动替换产生)、U+2010 连字符、U+2012 数字短横、
 * U+2013 短破折号、U+2014 长破折号、U+2015 横线、U+FF0D 全角减号,以及点号变体。
 * 只认 ASCII '-' 会把「图 3‑1」误判成扁平编号「图3」并报「缺少章号」(实测踩过)。
 */
const NUM_SEPARATORS = '\\u002D\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015\\uFF0D.．。·';

/** 从 caption 文本里解析 图3 / 图3-2 / 表 3.2 这类编号 */
export const parseCaptionNumber = (text: string, kind: '图' | '表'): CaptionNumber | null => {
    const plain = (text || '').replace(/<[^>]+>/g, '').trim();
    // 图3-2 / 图3.2 / 图 3-2 / 图 3‑2(各种连字符变体)
    const rel = plain.match(new RegExp(`^${kind}\\s*(\\d+)\\s*[${NUM_SEPARATORS}]\\s*(\\d+)`));
    if (rel) {
        return { chapter: parseInt(rel[1], 10), seq: parseInt(rel[2], 10), raw: plain };
    }
    // 图3 / 图 3
    const flat = plain.match(new RegExp(`^${kind}\\s*(\\d+)`));
    if (flat) {
        return { chapter: null, seq: parseInt(flat[1], 10), raw: plain };
    }
    return null;
};

/**
 * 校验图/表编号是否连续。覆盖 postProcess 在 skeleton+原文自带编号 时跳过重编号的支路。
 * 规则:
 *   - 扁平编号(图1,图2,…):必须从 1 开始且严格递增 1
 *   - 章节相对编号(图1-1,图1-2,图2-1):同章内序号从 1 开始严格递增 1;章号非递减
 */
export const verifyCaptionNumbering = (html: string): IntegrityIssue[] => {
    const issues: IntegrityIssue[] = [];
    const safe = html || '';

    const check = (kind: '图' | '表', className: string) => {
        const re = new RegExp(`<div[^>]*class\\s*=\\s*["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)</div>`, 'gi');
        const nums: CaptionNumber[] = [];
        let m: RegExpExecArray | null;
        while ((m = re.exec(safe)) !== null) {
            const parsed = parseCaptionNumber(m[1], kind);
            if (parsed) nums.push(parsed);
        }
        if (nums.length === 0) return;

        const problems: string[] = [];
        const isRelative = nums.some((n) => n.chapter !== null);

        // 编号断档直接报「缺了哪几个」而不是「这个应该是几号」—— 断档几乎总是
        // 因为对应的图/表整个丢了,直接点名缺失编号比让用户自己推算有用得多。
        const gapText = (from: number, to: number, chapter: number | null): string => {
            const label = (s: number) => (chapter !== null ? `${kind}${chapter}-${s}` : `${kind}${s}`);
            return from === to ? `${label(from)} 缺失` : `${label(from)}~${label(to)} 缺失`;
        };

        if (isRelative) {
            let prevChapter: number | null = null;
            let expectedSeq = 1;
            for (const n of nums) {
                if (n.chapter === null) {
                    problems.push(`${n.raw}(编号格式与其它图表不一致)`);
                    continue;
                }
                if (prevChapter === null || n.chapter !== prevChapter) {
                    if (prevChapter !== null && n.chapter < prevChapter) {
                        problems.push(`${n.raw}(章号回退)`);
                    }
                    prevChapter = n.chapter;
                    expectedSeq = 1;
                }
                if (n.seq > expectedSeq) {
                    problems.push(gapText(expectedSeq, n.seq - 1, n.chapter));
                } else if (n.seq < expectedSeq) {
                    problems.push(`${n.raw}(编号重复或回退)`);
                }
                expectedSeq = n.seq + 1;
            }
        } else {
            let expected = 1;
            for (const n of nums) {
                if (n.seq > expected) {
                    problems.push(gapText(expected, n.seq - 1, null));
                } else if (n.seq < expected) {
                    problems.push(`${n.raw}(编号重复或回退)`);
                }
                expected = n.seq + 1;
            }
        }

        if (problems.length > 0) {
            issues.push({
                type: kind === '图' ? 'figure_numbering_broken' : 'table_numbering_broken',
                severity: 'warning',
                detail: `${kind}编号不连续: ${problems.slice(0, 5).join('、')}${problems.length > 5 ? ` 等 ${problems.length} 处` : ''}`,
            });
        }
    };

    check('图', 'figure-caption');
    check('表', 'table-caption');

    return issues;
};

// ─────────────────────────────────────────────────────────────
// (c) 逐句内容核对
// ─────────────────────────────────────────────────────────────

/** 提取正文句子(去掉表格/图注等结构块后按句末标点切分) */
export const extractSentences = (html: string): string[] => {
    // 防御:上传内容尾部可能带隐藏数据块(公式/结构 JSON),不是正文,不能算句子
    const withoutData = (html || '')
        .replace(/<!--\s*FORMULA_DATA\s*-->[\s\S]*$/, '')
        .replace(/<!--\s*STRUCTURE_DATA\s*-->[\s\S]*$/, '');
    const withoutTables = withoutData.replace(/<table\b[\s\S]*?<\/table>/gi, ' ');
    const withoutCaptions = withoutTables.replace(/<div[^>]*class\s*=\s*["'][^"']*(?:figure|table)-caption[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, ' ');
    const plain = withoutCaptions
        .replace(/<[^>]+>/g, '\n')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&');

    // 标题不参与逐句核对:标题的完整性由骨架层(heading_missing / heading_promoted)负责,
    // 而成稿里的标题会被统一重编号(源文「1.2.1. 三维数据管理功能需求」→ 成稿「1.2.1 …」,
    // 尾点消失),逐字比对必然判它"丢失" —— 会凭空报出几十条并不存在的缺失(实测 24 条)。
    // 判定:带编号前缀 + 短 + 不以句末标点结尾 = 标题行,而非正文句子。
    const isHeadingLine = (s: string): boolean =>
        s.length <= 40
        && !/[。！？!?；;]$/.test(s)
        && /^(?:\d+(?:\s*[.、．]\s*\d+)*\s*[.、．]?|第\s*[一二三四五六七八九十百]+\s*[章节篇部]|[一二三四五六七八九十]+\s*、|[（(]\s*[一二三四五六七八九十\d]+\s*[）)])\s*\S/.test(s);

    return plain
        .split(/(?<=[。！？!?；;])|\n+/)
        .map((s) => s.trim())
        .filter((s) => normalizeForCompare(s).length >= 12) // 太短的片段(标题词、编号)不参与句子核对
        .filter((s) => !isHeadingLine(s));
};

/**
 * 去掉全部标点,只留字词 —— 供「只差标点不算丢失」的兜底比对使用。
 * 装饰符(★ ● ※ …)也算标点:源文标题写「★ 3.2 实施范围」,排版时装饰符
 * 与旧编号一并剥掉,字一个没少却被判成整句丢失(真实文档实测 2 处红条)。
 */
const dropPunctuation = (t: string): string => t.replace(/[.,;:!?()[\]{}"'`~\-—–…·、·]/g, '');

/**
 * 逐句核对:原文的每个句子是否能在成稿里找到。
 * 容忍标点/空白/全半角差异;为容忍 AI 合并短句,采用"归一化后子串包含"判定。
 */
export const verifySentenceCoverage = (
    sourceHtml: string,
    outputHtml: string,
): { issues: IntegrityIssue[]; missingSentences: string[] } => {
    const sourceSentences = extractSentences(sourceHtml);
    if (sourceSentences.length === 0) return { issues: [], missingSentences: [] };

    const outputNorm = normalizeForCompare(outputHtml);
    const outputBare = dropPunctuation(outputNorm);   // 只比字、不比标点的兜底口径
    const missing: string[] = [];

    for (const s of sourceSentences) {
        const key = normalizeForCompare(s);
        if (key.length < 12) continue;
        if (outputNorm.includes(key)) continue;
        let matched = false;
        // 枚举编号被排版吸收:「1. 完成数据标准体系建设…」转成 <li> 后编号由列表结构
        // 表达,正文里只剩句体 —— 剥掉头部枚举标记再找一次(真实实测误报重试+吓人红条)
        // 注意 key 已过 normalizeForCompare:顿号折成逗号、全角括号折半角、空白已删
        const stripped = key.replace(/^(?:(?:\d+|[一二三四五六七八九十]+)[.,、]|\(\d+\))/, '');
        if (stripped !== key && stripped.length >= 10 && outputNorm.includes(stripped)) continue;
        // 句子被提升成标题:排版会把句末标点去掉(源文「（一）准备阶段（2026年4月至6月）。」
        // → 成稿 <h4>（一）准备阶段（2026年4月至6月）</h4>)。只差一个句号就判丢失,
        // 会在公文/方案类文档上批量误报,还是 critical 级红条(七题材跑批实测 4 处)。
        // 故末尾标点不参与匹配 —— 首尾两种剥法组合再找一次。
        const trimTail = (t: string) => t.replace(/[.,;:!?]+$/, '');
        for (const cand of [trimTail(key), trimTail(stripped)]) {
            if (cand !== key && cand.length >= 10 && outputNorm.includes(cand)) { matched = true; break; }
        }
        if (matched) continue;
        // 只差标点 → 不算丢失。排版会在句中把一段切成「标题 + 正文」,切分点上的那个逗号
        // 随之消失(源文「（一）台账与实物是否一致,含表号、量程…」→ 成稿 <h4>（一）台账与实物是否一致</h4>
        // + <p>含表号、量程…</p>)。字一个没少却报 critical 红条,公文/方案类批量踩(实测 3 处)。
        // 判定只放宽标点:词句缺失仍然照报。
        const bare = dropPunctuation(key);
        if (bare.length >= 12 && outputBare.includes(bare)) continue;
        // 长句允许 AI 轻微改写:取首尾片段双侧命中即认为保留
        if (key.length >= 40) {
            const head = key.slice(0, 20);
            const tail = key.slice(-20);
            if (outputNorm.includes(head) && outputNorm.includes(tail)) continue;
        }
        missing.push(s.length > 40 ? `${s.slice(0, 40)}…` : s);
    }

    if (missing.length === 0) return { issues: [], missingSentences: [] };

    const lossPct = missing.length / sourceSentences.length;
    return {
        issues: [{
            type: 'sentences_missing',
            severity: lossPct >= 0.1 ? 'critical' : 'warning',
            detail: `${missing.length} 处原文语句未在成稿中找到(共 ${sourceSentences.length} 句): ${missing.slice(0, 3).map((s) => `「${s}」`).join('、')}${missing.length > 3 ? ` 等` : ''}`,
        }],
        missingSentences: missing,
    };
};

// ─────────────────────────────────────────────────────────────
// 汇总入口
// ─────────────────────────────────────────────────────────────

export interface DeliveryVerification {
    issues: IntegrityIssue[];
    /** 是否存在"可通过重新生成局部来补救"的问题 */
    repairable: boolean;
    missingSentences: string[];
}

/**
 * 交付前完整校验总入口。在 postProcess 与图片还原之后、交付之前调用。
 */
export const verifyBeforeDelivery = (
    sourceHtml: string,
    outputHtml: string,
): DeliveryVerification => {
    const issues: IntegrityIssue[] = [
        ...verifyTableStructure(outputHtml),
        ...verifyCaptionNumbering(outputHtml),
    ];

    const { issues: sentenceIssues, missingSentences } = verifySentenceCoverage(sourceHtml, outputHtml);
    issues.push(...sentenceIssues);

    // 句子缺失才值得触发"重新生成局部";表格/编号问题应由确定性修复处理
    const repairable = missingSentences.length > 0;

    return { issues, repairable, missingSentences };
};
