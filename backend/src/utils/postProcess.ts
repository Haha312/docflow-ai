/**
 * 确定性后处理(P0-3)—— 合并后对全文跑一次,把"编号/标题/图表号"从 AI 手里收回到代码:
 *   (a) enforceSingleTitleAndDemote —— 只保留第一个文档大标题,其后多余 <h1> 降级为 <h2>
 *       (根治"中部小标题被误升成大居中标题")
 *   (b) renumberStructure —— 按所选方案用计数器栈对 <h2>~<h6> 重新盖章(覆盖 AI 产出的号),
 *       同序对 图N/表N 重排(支持 chapter-relative 图{章}-{序})
 *   (c) reconcileImages —— 校验每个 __IMG_N__ 占位恰好出现一次(重复/缺失只报 issue,不改文本)
 *
 * 设计要点:后端无 DOM → 用稳健正则按文档出现顺序遍历;全部【幂等】(先剥旧前缀再盖新号,
 * 盖的号又能被同一套剥离规则识别)。编号只由"最终层级 + 方案"决定,与 AI 是否数错无关。
 */
import { IntegrityIssue } from './integrity';
import { stripHeadingPrefix, normalizeHeadingText, isNonNumberedHeading, isLeadingFrontMatterHeading, isTrailingFrontMatterHeading } from './headingText';
import { SkeletonNode, createSkeletonMatcher } from './skeleton';

export interface PostProcessOptions {
    /** styleConfig.headingNumbering: 'none' | 'decimal' | 'decimal-nested' | 'chinese-hierarchical' | 'chapter' */
    scheme: string;
    /** styleConfig.figureNumbering === 'chapter-relative' */
    figureChapterRelative: boolean;
    /** styleConfig.tableNumbering === 'chapter-relative' */
    tableChapterRelative: boolean;
    /** Object.keys(imageMap) —— 期望出现的图片占位符,用于校验丢失 */
    expectedImagePlaceholders?: string[];
    /** 权威骨架(结构先行)——存在时,标题层级/章数以它为准,而非信任 AI 产出的标签 */
    skeleton?: SkeletonNode[];
    /** 仅当源 Word 标题中存在可信的可见编号时才保留骨架编号;否则按层级重新编号 */
    preserveSourceHeadingNumbers?: boolean;
    /** 源文中的图题/表题清单;用于过滤 AI 多造的图表题,并把漏标的普通段落提升回图表题 */
    sourceCaptions?: SourceCaptionSet;
}

export interface SourceCaption {
    kind: '图' | '表';
    text: string;
    prefix: string;
    title: string;
    normPrefix: string;
    normTitle: string;
}

export interface SourceCaptionSet {
    figures: SourceCaption[];
    tables: SourceCaption[];
}

// ── 中文数字(1-99,够章节用)──
const CN_DIGIT = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const toChineseNumber = (n: number): string => {
    if (n <= 0) return String(n);
    if (n < 10) return CN_DIGIT[n];
    if (n < 20) return '十' + (n % 10 === 0 ? '' : CN_DIGIT[n % 10]);
    if (n < 100) {
        const tens = Math.floor(n / 10);
        const ones = n % 10;
        return CN_DIGIT[tens] + '十' + (ones === 0 ? '' : CN_DIGIT[ones]);
    }
    return String(n);
};

// stripHeadingPrefix / normalizeHeadingText 移至 ./headingText(与 integrity 绊线共用同一口径)。

// ── 剥离图/表题已有编号(图1 / 图1-1 / 表2 等)──
const stripCaptionPrefix = (inner: string, kind: '图' | '表'): string => {
    const re = new RegExp('^(\\s*(?:<(?:strong|b|span|em)\\b[^>]*>\\s*)?)' + kind + '\\s*\\d+(?:[-.]\\d+)*[\\s\\u3000、.::]*', 'i');
    return inner.replace(re, '$1');
};

const sourceCaptionPrefix = (inner: string, kind: '图' | '表'): string => {
    const text = (inner || '').replace(/<[^>]+>/g, '').trim();
    const m = text.match(new RegExp('^' + kind + '\\s*(\\d+(?:[-.]\\d+)*)\\b'));
    return m ? `${kind}${m[1]}` : '';
};

const removeDuplicateEnglishCaptionPrefix = (inner: string): string =>
    inner.replace(
        /^(\s*(?:<(?:strong|b|span|em)\b[^>]*>\s*)?(?:图|表)\s*\d+(?:[-.]\d+)*\s+)(?:Figure|Table)\s+\d+(?:[-.]\d+)*\s*/i,
        '$1'
    );

const decodeBasicEntities = (text: string): string =>
    text
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'");

const stripHtmlToText = (html: string): string =>
    decodeBasicEntities((html || '').replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();

const normalizeCaptionPrefix = (kind: '图' | '表', number = ''): string =>
    `${kind}${number.replace(/\./g, '-').replace(/\s+/g, '')}`;

const normalizeCaptionTitle = (text: string): string =>
    stripHtmlToText(text)
        .replace(/^[图表]\s*\d+(?:[-.]\d+)*[\s\u3000、.：:：]*/i, '')
        .replace(/[（(][A-Za-z_][A-Za-z0-9_\s.-]*[）)]/g, '')
        .replace(/[^0-9a-zA-Z\u4e00-\u9fff]+/g, '')
        .toLowerCase();

const parseCaption = (textOrHtml: string): SourceCaption | null => {
    const text = stripHtmlToText(textOrHtml);
    const m = text.match(/^(图|表)\s*(\d+(?:[-.]\d+)*)[\s\u3000、.：:：]*(.*)$/);
    if (!m) return null;
    const kind = m[1] as '图' | '表';
    const prefix = `${kind}${m[2]}`;
    const title = (m[3] || '').trim();
    return {
        kind,
        text,
        prefix,
        title,
        normPrefix: normalizeCaptionPrefix(kind, m[2]),
        normTitle: normalizeCaptionTitle(text),
    };
};

export const extractSourceCaptions = (html: string): SourceCaptionSet => {
    const figures: SourceCaption[] = [];
    const tables: SourceCaption[] = [];
    const re = /<(p|div|caption)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html || '')) !== null) {
        const caption = parseCaption(m[2]);
        if (!caption) continue;
        if (caption.kind === '图') figures.push(caption);
        else tables.push(caption);
    }
    return { figures, tables };
};

const captionDistance = (a: string, b: string): number => {
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

const captionSimilarity = (a: string, b: string): number => {
    const maxLen = Math.max(a.length, b.length);
    return maxLen === 0 ? 1 : 1 - captionDistance(a, b) / maxLen;
};

const captionScore = (candidate: SourceCaption, expected: SourceCaption): number => {
    let score = candidate.normPrefix === expected.normPrefix ? 12 : 0;
    const ct = candidate.normTitle;
    const et = expected.normTitle;
    if (!et) return !ct ? score + 16 : score - 6;
    if (!ct) return score - 8;
    if (ct === et) return score + 30;
    if (ct.length >= 3 && et.length >= 3 && (ct.includes(et) || et.includes(ct))) return score + 18;
    const sim = captionSimilarity(ct, et);
    return sim >= 0.72 ? score + Math.round(sim * 14) : score;
};

const captionThreshold = (expected: SourceCaption): number =>
    expected.normTitle ? 14 : 10;

interface OutputCaption extends SourceCaption {
    globalIndex: number;
    attrs: string;
    inner: string;
    full: string;
}

const captionListForKind = (sourceCaptions: SourceCaptionSet | undefined, kind: '图' | '表'): SourceCaption[] =>
    kind === '图' ? (sourceCaptions?.figures ?? []) : (sourceCaptions?.tables ?? []);

const isKnownSourceCaption = (caption: SourceCaption, sourceCaptions?: SourceCaptionSet): boolean => {
    const expected = captionListForKind(sourceCaptions, caption.kind);
    if (expected.length === 0) return false;
    return expected.some((item) => captionScore(caption, item) >= captionThreshold(item));
};

const promoteSourceCaptionParagraphs = (html: string, sourceCaptions?: SourceCaptionSet): string => {
    if (!sourceCaptions || (sourceCaptions.figures.length === 0 && sourceCaptions.tables.length === 0)) return html;
    return html.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (full, inner: string) => {
        const caption = parseCaption(inner);
        if (!caption || !isKnownSourceCaption(caption, sourceCaptions)) return full;
        const className = caption.kind === '图' ? 'figure-caption' : 'table-caption';
        return `<div class="${className}">${stripHtmlToText(inner)}</div>`;
    });
};

export const reconcileCaptionsToSource = (
    html: string,
    sourceCaptions?: SourceCaptionSet,
): { text: string; issues: IntegrityIssue[] } => {
    if (!sourceCaptions || (sourceCaptions.figures.length === 0 && sourceCaptions.tables.length === 0)) {
        return { text: html, issues: [] };
    }

    const captions: OutputCaption[] = [];
    const re = /<div\b([^>]*\bclass="[^"]*\b(figure-caption|table-caption)\b[^"]*"[^>]*)>([\s\S]*?)<\/div>/gi;
    let m: RegExpExecArray | null;
    let globalIndex = 0;
    while ((m = re.exec(html || '')) !== null) {
        const parsed = parseCaption(m[3]);
        const kind: '图' | '表' = /figure-caption/i.test(m[1]) ? '图' : '表';
        const fallback = parsed ?? {
            kind,
            text: stripHtmlToText(m[3]),
            prefix: '',
            title: stripHtmlToText(m[3]),
            normPrefix: '',
            normTitle: normalizeCaptionTitle(m[3]),
        };
        captions.push({ ...fallback, kind, globalIndex, attrs: m[1], inner: m[3], full: m[0] });
        globalIndex += 1;
    }

    const selected = new Map<number, SourceCaption>();
    let missing = 0;
    for (const kind of ['图', '表'] as const) {
        const expected = captionListForKind(sourceCaptions, kind);
        if (expected.length === 0) continue;
        const output = captions.filter((caption) => caption.kind === kind);
        let cursor = 0;
        for (const exp of expected) {
            let best: OutputCaption | undefined;
            let bestScore = Number.NEGATIVE_INFINITY;
            for (let i = cursor; i < output.length; i++) {
                const score = captionScore(output[i], exp) - Math.min(8, (i - cursor) * 0.2);
                if (score > bestScore) {
                    best = output[i];
                    bestScore = score;
                }
            }
            if (best && bestScore >= captionThreshold(exp)) {
                selected.set(best.globalIndex, exp);
                cursor = output.indexOf(best) + 1;
            } else {
                missing += 1;
            }
        }
    }

    let pruned = 0;
    let index = 0;
    const text = html.replace(re, (_full, attrs: string) => {
        const expected = selected.get(index);
        index += 1;
        if (!expected) {
            pruned += 1;
            return '';
        }
        return `<div${attrs}>${expected.text}</div>`;
    });

    const issues: IntegrityIssue[] = [];
    if (pruned > 0) {
        issues.push({ type: 'caption_pruned', severity: 'info', detail: `已移除 ${pruned} 个不在源文图表题序列中的多余图表题` });
    }
    if (missing > 0) {
        issues.push({ type: 'caption_missing', severity: 'warning', detail: `源文有 ${missing} 个图表题未能在成稿中精确定位,请核对图表题位置` });
    }
    return { text, issues };
};

// ── 把内容层级 + 计数器栈格式化成方案对应的编号前缀。contentLevel: 1=h2(章) 2=h3 3=h4 ... ──
const formatHeadingNumber = (scheme: string, contentLevel: number, counters: number[]): string => {
    const c = counters; // c[1]=章, c[2]=节, ...
    switch (scheme) {
        case 'decimal':
        case 'decimal-nested':
            return c.slice(1, contentLevel + 1).join('.') + (contentLevel === 1 ? '.' : '');
        case 'chinese-hierarchical':
            if (contentLevel === 1) return toChineseNumber(c[1]) + '、';
            if (contentLevel === 2) return '（' + toChineseNumber(c[2]) + '）';
            if (contentLevel === 3) return c[3] + '.';
            return '(' + c[contentLevel] + ')'; // 第四层及更深: (1)
        case 'chapter':
            if (contentLevel === 1) return '第' + toChineseNumber(c[1]) + '章';
            if (contentLevel === 2) return '第' + toChineseNumber(c[2]) + '节';
            if (contentLevel === 3) return toChineseNumber(c[3]) + '、';
            return c.slice(3, contentLevel + 1).join('.'); // 更深: 退化为小数
        default:
            return '';
    }
};

const formatSkeletonHeadingNumber = (scheme: string, sourceNumber = ''): string => {
    const clean = sourceNumber.trim().replace(/[.\s\u3000]+$/g, '');
    if (!clean) return '';
    const parts = clean.split('.').filter(Boolean).map(x => Number(x)).filter(n => Number.isFinite(n) && n > 0);
    if (parts.length === 0) return clean;
    switch (scheme) {
        case 'decimal':
        case 'decimal-nested':
            return clean + (parts.length === 1 ? '.' : '');
        case 'chinese-hierarchical':
            if (parts.length === 1) return toChineseNumber(parts[0]) + '、';
            if (parts.length === 2) return '（' + toChineseNumber(parts[1]) + '）';
            if (parts.length === 3) return parts[2] + '.';
            return '(' + parts[parts.length - 1] + ')';
        case 'chapter':
            if (parts.length === 1) return '第' + toChineseNumber(parts[0]) + '章';
            if (parts.length === 2) return '第' + toChineseNumber(parts[1]) + '节';
            if (parts.length === 3) return toChineseNumber(parts[2]) + '、';
            return String(parts[parts.length - 1]);
        default:
            return '';
    }
};

// ── 封面/扉页"文档类型"标记行(研究报告 / 毕业论文 …)。丢弃重复标题时,把它紧邻的这种残留行一并清掉。──
const FRONT_MATTER_TYPES = new Set<string>([
    '研究报告', '报告', '毕业论文', '学位论文', '本科毕业论文', '硕士学位论文', '博士学位论文',
    '可行性研究报告', '设计方案', '项目报告', '工作报告', '调研报告', '实施方案', '申报书', '申报指南',
]);
const isFrontMatterTypeLine = (pHtml: string): boolean => {
    const txt = (pHtml || '').replace(/<[^>]+>/g, '').replace(/[\s\u3000]+/g, '').trim();
    return FRONT_MATTER_TYPES.has(txt);
};

const hasClass = (attrs: string, className: string): boolean => {
    const m = (attrs || '').match(/\bclass\s*=\s*"([^"]*)"/i);
    return !!m && m[1].split(/\s+/).some((x) => x.toLowerCase() === className.toLowerCase());
};

const isJournalFrontMatterHeading = (attrs: string): boolean =>
    hasClass(attrs, 'doc-title-en');

/**
 * 标题去重 + 降级(合并后跑一次):
 *  - 第一个 <h1> 视为唯一文档大标题,保留;记下其标准化文本为"基准标题"。
 *  - 其后的 <h1>:
 *      · 文本与基准标题相同 → 判定为"分块边界又吐出来的标题",【整段丢弃】(不再降级成 <h2>,
 *        否则会被 renumberStructure 当成正文章节盖号、并污染封面);若其紧邻一行是
 *        "研究报告"等封面类型行(<p class="cover-meta"> 或纯 <p> 均可),一并丢弃。
 *      · 文本不同 → 维持原"降级为 <h2> 并去 doc-title class"修复(中部小标题被误升)。
 */
export const enforceSingleTitleAndDemote = (html: string): string => {
    let seenTitle = false;
    let canonical = '';
    return html.replace(
        /<h1(\b[^>]*)>([\s\S]*?)<\/h1>(\s*<p\b[^>]*>[\s\S]*?<\/p>)?/gi,
        (_m, attrs: string, inner: string, trailingP?: string) => {
            const trailing = trailingP ?? '';
            if (!seenTitle) {
                seenTitle = true;
                canonical = normalizeHeadingText(inner);
                return `<h1${attrs}>${inner}</h1>${trailing}`;
            }
            if (canonical && normalizeHeadingText(inner) === canonical) {
                // 重复标题 → 丢弃;紧邻的封面类型行(研究报告…)若存在也一并丢弃,否则保留该段
                return trailing && isFrontMatterTypeLine(trailing) ? '' : trailing;
            }
            // 文本不同 → 仍按"误升的小标题"降级为 <h2> 并去 doc-title class
            const cleaned = attrs.replace(/\s*class\s*=\s*"([^"]*)"/i, (_mm, cls: string) => {
                const kept = cls.split(/\s+/).filter((x) => x && x.toLowerCase() !== 'doc-title').join(' ');
                return kept ? ` class="${kept}"` : '';
            });
            return `<h2${cleaned}>${inner}</h2>${trailing}`;
        },
    );
};

/**
 * 按文档顺序遍历 <h2>~<h6> 与 图/表题,用计数器栈重新盖章。
 * - <h1> 永不编号(它是文档标题)。
 * - 进入更高层级时重置更低层级计数。
 * - chapter-relative 图/表号按"当前章号(h2 计数)"分组、章内重排。
 */
export const renumberStructure = (html: string, opts: PostProcessOptions, canonicalTitle = ''): string => {
    const numberedScheme = opts.scheme === 'decimal' || opts.scheme === 'decimal-nested'
        || opts.scheme === 'chinese-hierarchical' || opts.scheme === 'chapter';

    const counters = [0, 0, 0, 0, 0, 0]; // index 1..5 -> content level 1..5 (h2..h6)
    let figGlobal = 0, tabGlobal = 0;       // sequential 模式全局序号
    let figInChapter = 0, tabInChapter = 0; // chapter-relative 模式章内序号
    const currentChapter = () => counters[1];

    // 同时匹配:标题 <hN>…</hN> | 图/表题 <div class="…figure-caption/table-caption…">…</div>
    const re = /<h([1-6])(\b[^>]*)>([\s\S]*?)<\/h\1>|<div\b([^>]*\bclass="[^"]*\b(?:figure-caption|table-caption)\b[^"]*"[^>]*)>([\s\S]*?)<\/div>/gi;

    return html.replace(re, (full, hLevel, hAttrs, hInner, divAttrs, divInner) => {
        // ── 标题 ──
        if (hLevel !== undefined) {
            const level = parseInt(hLevel, 10);
            if (level === 1) return full;                 // 文档标题不编号
            if (isJournalFrontMatterHeading(hAttrs)) return full; // 期刊英文题名是篇首信息,不进正文编号
            // 防御:与文档标题同文本的 h2~h6 视为重复标题残留 → 丢弃且【不计数】,保证编号连续。
            // (enforceSingleTitleAndDemote 已在上游丢弃同文本 <h1>;此处兜住"已是 h2"等绕过路径。)
            if (canonicalTitle && normalizeHeadingText(hInner) === canonicalTitle) return '';
            // 事务性标题 → 保留为标题但【不编号、不计数】,否则会偷走"第1章"(如"1. 目录"把引言挤成第2章)。
            // 位置敏感(修复误判):前置类(目录/摘要/关键词…)仅在「正文第一章之前」才跳过 —— 这样正文里
            // 真有一节叫「关键词/序」(出现在某章之后)仍会正常编号;后置类(致谢…)在文末恒跳过。
            if ((isLeadingFrontMatterHeading(hInner) && counters[1] === 0) || isTrailingFrontMatterHeading(hInner)) {
                const s = stripHeadingPrefix(hInner);
                return `<h${level}${hAttrs}>${s.replace(/^\s+/, '')}</h${level}>`;
            }
            const cl = level - 1;                          // 内容层级: h2->1 h3->2 ...
            if (cl === 1) { figInChapter = 0; tabInChapter = 0; } // 新章 → 章内图表序号归零
            counters[cl] += 1;
            for (let k = cl + 1; k < counters.length; k++) counters[k] = 0;
            if (!numberedScheme) return full;              // none: 不动标题号
            // 防"章0泄漏":尚无正文章(counters[1]===0)时出现的子标题(如摘要下的子节)→ 不编号,
            // 否则会产出"0.1"。与其前置父标题不编号的行为一致。
            if (cl >= 2 && counters[1] === 0) {
                const s = stripHeadingPrefix(hInner);
                return `<h${level}${hAttrs}>${s.replace(/^\s+/, '')}</h${level}>`;
            }
            const skId = (hAttrs || '').match(/\bdata-sk="([^"]+)"/i)?.[1] ?? '';
            const skNode = skId ? opts.skeleton?.find(n => n.id === skId) : undefined;
            const num = opts.preserveSourceHeadingNumbers && skNode?.number
                ? formatSkeletonHeadingNumber(opts.scheme, skNode.number)
                : formatHeadingNumber(opts.scheme, cl, counters);
            const stripped = stripHeadingPrefix(hInner);
            return `<h${level}${hAttrs}>${num} ${stripped.replace(/^\s+/, '')}</h${level}>`;
        }
        // ── 图/表题 ──
        const isFigure = /figure-caption/i.test(divAttrs);
        const kind: '图' | '表' = isFigure ? '图' : '表';
        const existingPrefix = sourceCaptionPrefix(divInner, kind);
        if (opts.skeleton && opts.skeleton.length > 0 && existingPrefix) {
            return `<div${divAttrs}>${removeDuplicateEnglishCaptionPrefix(divInner).replace(/^\s+/, '')}</div>`;
        }
        let num: string;
        // chapter-relative 仅在已进入正文章(currentChapter()>0)时用"{章}-{序}";否则(前置事务性内容里的图)
        // 退回全局序号,避免前置图与正文第一章首图都成"图1-1"而撞号。
        if (isFigure) {
            if (opts.figureChapterRelative && currentChapter() > 0) { figInChapter += 1; num = `${currentChapter()}-${figInChapter}`; }
            else { figGlobal += 1; num = String(figGlobal); }
        } else {
            if (opts.tableChapterRelative && currentChapter() > 0) { tabInChapter += 1; num = `${currentChapter()}-${tabInChapter}`; }
            else { tabGlobal += 1; num = String(tabGlobal); }
        }
        const stripped = stripCaptionPrefix(divInner, kind);
        return `<div${divAttrs}>${kind}${num} ${stripped.replace(/^\s+/, '')}</div>`;
    });
};

/**
 * 校验并【修复】图片占位符,保证每个期望的 __IMG_N__ 在文本中恰好出现一次:
 *  - 重复 → 仅保留首次出现,删除其余(避免同图重复插入);
 *  - 缺失 → 在文末以"附录图"形式补回占位符(随后 restoreImages 会换成真实 <img>)。
 * 说明:没有 source→output 偏移映射,无法把丢失图还原到原位,故统一落附录并标注。
 * 这样"图片是否出现"成为由 imageMap 决定的【代码保证】,与 AI 是否照抄占位符无关。
 * 返回修复后的文本 + issue。(必须在图片还原之前、对仍含占位符的文本运行。)
 */
export const reconcileImages = (html: string, expected?: string[]): { text: string; issues: IntegrityIssue[] } => {
    const issues: IntegrityIssue[] = [];
    if (!expected || expected.length === 0) {
        // 无图片来源(纯文本粘贴、图片 OCR 来源文档 —— 没有真实 imageMap 可还原)时,
        // 任何 <img> 都是幻觉:常见于 AI 把识别文本里提到的"图形/装饰线"当成了图片占位符
        // 直接编出一个 <img> 标签,但它没有对应的真实图片数据,渲染出来就是空白/破图框。
        // 剥掉即可 —— 没有真实图片来源时,保留一个注定渲染失败的 <img> 没有任何价值。
        const strayImgCount = (html.match(/<img\b[^>]*>/gi) || []).length;
        if (strayImgCount === 0) return { text: html, issues };
        const stripped = html.replace(/<img\b[^>]*>/gi, '');
        issues.push({ type: 'image_hallucinated', severity: 'warning', detail: `检测到 ${strayImgCount} 处无来源图片标签(原文本没有嵌入图片),已自动移除` });
        return { text: stripped, issues };
    }

    const countOf = (s: string, key: string): number => s.split(key).length - 1;
    let out = html;

    // 1) 去重:每个期望占位符只保留首次出现
    let duplicated = 0;
    for (const key of expected) {
        if (countOf(out, key) > 1) {
            duplicated += 1;
            let first = true;
            const keyRe = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
            out = out.replace(keyRe, (mm) => (first ? ((first = false), mm) : ''));
        }
    }

    // 2) 缺失:正文中找不到的期望占位符 → 作为附录图补回(保证 presence;位置无法还原)
    const missing = expected.filter((k) => countOf(out, k) === 0);
    if (missing.length > 0) {
        const items = missing.map((k) => `<p>${k}</p>`).join('');
        out += `<p><strong>附录:未能在正文中定位的图片</strong></p>${items}`;
        issues.push({ type: 'image_missing', severity: 'warning', detail: `有 ${missing.length} 张图片未能定位到正文,已作为附录图补回,请核对位置` });
    }
    if (duplicated > 0) {
        issues.push({ type: 'image_duplicated', severity: 'info', detail: `有 ${duplicated} 张图片重复,已只保留首次出现` });
    }
    return { text: out, issues };
};

/**
 * 把输出标题按「文本 + 文档顺序」对齐到权威骨架,根治章节漂移(6→10)与内容缺失:
 *  - 命中骨架 → 强制改写为骨架权威层级(纠正 AI 误升/误降),并打 data-sk 标记;
 *  - 未命中骨架 → 绝不留在 h2(章级):降一级吸收为子节(封顶 h6),杜绝"误升小节 → 多出章";
 *  - 骨架中存在但输出里没出现的节点 → 报缺失(含章级则 critical),作为内容缺失信号。
 * 仅处理 h2~h6(h1=文档标题不动);须在 enforceSingleTitleAndDemote 之后、renumberStructure 之前运行。
 * 【幂等】:先剥掉旧 data-sk 再重新打,可重复运行。
 */
export const reconcileHeadingsToSkeleton = (
    html: string,
    skeleton?: SkeletonNode[],
    docTitleNorm = '',
): { text: string; issues: IntegrityIssue[]; demoted: number; missing: SkeletonNode[] } => {
    const issues: IntegrityIssue[] = [];
    if (!skeleton || skeleton.length === 0) return { text: html, issues, demoted: 0, missing: [] };

    const matcher = createSkeletonMatcher(skeleton);
    // 标题陷阱:若源文标题被标成 Word "标题1",它会成为骨架节点;但输出里标题是 <h1 class=doc-title>,
    // 而 reconcile 只扫 h2~h6 → 该节点永远匹配不上 → 对完全正确的文档误报"缺章"并跳过计费。
    // 这里先用输出文档标题的文本把对应骨架节点"消费"掉(顺序匹配器会吃掉最靠前的同名节点)。
    if (docTitleNorm) matcher.match(docTitleNorm);
    let demoted = 0;
    const re = /<h([2-6])(\b[^>]*)>([\s\S]*?)<\/h\1>/gi;
    const text = html.replace(re, (_full, lvlStr: string, attrs: string, inner: string) => {
        const cleanAttrs = (attrs || '').replace(/\s*data-sk="[^"]*"/i, '');
        if (isJournalFrontMatterHeading(cleanAttrs)) return `<h${lvlStr}${cleanAttrs}>${inner}</h${lvlStr}>`;
        const m = matcher.match(normalizeHeadingText(inner));
        if (m) {
            const lvl = m.node.outputLevel;
            return `<h${lvl}${cleanAttrs} data-sk="${m.node.id}">${inner}</h${lvl}>`;
        }
        // 不在骨架中的标题:只把【章级 h2】降为子节(h3)——它们才会让章数膨胀(6→10);
        // 更深的 h3~h6 不动(不影响章数,且避免重复运行时反复下沉,保证幂等)。
        const cur = parseInt(lvlStr, 10);
        if (cur === 2) {
            demoted += 1;
            return `<h3${cleanAttrs}>${inner}</h3>`;
        }
        return `<h${cur}${cleanAttrs}>${inner}</h${cur}>`;
    });

    const missing = matcher.unusedNodes();
    if (demoted > 0) {
        // 这是「成功的规整」而非风险:AI 多吐的非源文标题被正确降级,内容并未丢失。
        // 故用 info(不触发前端的警告横幅),仅留作明细可见 —— 否则几乎每篇文档都会弹"内容差异较大"的吓人提示。
        issues.push({ type: 'heading_demoted', severity: 'info', detail: `已将 ${demoted} 个不在源文结构中的多余标题降级(规整,未丢内容)` });
    }
    if (missing.length > 0) {
        // 章级缺失只数「需编号的章」(排除目录/摘要/前言等前置事务性标题,避免它们的对不上误判为缺章)。
        const chapMissing = missing.filter((n) => n.outputLevel === 2 && !isNonNumberedHeading(n.text)).length;
        const chapTotal = skeleton.filter((n) => n.outputLevel === 2 && !isNonNumberedHeading(n.text)).length;
        // 阈值化:个别标题对不上(改写/顺序/前置)→ warning(不阻断计费);大面积缺章(>15%)才 critical。
        // 真正的大段内容缺失另有 charRetention + early_stop(章数差≥30%)兜底,不依赖这里的 critical。
        const critical = chapMissing > Math.max(1, Math.ceil(0.15 * chapTotal));
        issues.push({
            type: 'heading_missing',
            severity: critical ? 'critical' : 'warning',
            detail: `源文 ${missing.length} 个标题在输出中缺失(其中章级 ${chapMissing} 个),疑似内容缺失`,
        });
    }
    return { text, issues, demoted, missing };
};

/**
 * 入口:对合并后的全文跑确定性后处理。返回处理后的文本 + 新增的完整性 issue。
 * 注意:传入的 html 此时仍保留 __IMG_N__ 占位符(图片还原放到最外层、postProcess 之后统一做),
 * 这样 reconcileImages 才能看到并修复占位符。
 */
export const postProcess = (html: string, opts: PostProcessOptions): { text: string; issues: IntegrityIssue[] } => {
    // 基准标题 = 第一个 <h1> 的标准化文本(供降级/重编号阶段判定"重复标题")。
    const canonicalTitle = normalizeHeadingText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
    let out = enforceSingleTitleAndDemote(html);
    // 结构先行:若有权威骨架,先把标题层级对齐到骨架(否则信任 AI 标签,保持旧行为)。
    // 传入文档标题文本 → reconcile 据此先消费"标题节点",避免标题被当成缺失的章。
    const skel = reconcileHeadingsToSkeleton(out, opts.skeleton, canonicalTitle);
    out = skel.text;
    out = promoteSourceCaptionParagraphs(out, opts.sourceCaptions);
    out = renumberStructure(out, opts, canonicalTitle);
    const captionRec = reconcileCaptionsToSource(out, opts.sourceCaptions);
    out = captionRec.text;
    const rec = reconcileImages(out, opts.expectedImagePlaceholders);
    // data-sk 仅是 reconcile→renumber 过程中的内部对齐标记,不应泄漏进权威全文(预览 DOM / 可复制可导出的 HTML)。
    // 在最后统一抹掉,使其只存在于处理窗口内部。
    const cleaned = rec.text.replace(/(<h[1-6]\b[^>]*?)\s+data-sk="[^"]*"([^>]*>)/gi, '$1$2');
    return { text: cleaned, issues: [...skel.issues, ...captionRec.issues, ...rec.issues] };
};
