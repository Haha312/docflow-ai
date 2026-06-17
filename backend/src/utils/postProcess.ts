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

export interface PostProcessOptions {
    /** styleConfig.headingNumbering: 'none' | 'decimal' | 'decimal-nested' | 'chinese-hierarchical' | 'chapter' */
    scheme: string;
    /** styleConfig.figureNumbering === 'chapter-relative' */
    figureChapterRelative: boolean;
    /** styleConfig.tableNumbering === 'chapter-relative' */
    tableChapterRelative: boolean;
    /** Object.keys(imageMap) —— 期望出现的图片占位符,用于校验丢失 */
    expectedImagePlaceholders?: string[];
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

// ── 剥离标题已有的编号前缀(中文序号 / 第N章节 / 阿拉伯小数 / 括号数字),与 prompts.ts 的 strip 规则一致 ──
// 允许前面有一个可选的内联开标签(<strong>/<b>/<span>/<em>),把前缀剥在它之后。
const HEADING_PREFIX = '(?:第[一二三四五六七八九十百零\\d]+[章节篇部回]|[一二三四五六七八九十百零]+[、.]|[（(]\\s*[一二三四五六七八九十百零\\d]+\\s*[）)]|\\d+(?:\\.\\d+)*\\.?)';
const stripHeadingPrefix = (inner: string): string => {
    const re = new RegExp('^(\\s*(?:<(?:strong|b|span|em)\\b[^>]*>\\s*)?)' + HEADING_PREFIX + '[\\s\\u3000]*', 'i');
    return inner.replace(re, '$1');
};

// ── 剥离图/表题已有编号(图1 / 图1-1 / 表2 等)──
const stripCaptionPrefix = (inner: string, kind: '图' | '表'): string => {
    const re = new RegExp('^(\\s*(?:<(?:strong|b|span|em)\\b[^>]*>\\s*)?)' + kind + '\\s*\\d+(?:[-.]\\d+)*[\\s\\u3000、.::]*', 'i');
    return inner.replace(re, '$1');
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

/**
 * 只保留第一个出现的 <h1>(文档大标题);其后所有 <h1> 一律降级为 <h2> 并去掉 doc-title class。
 * 文档没有大标题时,第一个 <h1> 视为标题保留。
 */
export const enforceSingleTitleAndDemote = (html: string): string => {
    let seenTitle = false;
    return html.replace(/<h1(\b[^>]*)>([\s\S]*?)<\/h1>/gi, (_m, attrs: string, inner: string) => {
        if (!seenTitle) {
            seenTitle = true;
            return `<h1${attrs}>${inner}</h1>`;
        }
        // 去掉 doc-title class 再降级
        const cleaned = attrs.replace(/\s*class\s*=\s*"([^"]*)"/i, (_mm, cls: string) => {
            const kept = cls.split(/\s+/).filter((x) => x && x.toLowerCase() !== 'doc-title').join(' ');
            return kept ? ` class="${kept}"` : '';
        });
        return `<h2${cleaned}>${inner}</h2>`;
    });
};

/**
 * 按文档顺序遍历 <h2>~<h6> 与 图/表题,用计数器栈重新盖章。
 * - <h1> 永不编号(它是文档标题)。
 * - 进入更高层级时重置更低层级计数。
 * - chapter-relative 图/表号按"当前章号(h2 计数)"分组、章内重排。
 */
export const renumberStructure = (html: string, opts: PostProcessOptions): string => {
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
            const cl = level - 1;                          // 内容层级: h2->1 h3->2 ...
            if (cl === 1) { figInChapter = 0; tabInChapter = 0; } // 新章 → 章内图表序号归零
            counters[cl] += 1;
            for (let k = cl + 1; k < counters.length; k++) counters[k] = 0;
            if (!numberedScheme) return full;              // none: 不动标题号
            const num = formatHeadingNumber(opts.scheme, cl, counters);
            const stripped = stripHeadingPrefix(hInner);
            return `<h${level}${hAttrs}>${num} ${stripped.replace(/^\s+/, '')}</h${level}>`;
        }
        // ── 图/表题 ──
        const isFigure = /figure-caption/i.test(divAttrs);
        const kind: '图' | '表' = isFigure ? '图' : '表';
        let num: string;
        if (isFigure) {
            if (opts.figureChapterRelative) { figInChapter += 1; num = `${currentChapter() || 1}-${figInChapter}`; }
            else { figGlobal += 1; num = String(figGlobal); }
        } else {
            if (opts.tableChapterRelative) { tabInChapter += 1; num = `${currentChapter() || 1}-${tabInChapter}`; }
            else { tabGlobal += 1; num = String(tabGlobal); }
        }
        const stripped = stripCaptionPrefix(divInner, kind);
        return `<div${divAttrs}>${kind}${num} ${stripped.replace(/^\s+/, '')}</div>`;
    });
};

/**
 * 校验图片占位符:每个期望的 __IMG_N__ 应恰好出现一次。重复/缺失只报 issue,不改文本
 * (按源位置补回属 P1)。
 */
export const reconcileImages = (html: string, expected?: string[]): IntegrityIssue[] => {
    const issues: IntegrityIssue[] = [];
    if (!expected || expected.length === 0) return issues;
    const counts = new Map<string, number>();
    const re = /__IMG_\d+__/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) counts.set(m[0], (counts.get(m[0]) ?? 0) + 1);

    const missing = expected.filter((k) => !counts.has(k));
    const duplicated = [...counts.entries()].filter(([k, n]) => n > 1 && expected.includes(k)).map(([k]) => k);
    if (missing.length > 0) {
        issues.push({ type: 'image_missing', severity: 'warning', detail: `有 ${missing.length} 张图片在排版结果中丢失,请核对` });
    }
    if (duplicated.length > 0) {
        issues.push({ type: 'image_duplicated', severity: 'info', detail: `有 ${duplicated.length} 张图片被重复插入,请核对` });
    }
    return issues;
};

/**
 * 入口:对合并后的全文跑确定性后处理。返回处理后的文本 + 新增的完整性 issue。
 */
export const postProcess = (html: string, opts: PostProcessOptions): { text: string; issues: IntegrityIssue[] } => {
    let out = enforceSingleTitleAndDemote(html);
    out = renumberStructure(out, opts);
    const issues = reconcileImages(out, opts.expectedImagePlaceholders);
    return { text: out, issues };
};
