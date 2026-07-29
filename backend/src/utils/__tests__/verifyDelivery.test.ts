import { describe, it, expect } from 'vitest';
import {
    parseTableRows,
    verifyTableStructure,
    parseCaptionNumber,
    verifyCaptionNumbering,
    extractSentences,
    verifySentenceCoverage,
    verifyBeforeDelivery,
    normalizeForCompare,
} from '../verifyDelivery';

describe('normalizeForCompare', () => {
    it('全角/半角标点与空白差异应视为等价', () => {
        expect(normalizeForCompare('各部门，要落实到位。'))
            .toBe(normalizeForCompare('各部门, 要落实到位.'));
    });

    it('去标签与实体', () => {
        expect(normalizeForCompare('<p>甲&nbsp;乙&amp;丙</p>')).toBe('甲乙&丙');
    });
});

describe('parseTableRows', () => {
    it('按 colspan 累加行宽', () => {
        const html = `<table><tr><td colspan="2">a</td><td>b</td></tr><tr><td>c</td><td>d</td><td>e</td></tr></table>`;
        const rows = parseTableRows(html);
        expect(rows).toHaveLength(2);
        expect(rows[0]).toEqual({ width: 3, cellCount: 2 });
        expect(rows[1]).toEqual({ width: 3, cellCount: 3 });
    });

    it('th 与 td 同等计入', () => {
        const rows = parseTableRows(`<table><tr><th>h1</th><th>h2</th></tr></table>`);
        expect(rows[0]).toEqual({ width: 2, cellCount: 2 });
    });
});

describe('verifyTableStructure', () => {
    it('结构完整的表格不报错', () => {
        const html = `<table>
            <tr><th>方法</th><th>准确率</th></tr>
            <tr><td>基线</td><td>82%</td></tr>
            <tr><td>本文</td><td>96%</td></tr>
        </table>`;
        expect(verifyTableStructure(html)).toEqual([]);
    });

    it('缺单元格 → table_malformed', () => {
        const html = `<table>
            <tr><th>方法</th><th>准确率</th><th>召回率</th></tr>
            <tr><td>基线</td><td>82%</td><td>80%</td></tr>
            <tr><td>本文</td><td>96%</td></tr>
        </table>`;
        const issues = verifyTableStructure(html);
        expect(issues.map((i) => i.type)).toContain('table_malformed');
    });

    it('未闭合表格 → table_unclosed(critical)', () => {
        const html = `<table><tr><td>a</td><td>b</td></tr>`;
        const issues = verifyTableStructure(html);
        const unclosed = issues.find((i) => i.type === 'table_unclosed');
        expect(unclosed).toBeDefined();
        expect(unclosed!.severity).toBe('critical');
    });

    it('空表 → table_empty', () => {
        const html = `<table><tbody></tbody></table>`;
        const issues = verifyTableStructure(html);
        expect(issues.map((i) => i.type)).toContain('table_empty');
    });

    it('合法的 rowspan 合并表不应误报', () => {
        // 第2行因 rowspan 少一个 td,但众数行宽仍为 3,偏离行只有 1 行
        const html = `<table>
            <tr><td rowspan="2">合并</td><td>b</td><td>c</td></tr>
            <tr><td>d</td><td>e</td></tr>
            <tr><td>f</td><td>g</td><td>h</td></tr>
            <tr><td>i</td><td>j</td><td>k</td></tr>
        </table>`;
        const issues = verifyTableStructure(html);
        // 允许报 malformed(rowspan 无法在行内判定),但绝不能报 unclosed/empty
        expect(issues.map((i) => i.type)).not.toContain('table_unclosed');
        expect(issues.map((i) => i.type)).not.toContain('table_empty');
    });
});

describe('parseCaptionNumber', () => {
    it('扁平编号', () => {
        expect(parseCaptionNumber('图3 实验结果', '图')).toMatchObject({ chapter: null, seq: 3 });
    });

    it('章节相对编号(短横线/点)', () => {
        expect(parseCaptionNumber('图3-2 对比', '图')).toMatchObject({ chapter: 3, seq: 2 });
        expect(parseCaptionNumber('表2.1 汇总', '表')).toMatchObject({ chapter: 2, seq: 1 });
    });

    it('无编号返回 null', () => {
        expect(parseCaptionNumber('实验结果对比', '图')).toBeNull();
    });
});

describe('verifyCaptionNumbering', () => {
    it('连续扁平编号不报错', () => {
        const html = `
            <div class="figure-caption">图1 甲</div>
            <div class="figure-caption">图2 乙</div>
            <div class="figure-caption">图3 丙</div>`;
        expect(verifyCaptionNumbering(html)).toEqual([]);
    });

    it('跳号 → figure_numbering_broken', () => {
        const html = `
            <div class="figure-caption">图1 甲</div>
            <div class="figure-caption">图3 乙</div>`;
        const issues = verifyCaptionNumbering(html);
        expect(issues.map((i) => i.type)).toContain('figure_numbering_broken');
        expect(issues[0].detail).toContain('应为 图2');
    });

    it('重号 → 报错', () => {
        const html = `
            <div class="table-caption">表1 甲</div>
            <div class="table-caption">表1 乙</div>`;
        const issues = verifyCaptionNumbering(html);
        expect(issues.map((i) => i.type)).toContain('table_numbering_broken');
    });

    it('章节相对编号:同章递增、跨章重置,合法不报错', () => {
        const html = `
            <div class="figure-caption">图1-1 甲</div>
            <div class="figure-caption">图1-2 乙</div>
            <div class="figure-caption">图2-1 丙</div>`;
        expect(verifyCaptionNumbering(html)).toEqual([]);
    });

    it('章节相对编号:同章内跳号 → 报错', () => {
        const html = `
            <div class="figure-caption">图1-1 甲</div>
            <div class="figure-caption">图1-3 乙</div>`;
        const issues = verifyCaptionNumbering(html);
        expect(issues.map((i) => i.type)).toContain('figure_numbering_broken');
    });

    it('无图注时不报错', () => {
        expect(verifyCaptionNumbering('<p>正文</p>')).toEqual([]);
    });
});

describe('extractSentences', () => {
    it('按句末标点切分,过滤过短片段', () => {
        const html = '<p>为进一步加强全市安全生产管理,决定开展专项检查。各部门须于本月二十日前完成自查并上报结果。</p>';
        const sentences = extractSentences(html);
        expect(sentences).toHaveLength(2);
    });

    it('表格与图注内容不参与句子核对', () => {
        const html = `<table><tr><td>这是一段足够长的表格单元格内容不应被当作正文句子</td></tr></table>`;
        expect(extractSentences(html)).toEqual([]);
    });
});

describe('verifySentenceCoverage', () => {
    const source = '<p>为进一步加强全市安全生产管理,决定在全市范围内开展专项检查工作。各部门须于本月二十日前完成自查并上报结果。</p>';

    it('内容完整保留 → 无问题', () => {
        const output = '<h2>一、工作目标</h2><p>为进一步加强全市安全生产管理,决定在全市范围内开展专项检查工作。</p><p>各部门须于本月二十日前完成自查并上报结果。</p>';
        const { issues, missingSentences } = verifySentenceCoverage(source, output);
        expect(missingSentences).toEqual([]);
        expect(issues).toEqual([]);
    });

    it('标点差异不算丢失', () => {
        const output = '<p>为进一步加强全市安全生产管理，决定在全市范围内开展专项检查工作。</p><p>各部门须于本月二十日前完成自查并上报结果。</p>';
        expect(verifySentenceCoverage(source, output).missingSentences).toEqual([]);
    });

    it('整句丢失 → sentences_missing', () => {
        const output = '<p>为进一步加强全市安全生产管理,决定在全市范围内开展专项检查工作。</p>';
        const { issues, missingSentences } = verifySentenceCoverage(source, output);
        expect(missingSentences).toHaveLength(1);
        expect(issues[0].type).toBe('sentences_missing');
    });

    it('丢失比例高 → critical', () => {
        const longSource = Array.from({ length: 20 }, (_, i) =>
            `<p>这是第${i + 1}段需要被完整保留下来的正文内容不能丢失。</p>`).join('');
        const output = '<p>这是第1段需要被完整保留下来的正文内容不能丢失。</p>';
        const { issues } = verifySentenceCoverage(longSource, output);
        expect(issues[0].severity).toBe('critical');
    });
});

describe('verifyBeforeDelivery', () => {
    it('干净成稿 → 无问题、不需修复', () => {
        const source = '<p>为进一步加强全市安全生产管理,决定在全市范围内开展专项检查工作。</p>';
        const output = '<h1 class="doc-title">通知</h1><p>为进一步加强全市安全生产管理,决定在全市范围内开展专项检查工作。</p>';
        const result = verifyBeforeDelivery(source, output);
        expect(result.issues).toEqual([]);
        expect(result.repairable).toBe(false);
    });

    it('句子丢失 → repairable=true', () => {
        const source = '<p>第一句是需要完整保留下来的正文内容。</p><p>第二句同样需要完整保留下来不能丢。</p>';
        const output = '<p>第一句是需要完整保留下来的正文内容。</p>';
        const result = verifyBeforeDelivery(source, output);
        expect(result.repairable).toBe(true);
        expect(result.missingSentences.length).toBeGreaterThan(0);
    });

    it('仅表格/编号问题 → 有 issue 但 repairable=false(应由确定性修复处理)', () => {
        const source = '<p>正文内容保留完整无缺失的一段话在这里。</p>';
        const output = '<p>正文内容保留完整无缺失的一段话在这里。</p><div class="figure-caption">图1 甲</div><div class="figure-caption">图3 乙</div>';
        const result = verifyBeforeDelivery(source, output);
        expect(result.issues.map((i) => i.type)).toContain('figure_numbering_broken');
        expect(result.repairable).toBe(false);
    });
});
