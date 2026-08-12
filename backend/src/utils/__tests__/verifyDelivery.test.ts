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

    // 回归:被注释掉的表格标记不在页面上,不能算进开闭标签数,否则整份成稿被判 critical
    it('HTML 注释里的表格标记不参与计数,不误报未闭合', () => {
        const html = `<p>正文</p><!-- 占位:<table><tr><td>a</td></tr></table> 原文保留 --><p>结尾</p>`;
        const issues = verifyTableStructure(html);
        expect(issues.map((i) => i.type)).not.toContain('table_unclosed');
    });

    it('真的未闭合(不在注释里)仍然报', () => {
        const html = `<!-- 说明 --><table><tr><td>a</td></tr>`;
        const issues = verifyTableStructure(html);
        expect(issues.map((i) => i.type)).toContain('table_unclosed');
    });

    it('空表 → table_empty', () => {
        const html = `<table><tbody></tbody></table>`;
        const issues = verifyTableStructure(html);
        expect(issues.map((i) => i.type)).toContain('table_empty');
    });

    it('合法的 rowspan 合并表:跳过行宽检查,完全不误报', () => {
        // 被 rowspan 跨越的行单元格数天然少于列数,行宽模型判不了对错 ——
        // 真实文档的报价明细表大量纵向合并,逐行检查全是误报,故含 rowspan 即跳过。
        const html = `<table>
            <tr><td rowspan="2">合并</td><td>b</td><td>c</td></tr>
            <tr><td>d</td><td>e</td></tr>
            <tr><td>f</td><td>g</td><td>h</td></tr>
            <tr><td>i</td><td>j</td><td>k</td></tr>
        </table>`;
        expect(verifyTableStructure(html)).toEqual([]);
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

    // 回归:Word 会把连字符自动替换成 U+2011 不换行连字符,只认 ASCII '-' 会把
    // 「图 3‑1」误判成扁平编号「图3」并报「缺少章号」(真实文档实测踩到过)。
    it.each([
        ['-', 'ASCII 连字符'],
        ['‐', 'U+2010 连字符'],
        ['‑', 'U+2011 不换行连字符'],
        ['‒', 'U+2012 数字短横'],
        ['–', 'U+2013 短破折号'],
        ['—', 'U+2014 长破折号'],
        ['－', 'U+FF0D 全角减号'],
        ['.', '英文点'],
        ['．', '全角点'],
    ])('各种连字符变体都能解析为章节相对编号: %s (%s)', (sep) => {
        expect(parseCaptionNumber(`图 3${sep}1 总体架构`, '图')).toMatchObject({ chapter: 3, seq: 1 });
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

    it('跳号 → 直接报缺失的编号', () => {
        const html = `
            <div class="figure-caption">图1 甲</div>
            <div class="figure-caption">图3 乙</div>`;
        const issues = verifyCaptionNumbering(html);
        expect(issues.map((i) => i.type)).toContain('figure_numbering_broken');
        expect(issues[0].detail).toContain('图2 缺失');
    });

    it('连续断档合并成区间(图4-20~图4-22 缺失)', () => {
        const html = `
            <div class="figure-caption">图4-19 甲</div>
            <div class="figure-caption">图4-23 乙</div>`;
        const issues = verifyCaptionNumbering(html);
        expect(issues[0].detail).toContain('图4-20~图4-22 缺失');
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

    it('标题行不参与逐句核对(成稿会统一重编号,逐字比必然误判丢失)', () => {
        const html = [
            '<p>1.2.1. 三维数据管理功能需求</p>',
            '<p>第三章 系统总体设计</p>',
            '<p>基于数据中台完成三维数据管理相关功能开发,包括质量检查与数据发布。</p>',
        ].join('');
        const sentences = extractSentences(html);
        expect(sentences).toHaveLength(1);
        expect(sentences[0]).toContain('基于数据中台');
    });

    it('以编号开头但是完整句子的列表项仍参与核对(豁免不过度)', () => {
        const html = '<p>1. 完成数据标准体系建设,并发布配套的数据接入规范文件。</p>';
        expect(extractSentences(html)).toHaveLength(1);
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

// 回归:归一化必须把弯引号折成直引号。这条规则曾被一次编码往返压平成两个 ASCII 引号,
// 等于没生效 —— 模型把 "xx" 排成 “xx” 就会整句比对失败,报出并不存在的缺失句子。
describe('normalizeForCompare 引号折叠', () => {
    it('弯引号与直引号归一后一致', () => {
        expect(normalizeForCompare('提出的“四层架构”方案'))
            .toBe(normalizeForCompare('提出的"四层架构"方案'));
    });

    it('单引号、直角引号同样折叠', () => {
        const base = normalizeForCompare('称为"数据孤岛"');
        expect(normalizeForCompare('称为‘数据孤岛’')).toBe(base);
        expect(normalizeForCompare('称为「数据孤岛」')).toBe(base);
    });

    it('源文用直引号、成稿用弯引号时不判缺句', () => {
        const src = '<p>原则同意报告提出的"采集层—应用层"四层架构技术路线。</p>';
        const out = '<h3>（一） 原则同意报告提出的“采集层—应用层”四层架构技术路线。</h3>';
        expect(verifySentenceCoverage(src, out).missingSentences).toHaveLength(0);
    });
});

// 回归:句子被排版提升成标题时,句末标点会被去掉。只差一个句号就判「丢失」,
// 在公文/方案类文档上会批量误报,而且是 critical 级 —— 用户看到的就是那条吓人的红条。
describe('句末标点不参与逐句核对', () => {
    it('源文带句号、成稿作为标题不带句号 → 不算缺失', () => {
        const src = '<p>（一）准备阶段（2026年4月至6月）。完成可研评审、资金安排与招标采购。</p>';
        const out = '<h4>（一）准备阶段（2026年4月至6月）</h4><p>完成可研评审、资金安排与招标采购。</p>';
        expect(verifySentenceCoverage(src, out).missingSentences).toHaveLength(0);
    });

    it('内容真的没了,仍然照报', () => {
        const src = '<p>（一）准备阶段（2026年4月至6月）。完成可研评审、资金安排与招标采购。</p>';
        const out = '<p>完成可研评审、资金安排与招标采购。</p>';
        expect(verifySentenceCoverage(src, out).missingSentences.length).toBeGreaterThan(0);
    });
});

// 回归:排版会在句中把一段切成「标题 + 正文」,切分点上的逗号随之消失。字一个没少却报
// critical 红条,公文/方案类文档批量踩。判定只放宽标点 —— 词句真缺失仍然照报。
describe('只差标点不算丢失', () => {
    it('句中被切成标题+正文,切分处的逗号消失 → 不算缺失', () => {
        const src = '<p>（一）计量装置台账与实物是否一致，含表号、量程、精度等级、安装位置、投运日期。</p>';
        const out = '<h4>（一）计量装置台账与实物是否一致</h4><p>含表号、量程、精度等级、安装位置、投运日期。</p>';
        expect(verifySentenceCoverage(src, out).missingSentences).toHaveLength(0);
    });

    it('后半句真的没了 → 照常报缺失', () => {
        const src = '<p>（一）计量装置台账与实物是否一致，含表号、量程、精度等级、安装位置、投运日期。</p>';
        const out = '<h4>（一）计量装置台账与实物是否一致</h4>';
        expect(verifySentenceCoverage(src, out).missingSentences.length).toBeGreaterThan(0);
    });

    it('句中被改词 → 照常报缺失(放宽的只有标点)', () => {
        const src = '<p>全园区共有各类计量点位1860个，其中具备远程采集能力的仅720个。</p>';
        const out = '<p>全园区共有各类计量点位1860个，其中具备远程采集能力的仅520个。</p>';
        expect(verifySentenceCoverage(src, out).missingSentences.length).toBeGreaterThan(0);
    });
});

// 真实文档实测:源文标题写「★ 3.2 实施范围及运行要求」,排版把装饰符连同旧编号一并剥掉,
// 字一个没少,却被判成两处整句丢失,交付前弹红条。
describe('装饰符不算内容', () => {
    it('只差一个装饰符不算句子丢失', () => {
        const src = '<p>★ 3.2 实施范围及运行要求</p><p>★ 3.3 三维数字化设计成果质检测试装置需具备的专业软件</p>';
        const out = '<h3>3.2 实施范围及运行要求</h3><h3>3.3 三维数字化设计成果质检测试装置需具备的专业软件</h3>';
        expect(verifyBeforeDelivery(src, out).issues).toHaveLength(0);
    });

    it('真丢了句子照样报', () => {
        const src = '<p>★ 3.2 实施范围及运行要求</p><p>供方应在合同签订后三十日内完成全部部署工作</p>';
        const out = '<h3>3.2 实施范围及运行要求</h3>';
        expect(verifyBeforeDelivery(src, out).issues.some((i) => i.type === 'sentences_missing')).toBe(true);
    });
});
