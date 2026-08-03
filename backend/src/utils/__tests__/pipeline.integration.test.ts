/**
 * 确定性管线集成测试(不依赖数据库,也不调用 AI)。
 *
 * 动机:此前只有单元测试,各层单看都对,但「补回 / 标题晋升 / 统一重编号 / 图题裁剪」
 * 这几层之间有耦合 —— 跨层回归只能等用户在浏览器里踩到(真实案例:标题被补回成双份)。
 * 这里用真实文档裁出的夹具跑完整条确定性链路,断言硬指标,把这类回归挡在推送之前。
 *
 * 链路与 routes/generate.ts 保持一致:
 *   目录剔除 → 列表题注还原 → 表格冻结 →〔模拟 AI 劣化〕→ 表格解冻 → 占位符倾倒清理
 *   → 补回#1 → postProcess#1 → 补回#2 →(有产出则)postProcess#2 → 交付前校验
 * 「模拟 AI 劣化」是确定性的:按固定规则丢块、改写、重编号,复现模型真实会犯的错。
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
    freezeTables, unfreezeTables, restoreMissingContent, restoreListCaptions, stripTocBlock,
} from '../restoreContent';
import { postProcess, extractSourceCaptions, type PostProcessOptions } from '../postProcess';
import { buildSkeleton, derivePseudoHeadings } from '../skeleton';
import { verifyBeforeDelivery } from '../verifyDelivery';
import { normalizeHeadingText } from '../headingText';

const fixture = (name: string): string =>
    fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

/**
 * 模拟模型输出的劣化:复现实测中模型真实会犯的几类错,且完全确定性(便于回归)。
 *  1. 把「编号开头的短段落」变成真标题并重编号(尾点消失)—— 标题双份 bug 的触发条件
 *  2. 每 7 个正文段落丢 1 个 —— 内容缺失
 *  3. 每 5 个图片占位符丢 1 个 —— 占位符缺失
 *  4. 轻微改写部分段落(替换个别词)—— 逐字比对失效
 */
const simulateAiOutput = (frozenSource: string): string => {
    const blocks = frozenSource.match(/<(p|h[1-6]|table|ul|ol)\b[\s\S]*?<\/\1>/gi) ?? [];
    let paraIdx = 0;
    let imgIdx = 0;
    let headingSeq: number[] = [0, 0, 0];
    const out: string[] = [];
    for (const b of blocks) {
        const text = b.replace(/<[^>]+>/g, '').trim();
        const isHeadingLike = /^(?:\d+(?:\.\d+)*\s*[.、．]?|第\s*[一二三四五六七八九十]+\s*[章节篇])\s*\S/.test(text) && text.length <= 40 && !/[。;；]$/.test(text);
        if (/^<(?:p|h[1-6])\b/i.test(b) && isHeadingLike) {
            // 模型把它识别成标题并重新编号(注意:尾点被去掉,与源文文本不再逐字相同)
            const depth = (text.match(/^\d+(?:\.\d+)*/)?.[0].split('.').length ?? 1);
            const lv = Math.min(depth, 3);
            headingSeq[lv - 1] += 1;
            for (let k = lv; k < 3; k += 1) headingSeq[k] = 0;
            const num = headingSeq.slice(0, lv).filter((n) => n > 0).join('.');
            const title = text.replace(/^(?:\d+(?:\.\d+)*\s*[.、．]?|第\s*[一二三四五六七八九十]+\s*[章节篇])\s*/, '');
            out.push(`<h${lv + 1}>${num} ${title}</h${lv + 1}>`);
            continue;
        }
        if (/^<p\b/i.test(b)) {
            paraIdx += 1;
            if (paraIdx % 7 === 0) continue;                       // 丢段落
            if (/__IMG_\d+__/.test(b)) {
                imgIdx += 1;
                if (imgIdx % 5 === 0) continue;                    // 丢图片占位符
            }
            out.push(b.replace(/实现/g, '达成').replace(/主要/g, '重点')); // 轻微改写
            continue;
        }
        out.push(b);
    }
    return out.join('\n');
};

/** 跑完整条确定性链路,返回成稿与校验结论 */
const runPipeline = (rawSource: string) => {
    let source = stripTocBlock(rawSource);
    const caps0 = extractSourceCaptions(source);
    const maxNum = (list: { normPrefix: string }[]) => list.reduce((mx, c) => {
        const n = parseInt((c.normPrefix || '').replace(/^[图表]/, '').split('-')[0], 10);
        return Number.isFinite(n) ? Math.max(mx, n) : mx;
    }, 0);
    source = restoreListCaptions(source, maxNum(caps0.figures), maxNum(caps0.tables)).text;

    const skeleton = buildSkeleton(derivePseudoHeadings(source));
    const opts: PostProcessOptions = {
        scheme: 'decimal-nested',
        figureChapterRelative: true,
        tableChapterRelative: true,
        sourceCaptions: extractSourceCaptions(source),
        skeleton,
    };

    const frozen = freezeTables(source);
    let text = unfreezeTables(simulateAiOutput(frozen.text), frozen.map);
    text = text.replace(/(?:__IMG_\d+__\s*){8,}/g, '\n');

    text = restoreMissingContent(source, text).text;
    let pp = postProcess(text, opts);
    const r2 = restoreMissingContent(source, pp.text);
    if (r2.issues.length > 0) pp = postProcess(r2.text, opts);
    else pp = { ...pp, text: r2.text };

    return { source, final: pp.text, delivery: verifyBeforeDelivery(source, pp.text) };
};

const headingsOf = (html: string): string[] =>
    [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)].map((m) => m[2].replace(/<[^>]+>/g, '').trim());

const countOf = (html: string, re: RegExp): number => (html.match(re) ?? []).length;

describe.each([
    ['无标题样式文档(标题是带编号的普通段落)', 'hunan-source.html'],
    ['规整文档(标题样式 + 列表形态题注 + 合并单元格表)', 'gim-source.html'],
])('确定性管线 · %s', (_label, file) => {
    const src = fixture(file);
    const { source, final, delivery } = runPipeline(src);

    it('标题元素不重复:同一标题文本不出现两个 <hN>', () => {
        const norms = headingsOf(final).map(normalizeHeadingText).filter((t) => t.length >= 2);
        const dup = norms.filter((t, i) => norms.indexOf(t) !== i);
        expect([...new Set(dup)]).toEqual([]);
    });

    // 关键守卫:补回引擎可能把标题补成【普通段落】,只查 <hN> 会漏掉 ——
    // 用户实测踩到的正是这种(同一标题一个小号段落 + 一个正常标题)。
    // 故按「编号+题文」在全文中的出现次数判定,与元素类型无关。
    it('源文标题在成稿中只出现一次(补回不得制造第二份)', () => {
        const norm = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, '').replace(/[.、．]/g, '');
        const finalNorm = norm(final);
        const dups: string[] = [];
        for (const h of derivePseudoHeadings(source)) {
            const t = norm(h.text);
            if (t.length < 5) continue;
            const n = finalNorm.split(t).length - 1;
            if (n > 1) dups.push(`${h.text} ×${n}`);
        }
        expect(dups).toEqual([]);
    });

    it('编号不叠加:不出现「1. 1 标题」式双重编号', () => {
        const bad = headingsOf(final).filter((h) => /^\d[\d.]*\s+\d[\d.]*\s/.test(h));
        expect(bad).toEqual([]);
    });

    it('表格数量与源文一致(冻结保真,不多不少)', () => {
        expect(countOf(final, /<table\b/gi)).toBe(countOf(source, /<table\b/gi));
    });

    it('合并单元格属性不丢失', () => {
        expect(countOf(final, /rowspan=/gi)).toBe(countOf(source, /rowspan=/gi));
    });

    it('图片占位符:每个恰好出现一次,不丢不重', () => {
        const want = [...new Set(source.match(/__IMG_\d+__/g) ?? [])];
        const dupes = want.filter((k) => countOf(final, new RegExp(k, 'g')) > 1);
        const missing = want.filter((k) => !final.includes(k));
        expect({ dupes, missing }).toEqual({ dupes: [], missing: [] });
    });

    it('不残留表格占位符(__TBL_N__ 必须全部换回真表)', () => {
        expect(countOf(final, /__TBL_\d+__/g)).toBe(0);
    });

    it('正文不丢失:交付校验无 critical', () => {
        expect(delivery.issues.filter((i) => i.severity === 'critical')).toEqual([]);
    });

    it('内容保留率 ≥95%', () => {
        const plain = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length;
        expect(plain(final) / plain(source)).toBeGreaterThanOrEqual(0.95);
    });
});
