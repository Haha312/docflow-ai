/**
 * 交付前确定性补回(P1):AI 丢掉的内容,不再靠重试求它补——原文在我们手里,
 * 丢了什么、丢在哪,都能精确定位,直接按原位插回去。
 *
 * 动机(真实文档实测):对一份 47 图题 / 8 表的建设方案,分块重试跑满 3 轮后
 * 仍丢 11 个图题、3 张表、2 个标题、9 处整句。重试是概率修复,这里是确定性修复。
 *
 * 与既有各层的分工:
 *   - validateChunkOutput 重试   = 生成中的概率性挽救(便宜,先试)
 *   - 本文件                    = 生成后的确定性补回(重试没救回来的,原样插回原位)
 *   - reconcileMissingTables    = 表格附录兜底(本文件之后跑,只处理连原位都定不了的)
 *   - verifyBeforeDelivery      = 最终逐项核对(在补回之后跑,验证的是真正交付的成稿)
 *
 * 核心算法:把原文切成有序块(段落/标题/表格/图题/图片占位符),按顺序在成稿里
 * 逐块对账(归一化匹配,容忍标点/空白/连字符差异);丢失块插到「上一个找到的块」
 * 后面 —— 连续丢失的内容(如 图片+图题+说明段)自动按原文顺序成组补回原位。
 * 另对「成稿里存在但单元格数少于原文」的表格做整表替换(修「表格没画完整」)。
 */

import type { IntegrityIssue } from './integrity';
import { normalizeHeadingText } from './headingText';

// ─────────────────────────────────────────────────────────────
// 带索引映射的归一化
// ─────────────────────────────────────────────────────────────

/**
 * 归一化规则与 verifyDelivery.normalizeForCompare 一致(去标签/实体/空白,全角标点折半角,
 * 小写化),但逐字符行走,同时记录每个归一化字符对应的原始下标 —— 匹配位置能映射回原文。
 */
const PUNCT_FOLD: Record<string, string> = {
    '，': ',', '、': ',',           // ，、
    '。': '.', '．': '.',           // 。．
    '；': ';', '：': ':',           // ；：
    '？': '?', '！': '!',           // ？！
    '（': '(', '）': ')',           // （）
    '“': '"', '”': '"', '‘': '"', '’': '"', // 智能引号
};

export const buildNormIndex = (html: string): { norm: string; map: number[] } => {
    const s = html || '';
    const out: string[] = [];
    const map: number[] = [];
    let i = 0;
    while (i < s.length) {
        const c = s[i];
        if (c === '<') {
            const j = s.indexOf('>', i);
            i = j === -1 ? s.length : j + 1;
            continue;
        }
        if (c === '&') {
            const seg = s.slice(i, i + 6).toLowerCase();
            if (seg.startsWith('&nbsp;')) { i += 6; continue; }
            if (seg.startsWith('&amp;')) { out.push('&'); map.push(i); i += 5; continue; }
            if (seg.startsWith('&lt;')) { out.push('<'); map.push(i); i += 4; continue; }
            if (seg.startsWith('&gt;')) { out.push('>'); map.push(i); i += 4; continue; }
            if (seg.startsWith('&quot;')) { out.push('"'); map.push(i); i += 6; continue; }
        }
        if (/\s/.test(c)) { i += 1; continue; }
        out.push(PUNCT_FOLD[c] ?? c.toLowerCase());
        map.push(i);
        i += 1;
    }
    return { norm: out.join(''), map };
};

// ─────────────────────────────────────────────────────────────
// 原文分块
// ─────────────────────────────────────────────────────────────

export type SourceBlockType = 'heading' | 'paragraph' | 'table' | 'caption' | 'image' | 'list';

export interface SourceBlock {
    type: SourceBlockType;
    /** 原始 HTML(整块,含外层标签) */
    html: string;
    /** 归一化文本 key(用于在成稿中对账) */
    key: string;
    /** heading 专用:源级别 */
    level?: number;
    /** caption 专用:图 or 表 */
    captionKind?: '图' | '表';
    /** image 专用:占位符 token(原样,如 __IMG_12__) */
    imageToken?: string;
}

const BLOCK_TAG_RE = /<(p|h[1-6]|table|ul|ol|div)\b[^>]*>/gi;

/** 从 openEnd 起找同名标签的配对闭合(深度计数,处理嵌套列表/表格) */
const findMatchingClose = (s: string, tag: string, openEnd: number): number => {
    const re = new RegExp(`<${tag}\\b[^>]*>|</${tag}>`, 'gi');
    re.lastIndex = openEnd;
    let depth = 1;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
        if (m[0][1] === '/') {
            depth -= 1;
            if (depth === 0) return m.index + m[0].length;
        } else {
            depth += 1;
        }
    }
    return -1;
};

export const tokenizeSourceBlocks = (sourceHtml: string): SourceBlock[] => {
    // 隐藏数据尾巴(公式/结构 JSON)不是正文,不参与对账
    const s = (sourceHtml || '')
        .replace(/<!--\s*FORMULA_DATA\s*-->[\s\S]*$/, '')
        .replace(/<!--\s*STRUCTURE_DATA\s*-->[\s\S]*$/, '');

    const blocks: SourceBlock[] = [];
    let cursor = 0;
    BLOCK_TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BLOCK_TAG_RE.exec(s)) !== null) {
        if (m.index < cursor) continue; // 嵌套在已消费块内部的标签,跳过
        const tag = m[1].toLowerCase();
        const end = findMatchingClose(s, tag, m.index + m[0].length);
        if (end === -1) break; // 源文未闭合(不应发生),放弃剩余
        const html = s.slice(m.index, end);
        const { norm: key } = buildNormIndex(html);

        if (tag === 'table') {
            blocks.push({ type: 'table', html, key });
        } else if (/^h[1-6]$/.test(tag)) {
            blocks.push({ type: 'heading', html, key, level: parseInt(tag[1], 10) });
        } else if (tag === 'ul' || tag === 'ol') {
            blocks.push({ type: 'list', html, key });
        } else if (/^__img_\d+__$/.test(key)) {
            const token = html.match(/__IMG_\d+__/)?.[0];
            if (token) blocks.push({ type: 'image', html, key, imageToken: token });
        } else if (/^[图表]\d/.test(key)) {
            blocks.push({ type: 'caption', html, key, captionKind: key[0] as '图' | '表' });
        } else {
            // 图片占位符与图题挤在同一段(Word 里图和题注常同段,如
            // <p>__IMG_28__图4-20成果评分细则定制样例图</p>):拆成 图片块 + 图题块。
            // 不拆的话整段按普通段落对账,图题永远不会被识别成 caption ——
            // 编号校验看不见它,补回时也只会补成普通段落(真实文档实测踩过)。
            const tokens = html.match(/__IMG_\d+__/g) ?? [];
            const restKey = key.replace(/__img_\d+__/g, '');
            if (tokens.length > 0 && /^[图表]\d/.test(restKey)) {
                for (const tk of tokens) {
                    blocks.push({ type: 'image', html: `<p>${tk}</p>`, key: tk.toLowerCase(), imageToken: tk });
                }
                const inner = html.replace(/^<[^>]+>/, '').replace(/<\/[^>]+>$/, '').replace(/__IMG_\d+__/g, '').trim();
                blocks.push({ type: 'caption', html: `<p>${inner}</p>`, key: restKey, captionKind: restKey[0] as '图' | '表' });
            } else {
                blocks.push({ type: 'paragraph', html, key });
            }
        }

        cursor = end;
        BLOCK_TAG_RE.lastIndex = end;
    }
    return blocks;
};

// ─────────────────────────────────────────────────────────────
// 表格冻结:表格根本不进 AI(与图片占位符同门架构)
// ─────────────────────────────────────────────────────────────
//
// 动机(真实文档实测):同一份 8 表文档三次生成,成稿表格数 8→11→15 —— AI 每次
// 换着花样改写/压缩/拆分表格,提示词约束无效,事后相似度配对在重度改写下也会失配。
// 唯一可靠的保真方式:发给 AI 前把整表抽出换成 __TBL_N__ 占位符,生成后原样换回。
// AI 只负责决定占位符(=表格)在版面里的位置,表格内容 100% 等于原文。

export interface FrozenTables {
    /** 表格已替换为 <p>__TBL_N__</p> 的文本 */
    text: string;
    /** token → 原表 HTML */
    map: Record<string, string>;
}

export const freezeTables = (html: string): FrozenTables => {
    const s = html || '';
    const map: Record<string, string> = {};
    const parts: string[] = [];
    let cursor = 0;
    let n = 0;
    const re = /<table\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s)) !== null) {
        if (m.index < cursor) continue; // 嵌套表:随外层整体冻结
        const end = findMatchingClose(s, 'table', m.index + m[0].length);
        if (end === -1) break; // 源文未闭合(不应发生),剩余部分原样保留
        const token = `__TBL_${n}__`;
        n += 1;
        map[token] = s.slice(m.index, end);
        parts.push(s.slice(cursor, m.index), `<p>${token}</p>`);
        cursor = end;
        re.lastIndex = end;
    }
    parts.push(s.slice(cursor));
    return { text: parts.join(''), map };
};

export const unfreezeTables = (html: string, map: Record<string, string>): string => {
    if (Object.keys(map).length === 0) return html || '';
    const seen = new Set<string>();
    return (html || '').replace(
        /<p\b[^>]*>\s*(__TBL_\d+__)\s*<\/p>|(__TBL_\d+__)/g,
        (full, wrapped: string | undefined, bare: string | undefined) => {
            const token = wrapped ?? bare ?? '';
            const table = map[token];
            if (!table) return full;          // AI 编造的编号:原样保留,交给校验暴露
            if (seen.has(token)) return '';   // AI 重复吐出的占位符:只还原第一处
            seen.add(token);
            return table;
        }
    );
    // AI 弄丢的占位符不在此兜底 —— restoreMissingContent 会把对应源表按原位补回
};

// ─────────────────────────────────────────────────────────────
// 不完整表格整表替换
// ─────────────────────────────────────────────────────────────

const cellCount = (tableHtml: string): number => (tableHtml.match(/<t[dh]\b/gi) ?? []).length;

/** 表格的单元格文本集(归一化、去空),用于相似度比对 */
const tableCellKeys = (tableHtml: string): string[] => {
    const cells: string[] = [];
    const re = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(tableHtml)) !== null) {
        const k = buildNormIndex(m[1]).norm;
        if (k) cells.push(k);
    }
    return cells;
};

/**
 * 表格相似度:共享单元格数 / 较小表的单元格数。
 * 整表文本包含/被包含视为满分(未改写的截断表)。
 * 为什么不用整表文本匹配:AI 会改写/压缩表格内容,整表指纹一改就断,导致
 * 原文表被误判「缺失」而重复插入 —— 真实文档实测中 3 张表因此双份并存。
 * 单元格粒度下,即使部分单元格被改写,未动的单元格仍能撑起匹配。
 */
const tableSimilarity = (srcKey: string, srcCells: string[], outKey: string, outCells: string[]): number => {
    if (srcKey && outKey && (srcKey.includes(outKey) || outKey.includes(srcKey))) return 1;
    if (srcCells.length === 0 || outCells.length === 0) return 0;
    const outSet = new Set(outCells);
    const shared = srcCells.filter((c) => outSet.has(c)).length;
    return shared / Math.min(srcCells.length, outCells.length);
};

/** 相似度达到该值才认定"同一张表"。阈值不能低:同类配置表(如服务器版/客户端版)会共享表头单元格。 */
const TABLE_MATCH_THRESHOLD = 0.5;

interface TableReconcileResult {
    text: string;
    /** 被整表替换的成稿表格序号(1-based) */
    replaced: number[];
    /** 已匹配到成稿表格的源表下标(在 sourceTables 数组中的下标) */
    matchedSource: Set<number>;
}

/**
 * 源表 × 成稿表 全对相似度 + 按分数降序贪心配对(避免"服务器配置表"错配到
 * "客户端配置表"—— 各自的真身分数必然更高,先到先得)。
 * 配对成功且成稿版单元格更少 → 整表替换回原文版(修「表格没画完整」);
 * 没配上的源表由调用方按原位补回。
 */
const reconcileOutputTables = (sourceTables: SourceBlock[], outputHtml: string): TableReconcileResult => {
    if (sourceTables.length === 0) return { text: outputHtml, replaced: [], matchedSource: new Set() };

    interface OutTable { html: string; start: number; end: number; cells: string[]; key: string; }
    const outTables: OutTable[] = [];
    const re = /<table\b[\s\S]*?<\/table>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(outputHtml)) !== null) {
        outTables.push({
            html: m[0], start: m.index, end: m.index + m[0].length,
            cells: tableCellKeys(m[0]), key: buildNormIndex(m[0]).norm,
        });
    }

    const srcCells = sourceTables.map((t) => tableCellKeys(t.html));
    const pairs: { score: number; si: number; oi: number }[] = [];
    for (let si = 0; si < sourceTables.length; si += 1) {
        for (let oi = 0; oi < outTables.length; oi += 1) {
            const score = tableSimilarity(sourceTables[si].key, srcCells[si], outTables[oi].key, outTables[oi].cells);
            if (score >= TABLE_MATCH_THRESHOLD) pairs.push({ score, si, oi });
        }
    }
    pairs.sort((a, b) => b.score - a.score);

    const matchedSource = new Set<number>();
    const usedOut = new Set<number>();
    const replacements: { start: number; end: number; html: string; ordinal: number }[] = [];
    for (const p of pairs) {
        if (matchedSource.has(p.si) || usedOut.has(p.oi)) continue;
        matchedSource.add(p.si);
        usedOut.add(p.oi);
        const out = outTables[p.oi];
        if (cellCount(out.html) < cellCount(sourceTables[p.si].html)) {
            replacements.push({ start: out.start, end: out.end, html: sourceTables[p.si].html, ordinal: p.oi + 1 });
        }
    }

    if (replacements.length === 0) return { text: outputHtml, replaced: [], matchedSource };

    replacements.sort((a, b) => a.start - b.start);
    const parts: string[] = [];
    let last = 0;
    for (const r of replacements) {
        parts.push(outputHtml.slice(last, r.start), r.html);
        last = r.end;
    }
    parts.push(outputHtml.slice(last));
    return { text: parts.join(''), replaced: replacements.map((r) => r.ordinal), matchedSource };
};

// ─────────────────────────────────────────────────────────────
// 丢失块原位补回
// ─────────────────────────────────────────────────────────────

const CLOSER_RE = /<\/(p|h[1-6]|div|li|ul|ol|table|td|th|tr)>/gi;

/** 从 fromRaw 起找最近的元素边界(闭合标签后)。落在表格/列表内部时跳到该容器之后。 */
const resolveInsertPos = (raw: string, fromRaw: number): number => {
    CLOSER_RE.lastIndex = fromRaw;
    const m = CLOSER_RE.exec(raw);
    if (!m) return raw.length;
    const tag = m[1].toLowerCase();
    if (tag === 'td' || tag === 'th' || tag === 'tr') {
        const tEnd = raw.indexOf('</table>', m.index);
        return tEnd === -1 ? raw.length : tEnd + '</table>'.length;
    }
    if (tag === 'li') {
        const ulEnd = raw.indexOf('</ul>', m.index);
        const olEnd = raw.indexOf('</ol>', m.index);
        const candidates = [ulEnd, olEnd].filter((x) => x !== -1);
        if (candidates.length === 0) return raw.length;
        return Math.min(...candidates) + 5; // '</ul>' 与 '</ol>' 同长
    }
    return m.index + m[0].length;
};

/** 丢失块 → 应插入的 HTML(caption 段落转成 caption div,与成稿约定一致) */
const restoreHtml = (block: SourceBlock): string => {
    if (block.type === 'caption') {
        const inner = block.html.replace(/^<[^>]+>/, '').replace(/<\/[^>]+>$/, '');
        const cls = block.captionKind === '表' ? 'table-caption' : 'figure-caption';
        return `<div class="${cls}">${inner}</div>`;
    }
    if (block.type === 'heading') {
        const inner = block.html.replace(/^<[^>]+>/, '').replace(/<\/[^>]+>$/, '');
        // 成稿约定 h1 = 文档大标题,章节从 h2 起 —— 源级别 +1(与 skeleton 的 outputLevel 一致)。
        // 若走 skeleton 路径,postProcess 的 reconcileHeadingsToSkeleton 会再校正到权威级别。
        const level = Math.min((block.level ?? 1) + 1, 6);
        return `<h${level}>${inner}</h${level}>`;
    }
    return block.html;
};

const MAX_RESTORES = 200;

export interface RestoreResult {
    text: string;
    issues: IntegrityIssue[];
    restoredCounts: Partial<Record<SourceBlockType, number>>;
}

export const restoreMissingContent = (sourceHtml: string, outputHtml: string): RestoreResult => {
    const blocks = tokenizeSourceBlocks(sourceHtml);
    if (blocks.length === 0) return { text: outputHtml, issues: [], restoredCounts: {} };

    // 表格对账先做(整表替换不改变其余内容的相对位置,后续索引基于替换后的文本重建)
    const sourceTables = blocks.filter((b) => b.type === 'table');
    const { text: afterTables, replaced, matchedSource } = reconcileOutputTables(sourceTables, outputHtml);

    const { norm: outNorm, map } = buildNormIndex(afterTables);
    const srcNormLen = blocks.reduce((n, b) => n + b.key.length, 0);

    // 成稿相对原文几乎为空 = 生成本身失败,逐块补回等于把整篇原文塞回去,没有意义 ——
    // 交给整体完整性报告去暴露。注意只做「相对」判断且要求原文有一定体量:
    // 绝对字数下限会把正常的短文档全部挡在补回之外(实测踩过)。
    if (srcNormLen >= 500 && outNorm.length < srcNormLen * 0.1) {
        return { text: afterTables, issues: [], restoredCounts: {} };
    }

    // 成稿标题集(判「标题是否存在」必须只看标题标签 —— 标题文本常出现在图表题/正文里,
    // 全文搜文本会把「表5-6 网络配置表」误当成「网络配置」这一节还在)
    const outHeadingNorms: string[] = [];
    {
        const re = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(afterTables)) !== null) {
            const n = normalizeHeadingText(m[1]);
            if (n) outHeadingNorms.push(n);
        }
    }

    // 成稿图表题集(判「图题是否存在」同样必须只看图题形态的元素 —— 图题文本还会出现在
    // 图目录、正文引用里,全文搜文本会误判「还在」而跳过补回;真实文档实测:被
    // reconcileCaptionsToSource 误删的 图4-20 因目录里有同名文本,二次补回被这样漏掉)
    const outCaptionKeys: string[] = [];
    {
        const divRe = /<div\b[^>]*class="[^"]*\b(?:figure|table)-caption\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
        let m: RegExpExecArray | null;
        while ((m = divRe.exec(afterTables)) !== null) {
            const k = buildNormIndex(m[1]).norm;
            if (k) outCaptionKeys.push(k);
        }
        // postProcess 之前的成稿里图题还可能是普通段落形态
        const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
        while ((m = pRe.exec(afterTables)) !== null) {
            const k = buildNormIndex(m[1]).norm.replace(/^(?:__img_\d+__)+/, '');
            if (/^[图表]\d/.test(k)) outCaptionKeys.push(k);
        }
    }
    // 图题 key 去编号(比对时忽略编号 —— 成稿图题可能已被统一重编号,编号对不上
    // 不代表图题丢了;编号的对错由 renumber/verifyCaptionNumbering 负责)
    const stripCapNum = (k: string): string =>
        k.replace(/^[图表]\d+(?:[-.‐-―－]\d+)*[,.:]*/, '');

    interface Insertion { pos: number; html: string; type: SourceBlockType; }
    const insertions: Insertion[] = [];
    const restoredCounts: Partial<Record<SourceBlockType, number>> = {};
    let cursor = 0; // outNorm 上的顺序对账游标
    let tableOrdinal = 0; // 当前表格块在 sourceTables 中的下标(与 matchedSource 对齐)

    const markRestore = (block: SourceBlock) => {
        if (insertions.length >= MAX_RESTORES) return;
        const rawFrom = cursor === 0 ? 0 : map[cursor - 1] + 1;
        const pos = cursor === 0 ? 0 : resolveInsertPos(afterTables, rawFrom);
        if (process.env.RESTORE_DEBUG) {
            console.log(`[RDBG] restore ${block.type} "${block.key.slice(0, 24)}" cursor=${cursor}/${outNorm.length} rawFrom=${rawFrom} pos=${pos}/${afterTables.length}`);
        }
        insertions.push({ pos, html: restoreHtml(block), type: block.type });
        restoredCounts[block.type] = (restoredCounts[block.type] ?? 0) + 1;
    };

    const debugAdvance = (block: SourceBlock, from: number, to: number) => {
        if (process.env.RESTORE_DEBUG && to - from > 500) {
            console.log(`[RDBG] JUMP ${block.type} "${block.key.slice(0, 24)}" cursor ${from} -> ${to} (+${to - from})`);
        }
    };

    // 大幅前跳旁证:成稿后部常有与前部重复的文本(封面公司名 vs 文末落款、正文短语 vs
    // 报价表),单调游标一旦误跳到那里就再也回不来,之后所有补回都会锚到文末
    // (真实文档实测:封面公司名匹配到落款,游标 26→9520,24 处补回全堆在结尾)。
    // 跳幅超过窗口时,用后续第一个能找到的可对账块验证:它若在跳点之前就能找到,
    // 说明真实阅读位置没到那里 —— 拒绝此次推进,当作「内容被挪位」处理。
    const JUMP_WINDOW = 1500;
    const corroborateJump = (bi: number, target: number): boolean => {
        if (target - cursor <= JUMP_WINDOW) return true;
        for (let j = bi + 1; j < blocks.length; j += 1) {
            const nb = blocks[j];
            if (nb.type === 'heading' || nb.type === 'table') continue;
            if (nb.key.length < 8) continue;
            const probe = nb.key.length >= 40 ? nb.key.slice(0, 20) : nb.key;
            const nHit = outNorm.indexOf(probe, cursor);
            if (nHit < 0) continue;        // 这块找不到,换下一块当旁证
            return nHit >= target - 40;    // 旁证块也在跳点附近/之后 → 跳是真的
        }
        return true; // 无旁证可查:无从否证,按原逻辑接受
    };

    for (let bi = 0; bi < blocks.length; bi += 1) {
        const block = blocks[bi];
        const key = block.key;

        if (block.type === 'heading') {
            const hNorm = normalizeHeadingText(block.html);
            if (hNorm.length < 2) continue;
            const present = outHeadingNorms.some((o) => o.includes(hNorm) || hNorm.includes(o));
            if (!present) markRestore(block);
            continue; // 标题不推进文本游标(它在成稿中的位置由骨架层保证)
        }

        if (block.type === 'image') {
            if (block.imageToken && !afterTables.includes(block.imageToken)) markRestore(block);
            else {
                // 占位符存在 → 把游标推进到它之后,让后续丢失块(典型:图题)插在图片后面
                const idx = outNorm.indexOf(key, cursor);
                if (idx >= cursor) { debugAdvance(block, cursor, idx + key.length); cursor = idx + key.length; }
            }
            continue;
        }

        // 表格:凡在上面的相似度配对中匹配到成稿表格的(含已整表替换的)都算存在;
        // 连相似的都找不到才是真缺失 → 原位补回。不再依赖整表文本包含匹配
        // (AI 一改写就断,是此前表格双份并存的根因)。
        if (block.type === 'table') {
            const ord = tableOrdinal;
            tableOrdinal += 1;
            if (matchedSource.has(ord)) {
                const idx = outNorm.indexOf(key, cursor);
                if (idx >= cursor) { debugAdvance(block, cursor, idx + key.length); cursor = idx + key.length; } // 游标能推进就推进,推不了不强求
                continue;
            }
            markRestore(block);
            continue;
        }

        // 图题:按元素级存在性判定(见 outCaptionKeys 注释),且比对忽略编号
        if (block.type === 'caption') {
            if (key.length < 3) continue;
            const srcTitle = stripCapNum(key);
            const present = outCaptionKeys.some((k) => {
                if (k.includes(key) || key.includes(k)) return true; // 整题一致(含编号)
                if (srcTitle.length >= 4) {
                    const t = stripCapNum(k);
                    return t.length >= 3 && (t.includes(srcTitle) || srcTitle.includes(t));
                }
                return false;
            });
            const idx = outNorm.indexOf(key, cursor);
            if (present) {
                if (idx >= cursor && corroborateJump(bi, idx)) { debugAdvance(block, cursor, idx + key.length); cursor = idx + key.length; } // 游标能推进就推进
                continue;
            }
            markRestore(block);
            continue;
        }

        // 段落 / 列表:顺序对账。下限 5:无样式 Word 的手打短标题(如「4.1 亮点」=5 字符)
        // 也是段落,曾因下限 10 直接漏出对账 → 整节标题彻底丢失(真实文档实测踩过)。
        // 更短的(如「其他」)仍排除 —— 有序游标 + 全文既存检查兜底不了那么泛的串。
        const minLen = 5;
        if (key.length < minLen) continue;

        const hit = outNorm.indexOf(key, cursor);
        if (hit >= cursor) {
            // 旁证不过 → 撞上了成稿后部的重复文本:视为「内容被挪位」,不补也不动游标
            if (corroborateJump(bi, hit)) { debugAdvance(block, cursor, hit + key.length); cursor = hit + key.length; }
            continue;
        }

        // 完整 key 在游标之前出现过 → 内容被挪位而非丢失;不插(避免重复),也不动游标
        if (outNorm.indexOf(key) >= 0) continue;

        // 长块:只补「完全消失」的,部分存在的不补。
        // 首尾都命中 → 轻度改写,视为存在(与 verifyDelivery 的句子容忍口径一致);
        // 只有开头命中 → 中段被改写:补回会与改写稿双份并存,比不补更糟 ——
        // 不插,交给 verifySentenceCoverage 如实报告「哪句没找到」让用户自己核对。
        if (key.length >= 40) {
            const head = key.slice(0, 20);
            const tail = key.slice(-20);
            const hi = outNorm.indexOf(head, cursor);
            const ti = hi >= cursor ? outNorm.indexOf(tail, hi) : -1;
            if (hi >= cursor && ti > hi) {
                if (corroborateJump(bi, ti)) {
                    debugAdvance(block, cursor, ti + tail.length);
                    cursor = ti + tail.length;
                }
                continue;
            }
            if (outNorm.indexOf(head) >= 0) continue;
        }

        markRestore(block);
    }

    const issues: IntegrityIssue[] = [];
    let text = afterTables;

    if (insertions.length > 0) {
        // 按插入点稳定排序后一次性重建(同一锚点的多个块保持原文相对顺序)
        insertions.sort((a, b) => a.pos - b.pos);
        const parts: string[] = [];
        let last = 0;
        for (const ins of insertions) {
            parts.push(text.slice(last, ins.pos), '\n', ins.html);
            last = ins.pos;
        }
        parts.push(text.slice(last));
        text = parts.join('');

        const label: Record<SourceBlockType, string> = {
            heading: '标题', paragraph: '段落', table: '表格', caption: '图表题', image: '图片', list: '列表',
        };
        const summary = (Object.entries(restoredCounts) as [SourceBlockType, number][])
            .map(([t, n]) => `${label[t]} ${n} 处`)
            .join('、');
        issues.push({
            type: 'content_restored',
            severity: 'info',
            detail: `检测到成稿缺失原文内容,已自动按原位补回(${summary}),请核对补回内容的位置是否合适`,
        });
    }

    if (replaced.length > 0) {
        issues.push({
            type: 'table_restored',
            severity: 'info',
            detail: `第 ${replaced.join('、')} 个表格生成不完整(单元格缺失),已用原文表格整表替换`,
        });
    }

    return { text, issues, restoredCounts };
};
