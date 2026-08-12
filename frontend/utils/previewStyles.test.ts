import { describe, it, expect } from 'vitest';
import { PRESETS } from '../constants';
import { generatePreviewStyles } from './previewStyles';
import { DocPreset } from '../types';

const styleOf = (id: DocPreset) => PRESETS.find((p) => p.id === id)!.styleConfig;

/** 从生成的 CSS 里取某个选择器的声明块 */
const ruleOf = (css: string, selector: string) => {
    const i = css.indexOf(selector + ' {');
    if (i < 0) return null;
    return css.slice(i, css.indexOf('}', i));
};

describe('预览样式生成', () => {
    it('每个预设都能生成样式,且页边距来自预设本身', () => {
        for (const p of PRESETS) {
            const css = generatePreviewStyles(p.styleConfig, true);
            expect(css, p.title).toContain('#preview-content');
            expect(css, p.title).toContain('.a4-page');
        }
    });

    // 回归:出版物正文行距是固定 18pt,封面标题 30pt 继承下来会把两行压在一起。
    // 导出的 .docx 里 .doc-title 本就不套固定行距,预览必须一致,否则「所见即所得」是假的。
    it('文档大标题自带行距,不继承正文的固定磅值行距', () => {
        const css = generatePreviewStyles(styleOf(DocPreset.CREATIVE), true);
        const rule = ruleOf(css, '#preview-content .doc-title');
        expect(rule).toBeTruthy();
        expect(rule).toMatch(/line-height:\s*1\.3/);
    });

    it('固定磅值行距的预设,标题行距不小于其字号', () => {
        for (const p of PRESETS) {
            const lh = p.styleConfig.lineHeight || '';
            const m = /^([\d.]+)\s*(pt|px)$/.exec(lh.trim());
            if (!m) continue;                       // 倍数行距不会压字,跳过
            const css = generatePreviewStyles(p.styleConfig, true);
            const rule = ruleOf(css, '#preview-content .doc-title')!;
            const lhm = /line-height:\s*([\d.]+)/.exec(rule);
            expect(lhm, `${p.title} 的 .doc-title 缺少显式行距`).toBeTruthy();
            const titlePt = parseFloat(p.styleConfig.h1Size || '26pt');
            // 比例行距 × 字号 必须 ≥ 字号本身,才不会两行叠字
            expect(parseFloat(lhm![1]) * titlePt, p.title).toBeGreaterThanOrEqual(titlePt);
        }
    });

    it('多栏预设在分页态把分栏加在纸张上,而不是外层容器', () => {
        const journal = styleOf(DocPreset.ACADEMIC_JOURNAL);
        expect(journal.columns).toBeGreaterThan(1);
        const paginated = generatePreviewStyles(journal, true);
        const flat = generatePreviewStyles(journal, false);
        expect(ruleOf(paginated, '#preview-content .a4-page')).toContain('column-count');
        expect(ruleOf(flat, '#preview-content .a4-page')).not.toContain('column-count');
    });
});

// Word 的倍数行距乘的是字体自身行高,CSS 的 line-height 乘的是字号,两者差一个固有比值。
// 期刊预设写 1.0(单倍),预览若原样用 1.0,会比导出的 Word 挤 14% —— 字挨字,且每页多塞几行。
describe('倍数行距按字体换算,与 Word 对齐', () => {
    const lh = (css: string) => {
        const rule = ruleOf(css, '#preview-content')!;
        return /line-height:\s*([^;\n]+)/.exec(rule)![1].trim();
    };

    it('宋体系:单倍行距渲染为 1.14em,不是 1.0', () => {
        const journal = styleOf(DocPreset.ACADEMIC_JOURNAL);
        expect(journal.lineHeight).toBe('1.0');
        expect(parseFloat(lh(generatePreviewStyles(journal, true)))).toBeCloseTo(1.14, 2);
    });

    it('雅黑系:比值更大(1.32)', () => {
        const web = styleOf(DocPreset.MINIMALIST);
        const expected = parseFloat(web.lineHeight) * 1.32;
        expect(parseFloat(lh(generatePreviewStyles(web, true)))).toBeCloseTo(expected, 2);
    });

    it('固定磅值行距原样保留(公文 28 磅不能被乘)', () => {
        const gov = styleOf(DocPreset.CORPORATE);
        expect(gov.lineHeight).toContain('pt');
        expect(lh(generatePreviewStyles(gov, true))).toBe(gov.lineHeight);
    });

    it('所有预设的行距都不小于字体自然行高,不会挤在一起', () => {
        for (const p of PRESETS) {
            const v = lh(generatePreviewStyles(p.styleConfig, true));
            if (/pt|px/.test(v)) continue;                 // 固定值另论
            expect(parseFloat(v), p.title).toBeGreaterThanOrEqual(1.14);
        }
    });
});

// 期刊表格必须是三线表:只有顶线、表头下线、底线,没有竖线、行间没有横线。
// 之前所有预设共用全网格样式,期刊那份画成了网格表 —— 投稿会被退。
describe('期刊三线表', () => {
    const journalCss = () => generatePreviewStyles(styleOf(DocPreset.ACADEMIC_JOURNAL), true);

    it('期刊预设声明了三线表', () => {
        expect(styleOf(DocPreset.ACADEMIC_JOURNAL).tableStyle).toBe('three-line');
    });

    it('单元格四边不画线,表头下方补一条线', () => {
        const css = journalCss();
        expect(css).toContain('#preview-content th, #preview-content td { border: none;');
        expect(css).toMatch(/tr:first-child th[^}]*border-bottom/);
    });

    it('表格自身只有顶线和底线', () => {
        const rule = ruleOf(journalCss(), '#preview-content table')!;
        expect(journalCss()).toMatch(/#preview-content table \{ border-top:[^}]*border-bottom:/);
        expect(rule).toBeTruthy();
    });

    it('其他预设仍是全网格,不受影响', () => {
        const threeLineRule = '#preview-content th, #preview-content td { border: none;';
        for (const p of PRESETS) {
            if (p.styleConfig.tableStyle === 'three-line') continue;
            const css = generatePreviewStyles(p.styleConfig, true);
            expect(css, p.title).not.toContain(threeLineRule);
            expect(ruleOf(css, '#preview-content th, #preview-content td'), p.title).toContain('border: 1px solid');
        }
    });
});
