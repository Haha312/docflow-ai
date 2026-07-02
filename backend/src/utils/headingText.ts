/**
 * 标题文本标准化 —— 供 postProcess(编号/去重)与 integrity(结构绊线)共用,
 * 确保"什么算重复标题"的口径两边完全一致(否则绊线会漏检 postProcess 丢弃的东西)。
 */

// 标题已有的编号前缀(中文序号 / 第N章节 / 阿拉伯小数 / 括号数字),与 prompts.ts 的 strip 规则一致。
// 允许前面有一个可选的内联开标签(<strong>/<b>/<span>/<em>),把前缀剥在它之后。
// 注意(修复内容损坏):阿拉伯数字这一支必须以「真正的分隔符」结尾才算编号前缀 ——
//   `.` / `、` 或其后紧跟空白。否则会把正文里的数字当成编号吃掉:
//   "2024年度总结"→"年度总结"、"5G通信技术"→"G通信技术"。要求分隔符即可避免。
export const HEADING_PREFIX =
    '(?:第[一二三四五六七八九十百零\\d]+[章节篇部回]|[一二三四五六七八九十百零]+[、.]|[（(]\\s*[一二三四五六七八九十百零\\d]+\\s*[）)]|\\d+(?:\\.\\d+)*(?:[.、]|(?=[\\s\\u3000])))';

export const stripHeadingPrefix = (inner: string): string => {
    const re = new RegExp('^(\\s*(?:<(?:strong|b|span|em)\\b[^>]*>\\s*)?)' + HEADING_PREFIX + '[\\s\\u3000]*', 'i');
    let out = inner;
    for (let i = 0; i < 4; i += 1) {
        const next = out.replace(re, '$1');
        if (next === out) break;
        if (next.replace(/<[^>]+>/g, '').replace(/[\s\u3000]+/g, '').length === 0) break;
        out = next;
    }
    return out;
};

/**
 * 标题判等用的标准化:去标签 → 去编号前缀 → 去全部空白。
 * 用于判定"分块边界重新吐出的标题"(与文档大标题同文本),大小写/空白/编号无关。
 */
export const normalizeHeadingText = (inner: string): string =>
    stripHeadingPrefix((inner || '').replace(/<[^>]+>/g, '')).replace(/[\s\u3000]+/g, '').trim();

// ── 事务性标题(在 Word 里常被标成 Heading 1,但绝不应算作正文「第N章 / 1.」)──
// 分「前置」(目录/摘要/前言…,只在正文第一章之前才不编号)与「后置」(致谢…,总在末尾、恒不编号)。
// 拆分目的:正文里若真有一节叫「关键词/序」(出现在某章之后),应正常编号,而不是被无条件跳过。
// (注意:引言/绪论 是正文第一章,不在此列;前言≠引言。)
const LEADING_FRONT_MATTER = new Set<string>([
    '目录', '目次', 'contents', 'tableofcontents',
    '摘要', '中文摘要', '英文摘要', '内容摘要', 'abstract',
    '关键词', 'keywords',
    '前言', '序言', '序', 'preface', 'foreword',
    '声明', '原创性声明', '版权声明',
]);
const TRAILING_FRONT_MATTER = new Set<string>([
    '致谢', '致谢辞', 'acknowledgement', 'acknowledgements', 'acknowledgments',
]);

const key = (textOrNorm: string): string => normalizeHeadingText(textOrNorm).toLowerCase();

/** 前置事务性标题(目录/摘要/前言/关键词/声明…)。仅当其出现在正文第一章之前时才应被跳过编号。 */
export const isLeadingFrontMatterHeading = (textOrNorm: string): boolean => LEADING_FRONT_MATTER.has(key(textOrNorm));
/** 后置事务性标题(致谢…)。出现在文末,恒不编号。 */
export const isTrailingFrontMatterHeading = (textOrNorm: string): boolean => TRAILING_FRONT_MATTER.has(key(textOrNorm));

/** 是否为「不编号」事务性标题(前置或后置)——用于章数统计时排除,口径与编号端一致。 */
export const isNonNumberedHeading = (textOrNorm: string): boolean => {
    const k = key(textOrNorm);
    return LEADING_FRONT_MATTER.has(k) || TRAILING_FRONT_MATTER.has(k);
};
