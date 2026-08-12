import { describe, it, expect } from 'vitest';
import { postProcess, enforceSingleTitleAndDemote, extractSourceCaptions, reconcileCaptionsToSource, headingNumbersShouldBePreserved, PostProcessOptions } from '../postProcess';
import { buildSkeleton } from '../skeleton';

const opts = (over: Partial<PostProcessOptions> = {}): PostProcessOptions => ({
    scheme: 'decimal-nested',
    figureChapterRelative: false,
    tableChapterRelative: false,
    ...over,
});

describe('enforceSingleTitleAndDemote', () => {
    it('「第一章 XX」被 AI 误标成文档标题 → 降级为章,不当标题(纯文本粘贴回归)', () => {
        const html = '<h1 class="doc-title">第一章 项目背景</h1><p>正文。</p><h2>第二章 建设目标</h2>';
        const out = enforceSingleTitleAndDemote(html);
        expect(out).not.toContain('doc-title');
        expect(out).toMatch(/<h2[^>]*>第一章 项目背景<\/h2>/);
    });

    it('真正的文档标题(无编号)不受章形态护栏影响', () => {
        const html = '<h1 class="doc-title">三维数据中心建设方案</h1><h2>第一章 项目背景</h2>';
        const out = enforceSingleTitleAndDemote(html);
        expect(out).toContain('<h1 class="doc-title">三维数据中心建设方案</h1>');
    });

    it('keeps the first doc-title and demotes later ones to h2', () => {
        const html = '<h1 class="doc-title">真标题</h1><h2>章</h2><h1 class="doc-title">中部误升标题</h1><p>x</p>';
        const out = enforceSingleTitleAndDemote(html);
        expect((out.match(/doc-title/g) ?? []).length).toBe(1);
        expect(out).toContain('<h1 class="doc-title">真标题</h1>');
        expect(out).toContain('<h2>中部误升标题</h2>'); // 降级且去 class
        expect(out).not.toContain('中部误升标题</h1>');
    });
});

describe('renumberStructure — 决定性重编号覆盖 AI 漂移', () => {
    it('headline bug: 两个"5"章 + 中部第二标题 → 连续编号 + 单标题', () => {
        const html = [
            '<h1 class="doc-title">报告</h1>',
            '<h2>5. 第一章</h2><p>a</p>',
            '<h3>5.1 第一节</h3><p>b</p>',
            '<h1 class="doc-title">风电场前期及初步设计阶段辅助设计方案</h1>',
            '<h2>5. 又一章</h2><p>c</p>',
            '<h3>5.1 节二</h3>',
        ].join('');
        const { text } = postProcess(html, opts());
        expect((text.match(/doc-title/g) ?? []).length).toBe(1);
        expect(text).toContain('<h2>1. 第一章</h2>');
        expect(text).toContain('<h3>1.1 第一节</h3>');
        expect(text).toContain('<h2>2. 风电场前期及初步设计阶段辅助设计方案</h2>');
        expect(text).toContain('<h2>3. 又一章</h2>');
        expect(text).toContain('<h3>3.1 节二</h3>');
        expect(text).not.toMatch(/<h[23]>5[.\s]/); // 旧的"5"已被覆盖
    });

    it('分块边界重复吐出的同名标题 → 整段丢弃(非降级),编号连续无跳号,残留"研究报告"行清除', () => {
        // 复刻真实 bug:3 块生成,2/3 块开头又吐了一遍标题(+研究报告)。
        const html = [
            '<h1 class="doc-title">平台设计</h1>',
            '<p class="cover-meta">研究报告</p>',          // 真封面副行 → 应保留
            '<h2>目标</h2><p>a</p>',
            '<h2>架构</h2><p>b</p>',
            '<h1 class="doc-title">平台设计</h1>',          // 第2块边界重复标题 → 丢弃
            '<p>研究报告</p>',                                // 紧邻残留行(纯 <p>)→ 一并丢弃
            '<h2>功能</h2><p>c</p>',
            '<h1 class="doc-title">平台设计</h1>',          // 第3块边界重复标题 → 丢弃
            '<h2>总结</h2><p>d</p>',
        ].join('');
        const { text } = postProcess(html, opts({ scheme: 'decimal' }));
        expect((text.match(/doc-title/g) ?? []).length).toBe(1);     // 只剩一个大标题
        expect((text.match(/平台设计/g) ?? []).length).toBe(1);       // 标题文本不再作为正文出现
        expect((text.match(/研究报告/g) ?? []).length).toBe(1);       // 真封面的保留,两处残留清除
        expect(text).toContain('<h2>1. 目标</h2>');
        expect(text).toContain('<h2>2. 架构</h2>');
        expect(text).toContain('<h2>3. 功能</h2>');                   // 不跳号(旧 bug 会变 4/跳号)
        expect(text).toContain('<h2>4. 总结</h2>');
        expect(text).not.toMatch(/<h2>5\./);                         // 没有被"偷走"的号
        expect(text).not.toMatch(/<h[2-6][^>]*>\s*\d+[.\s]*平台设计/); // 标题没被盖成章节号
    });

    it('decimal-nested: 章/节/小节 1. / 1.1 / 1.1.1,进入新章重置子号', () => {
        const html = '<h2>A</h2><h3>a1</h3><h4>a1x</h4><h3>a2</h3><h2>B</h2><h3>b1</h3>';
        const { text } = postProcess(html, opts({ scheme: 'decimal-nested' }));
        expect(text).toContain('<h2>1. A</h2>');
        expect(text).toContain('<h3>1.1 a1</h3>');
        expect(text).toContain('<h4>1.1.1 a1x</h4>');
        expect(text).toContain('<h3>1.2 a2</h3>');
        expect(text).toContain('<h2>2. B</h2>');
        expect(text).toContain('<h3>2.1 b1</h3>');
    });

    it('chinese-hierarchical: 一、 /（一）/ 1. / (1)', () => {
        const html = '<h2>总则</h2><h3>原则</h3><h4>措施</h4><h5>细则</h5>';
        const { text } = postProcess(html, opts({ scheme: 'chinese-hierarchical' }));
        expect(text).toContain('<h2>一、 总则</h2>');
        expect(text).toContain('<h3>（一） 原则</h3>');
        expect(text).toContain('<h4>1. 措施</h4>');
        expect(text).toContain('<h5>(1) 细则</h5>');
    });

    it('chapter: 第一章 / 第一节 / 一、', () => {
        const html = '<h2>引言</h2><h3>背景</h3><h4>要点</h4><h2>方法</h2>';
        const { text } = postProcess(html, opts({ scheme: 'chapter' }));
        expect(text).toContain('<h2>第一章 引言</h2>');
        expect(text).toContain('<h3>第一节 背景</h3>');
        expect(text).toContain('<h4>一、 要点</h4>');
        expect(text).toContain('<h2>第二章 方法</h2>');
    });

    it('none: 不动标题编号', () => {
        const html = '<h2>X</h2><h3>Y</h3>';
        const { text } = postProcess(html, opts({ scheme: 'none' }));
        expect(text).toContain('<h2>X</h2>');
        expect(text).toContain('<h3>Y</h3>');
    });

    it('剥离已有错误前缀后再盖正确号(不叠加)', () => {
        const html = '<h2>三、 旧号章</h2><h3>（五） 旧号节</h3>';
        const { text } = postProcess(html, opts({ scheme: 'decimal-nested' }));
        expect(text).toContain('<h2>1. 旧号章</h2>');
        expect(text).toContain('<h3>1.1 旧号节</h3>');
        expect(text).not.toContain('三、');
        expect(text).not.toContain('（五）');
    });

    it('图/表号: sequential 全局递增', () => {
        const html = '<h2>章</h2><div class="figure-caption">图3 旧</div><div class="table-caption">表7 旧</div><div class="figure-caption">图1 旧</div>';
        const { text } = postProcess(html, opts({ scheme: 'decimal-nested' }));
        expect(text).toContain('<div class="figure-caption">图1 旧</div>');
        expect(text).toContain('<div class="table-caption">表1 旧</div>');
        expect(text).toContain('<div class="figure-caption">图2 旧</div>');
    });

    it('图号: chapter-relative 按当前章号分组', () => {
        const html = '<h2>一章</h2><div class="figure-caption">图9 a</div><h2>二章</h2><div class="figure-caption">图9 b</div><div class="figure-caption">图9 c</div>';
        const { text } = postProcess(html, opts({ scheme: 'decimal-nested', figureChapterRelative: true }));
        expect(text).toContain('图1-1 a');
        expect(text).toContain('图2-1 b');
        expect(text).toContain('图2-2 c');
    });
});

describe('reconcileImages(修复器)', () => {
    it('重复→只留首次;缺失→附录补回;每个期望占位符最终恰好一次', () => {
        const html = '<h2>章</h2><p>__IMG_0__</p><p>__IMG_0__</p>'; // IMG_1 缺失, IMG_0 重复
        const { text, issues } = postProcess(html, opts({ expectedImagePlaceholders: ['__IMG_0__', '__IMG_1__'] }));
        expect(issues.some((x) => x.type === 'image_missing')).toBe(true);
        expect(issues.some((x) => x.type === 'image_duplicated')).toBe(true);
        // 修复后:每个期望占位符在结果中恰好出现一次
        expect(text.split('__IMG_0__').length - 1).toBe(1);
        expect(text.split('__IMG_1__').length - 1).toBe(1);
    });
    it('无 expected 且无 <img> → 文本原样返回(不动)', () => {
        const html = '<h2>章</h2><p>正文</p>';
        const { text } = postProcess(html, opts());
        expect(text).toContain('正文');
    });
    it('无 expected 但含 <img> → 判定为幻觉图片,剥除并报 image_hallucinated', () => {
        // 典型场景:纯文字/OCR 来源文档(没有真实 imageMap),AI 却把"图形/装饰线"编成了 <img>
        const html = '<h2>章</h2><img src="figure1.png"><p>正文</p>';
        const { text, issues } = postProcess(html, opts());
        expect(text).not.toContain('<img');
        expect(text).toContain('正文');
        expect(issues.some((x) => x.type === 'image_hallucinated' && x.severity === 'warning')).toBe(true);
    });
});

describe('幂等性', () => {
    it('跑两次结果一致(各方案)', () => {
        const html = '<h1 class="doc-title">T</h1><h2>5. A</h2><h3>5.9 B</h3><div class="figure-caption">图4 c</div>';
        for (const scheme of ['decimal-nested', 'chinese-hierarchical', 'chapter', 'none']) {
            const once = postProcess(html, opts({ scheme })).text;
            const twice = postProcess(once, opts({ scheme })).text;
            expect(twice).toBe(once);
        }
    });
});

describe('结构先行:reconcileHeadingsToSkeleton 根治章节漂移(6→10)', () => {
    it('骨架3章,AI 多吐2个误升 h2 → 恰好3章,多出的降级为子节', () => {
        const skeleton = buildSkeleton([
            { level: 1, text: '概述', number: '1' },
            { level: 1, text: '架构', number: '2' },
            { level: 1, text: '总结', number: '3' },
        ]);
        const html = [
            '<h1 class="doc-title">设计方案</h1>',
            '<h2>概述</h2><p>a</p>',
            '<h2>子项一</h2><p>b</p>',   // 不在骨架 → 误升的小节
            '<h2>架构</h2><p>c</p>',
            '<h2>子项二</h2><p>d</p>',   // 不在骨架 → 误升的小节
            '<h2>总结</h2><p>e</p>',
        ].join('');
        const { text } = postProcess(html, opts({ scheme: 'decimal-nested', skeleton, preserveSourceHeadingNumbers: true }));
        expect(text).toContain('<h2>1. 概述</h2>');
        expect(text).toContain('<h2>2. 架构</h2>');
        expect(text).toContain('<h2>3. 总结</h2>');
        expect(text).not.toContain('data-sk'); // 内部标记不泄漏进权威全文
        // 恰好 3 个章级,没有第 4、5 章
        expect((text.match(/<h2\b/g) ?? []).length).toBe(3);
        expect(text).not.toMatch(/<h2[^>]*>\s*4\./);
        // 误升的两个被降级为 h3
        expect(text).toContain('子项一</h3>');
        expect(text).toContain('子项二</h3>');
    });

    it('AI 把节误标成 h2 → 按骨架纠正为 h3', () => {
        const skeleton = buildSkeleton([
            { level: 1, text: '主章', number: '1' },
            { level: 2, text: '子节', number: '1.1' }, // section → outputLevel 3
        ]);
        const html = '<h1 class="doc-title">T</h1><h2>主章</h2><h2>子节</h2>';
        const { text } = postProcess(html, opts({ scheme: 'decimal-nested', skeleton, preserveSourceHeadingNumbers: true }));
        expect(text).toContain('<h2>1. 主章</h2>');
        expect(text).toContain('<h3>1.1 子节</h3>'); // 节被纠正为 h3
    });

    it('带 Word 骨架时保留源文原编号,不从 1 重新编号', () => {
        const skeleton = buildSkeleton([
            { level: 1, text: '引言', number: '2' },
            { level: 2, text: '编写目的', number: '2.1' },
            { level: 1, text: '总体设计', number: '3' },
            { level: 2, text: '总体架构', number: '3.1' },
        ]);
        const html = '<h1 class="doc-title">T</h1><h2>引言</h2><h3>编写目的</h3><h2>总体设计</h2><h3>总体架构</h3>';
        const { text } = postProcess(html, opts({ scheme: 'decimal-nested', skeleton, preserveSourceHeadingNumbers: true }));
        expect(text).toContain('<h2>2. 引言</h2>');
        expect(text).toContain('<h3>2.1 编写目的</h3>');
        expect(text).toContain('<h2>3. 总体设计</h2>');
        expect(text).toContain('<h3>3.1 总体架构</h3>');
        expect(text).not.toContain('<h2>1. 引言</h2>');
    });

    it('Word 骨架没有可靠编号时仍按层级生成规范编号', () => {
        const skeleton = buildSkeleton([
            { level: 1, text: '引言', number: '' },
            { level: 2, text: '编写目的', number: '' },
            { level: 1, text: '总体设计', number: '' },
        ]);
        const html = '<h1 class="doc-title">T</h1><h2>引言</h2><h3>编写目的</h3><h2>总体设计</h2>';
        const { text } = postProcess(html, opts({ scheme: 'decimal-nested', skeleton }));
        expect(text).toContain('<h2>1. 引言</h2>');
        expect(text).toContain('<h3>1.1 编写目的</h3>');
        expect(text).toContain('<h2>2. 总体设计</h2>');
    });

    it('带 Word 骨架时保留已有图题/表题编号,且去掉重复英文题注前缀', () => {
        const skeleton = buildSkeleton([{ level: 1, text: '总体设计', number: '3' }]);
        const html = [
            '<h1 class="doc-title">T</h1>',
            '<h2>总体设计</h2>',
            '<div class="table-caption">表2-1 Table 2-1 需求阶段工作内容及成果</div>',
            '<div class="figure-caption">图3-1 Figure 3-1 平台架构</div>',
        ].join('');
        const { text } = postProcess(html, opts({ scheme: 'decimal-nested', skeleton, preserveSourceHeadingNumbers: true, figureChapterRelative: true, tableChapterRelative: true }));
        expect(text).toContain('<div class="table-caption">表2-1 需求阶段工作内容及成果</div>');
        expect(text).toContain('<div class="figure-caption">图3-1 平台架构</div>');
        expect(text).not.toContain('表1-1');
        expect(text).not.toContain('Figure 3-1');
        expect(text).not.toContain('Table 2-1');
    });

    it('骨架标题以正文段落形态存在 → 晋升为标题并参与编号(无样式 Word 回归)', () => {
        const skeleton = buildSkeleton([
            { level: 1, text: '1. 项目概述', number: '1' },
            { level: 2, text: '1.1. 项目背景', number: '1.1' },
        ]);
        // 无样式文档:标题是手打编号+加粗的普通段落(或补回引擎原样插回的源段落)
        const html = '<h1 class="doc-title">T</h1><p><strong>1. 项目概述</strong></p><p>正文若干。</p><p><strong>1.1. 项目背景</strong></p>';
        const { text, issues } = postProcess(html, opts({ scheme: 'decimal-nested', skeleton }));
        expect(issues.some((i) => i.type === 'heading_missing')).toBe(false);
        expect(issues.some((i) => i.type === 'heading_promoted')).toBe(true);
        expect(text).toMatch(/<h2[^>]*>1\.\s*项目概述<\/h2>/);
        expect(text).toMatch(/<h3[^>]*>1\.1\.?\s*项目背景<\/h3>/);
    });

    it('源文自带编号的「前言」按正文第一章编号,后续章号顺延(真实文档回归)', () => {
        // 前端「Word 编号还原」后标题形如「1 前言」「1.1 研究背景」。此前前言被当作前置
        // 事务标题无条件跳过编号且不计数 → 前言整节无号、下一章从 1 重起(实测踩过)。
        const rows: [number, string][] = [
            [1, '摘要'], [1, 'Abstract'], [1, '1 前言'], [2, '1.1 研究背景'],
            [1, '2 特高压工程数据质量评估方法研究'], [2, '2.1 数据质量评估相关理论'],
        ];
        const html = '<h1 class="doc-title">研究报告</h1>' +
            rows.map(([lv, t]) => `<h${lv}>${t}</h${lv}><p>正文占位。</p>`).join('');
        const skeleton = buildSkeleton(rows.map(([level, text]) => ({ level, text, number: '' })));
        const { text } = postProcess(html, opts({ scheme: 'decimal-nested', skeleton }));
        const heads = [...text.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)]
            .map((m) => m[2].replace(/<[^>]+>/g, '').trim());
        expect(heads).toContain('1. 前言');            // 源文有号 → 尊重源文,作第 1 章
        expect(heads).toContain('1.1 研究背景');
        expect(heads).toContain('2. 特高压工程数据质量评估方法研究'); // 章号顺延而非重起
        expect(heads).toContain('摘要');               // 无源编号的前置标题仍不编号
        // 不得出现编号叠加(如「1. 1 前言」):两组编号中间隔空格。注意合法的层级号
        // 「1.1 研究背景」只有一组编号,不应被误判。
        expect(heads.some((h) => /^\d[\d.]*\s+\d[\d.]*\s/.test(h))).toBe(false);
    });

    it('个别缺章(单章)→ heading_missing 仅 warning(不阻断计费)', () => {
        const skeleton = buildSkeleton([
            { level: 1, text: '甲章', number: '1' },
            { level: 1, text: '乙章', number: '2' },
        ]);
        const html = '<h1 class="doc-title">T</h1><h2>甲章</h2><p>x</p>'; // 乙章缺失(1/2)
        const { issues } = postProcess(html, opts({ scheme: 'decimal-nested', skeleton }));
        const hm = issues.find((i) => i.type === 'heading_missing');
        expect(hm?.severity).toBe('warning');
    });

    it('大面积缺章(>15%)→ heading_missing(critical)', () => {
        const titles = ['系统概述', '需求分析', '总体设计', '详细设计', '测试方案', '部署运维'];
        const skeleton = buildSkeleton(titles.map((t, i) => ({ level: 1, text: t, number: String(i + 1) })));
        const html = '<h1 class="doc-title">T</h1><h2>系统概述</h2><h2>需求分析</h2>'; // 缺 4/6 章
        const { issues } = postProcess(html, opts({ scheme: 'decimal-nested', skeleton }));
        expect(issues.some((i) => i.type === 'heading_missing' && i.severity === 'critical')).toBe(true);
    });

    it('审计#1 标题陷阱:源文标题(Heading1)进骨架 → 不误报缺章', () => {
        // 源文标题被标成 Heading 1 → preComputedHeadings[0] 即标题;输出里它是 <h1 class=doc-title>。
        const skeleton = buildSkeleton([
            { level: 1, text: '关于XX的研究报告', number: '1' }, // 实为文档标题
            { level: 1, text: '引言', number: '2' },
            { level: 1, text: '方法', number: '3' },
        ]);
        const html = '<h1 class="doc-title">关于XX的研究报告</h1><h2>引言</h2><h2>方法</h2>';
        const { text, issues } = postProcess(html, opts({ scheme: 'decimal-nested', skeleton }));
        expect(issues.some((i) => i.type === 'heading_missing')).toBe(false); // 标题被消费,不算缺章
        expect(text).toContain('<h2>1. 引言</h2>');
        expect(text).toContain('<h2>2. 方法</h2>');
    });

    it('审计#2 改写标题:模糊匹配命中 → 不降级、不误报缺失', () => {
        const skeleton = buildSkeleton([
            { level: 1, text: '风场尾流效应分析', number: '1' },
            { level: 1, text: '结论', number: '2' },
        ]);
        const html = '<h1 class="doc-title">T</h1><h2>风场尾流效应的分析</h2><h2>结论</h2>'; // 加了"的"
        const { text, issues } = postProcess(html, opts({ scheme: 'decimal-nested', skeleton }));
        expect(text).not.toMatch(/风场尾流效应的分析<\/h3>/);     // 模糊命中 → 保留为章(未被降级到 h3)
        expect(text).toMatch(/<h2[^>]*>1\.\s*风场尾流效应的分析<\/h2>/);
        expect(issues.some((i) => i.type === 'heading_missing')).toBe(false);
    });

    it('审计#5 章0泄漏:摘要下的子标题不产生 0.1', () => {
        const html = '<h1 class="doc-title">T</h1><h2>摘要</h2><h3>研究背景</h3><h2>引言</h2>';
        const { text } = postProcess(html, opts({ scheme: 'decimal-nested' }));
        expect(text).not.toContain('0.1');
        expect(text).toContain('<h3>研究背景</h3>'); // 前置内容子标题不编号
        expect(text).toContain('<h2>1. 引言</h2>');
    });

    it('审计#6 章相对图号:目录下的图退回全局序号,不与正文首图撞号', () => {
        const html = '<h2>目录</h2><div class="figure-caption">封面图</div><h2>引言</h2><div class="figure-caption">架构图</div>';
        const { text } = postProcess(html, opts({ scheme: 'decimal-nested', figureChapterRelative: true }));
        expect((text.match(/图1-1/g) ?? []).length).toBeLessThanOrEqual(1); // 不再出现两个"图1-1"
    });

    it('审计#7 位置敏感:正文里真有一节叫「关键词」(出现在某章后)仍正常编号', () => {
        const html = '<h1 class="doc-title">T</h1><h2>引言</h2><h2>关键词</h2>';
        const { text } = postProcess(html, opts({ scheme: 'decimal-nested' }));
        expect(text).toContain('<h2>1. 引言</h2>');
        expect(text).toContain('<h2>2. 关键词</h2>'); // 章后的"关键词"是正文章,编号
    });

    it('学术期刊:英文题名 doc-title-en 是篇首信息,不编号也不偷走第一章', () => {
        const html = [
            '<h1 class="doc-title">中文题名</h1>',
            '<h2 class="doc-title-en">English Title</h2>',
            '<div class="author-info">张三，李四</div>',
            '<p class="keywords">关键词：排版</p>',
            '<h2>引言</h2>',
            '<h2>方法</h2>',
        ].join('');
        const { text } = postProcess(html, opts({ scheme: 'decimal-nested' }));
        expect(text).toContain('<h2 class="doc-title-en">English Title</h2>');
        expect(text).not.toContain('1. English Title');
        expect(text).toContain('<h2>1. 引言</h2>');
        expect(text).toContain('<h2>2. 方法</h2>');
    });

    it('无骨架 → 保持旧行为(信任 AI 标签)', () => {
        const html = '<h1 class="doc-title">T</h1><h2>A</h2><h2>B</h2>';
        const { text } = postProcess(html, opts({ scheme: 'decimal-nested' }));
        expect(text).toContain('<h2>1. A</h2>');
        expect(text).toContain('<h2>2. B</h2>');
    });

    it('目录/前言等前置标题不编号,引言才是第1章', () => {
        const html = '<h1 class="doc-title">T</h1><h2>目录</h2><h2>前言</h2><h2>引言</h2><h2>系统设计</h2>';
        const { text } = postProcess(html, opts({ scheme: 'decimal-nested' }));
        expect(text).toContain('<h2>目录</h2>');        // 不编号
        expect(text).toContain('<h2>前言</h2>');        // 不编号
        expect(text).toContain('<h2>1. 引言</h2>');     // 引言才是第1章
        expect(text).toContain('<h2>2. 系统设计</h2>');
        expect(text).not.toMatch(/<h2>\d+\.\s*目录/);   // 绝不出现"1. 目录"
    });

    it('chapter 方案:目录不编号,引言为第一章', () => {
        const html = '<h1 class="doc-title">T</h1><h2>目录</h2><h2>引言</h2>';
        const { text } = postProcess(html, opts({ scheme: 'chapter' }));
        expect(text).toContain('<h2>目录</h2>');
        expect(text).toContain('<h2>第一章 引言</h2>');
    });

    it('审计#3 编号前缀不吞真实数字(年份/5G/小数)', () => {
        const html = '<h1 class="doc-title">T</h1><h2>2024年度总结</h2><h2>5G通信技术</h2>';
        const { text } = postProcess(html, opts({ scheme: 'decimal-nested' }));
        expect(text).toContain('1. 2024年度总结'); // "2024" 保留,不被当编号吃掉
        expect(text).toContain('2. 5G通信技术');    // "5" 保留
    });

    it('幂等:带骨架跑两次结果一致', () => {
        const skeleton = buildSkeleton([
            { level: 1, text: '概述', number: '1' },
            { level: 1, text: '总结', number: '2' },
        ]);
        const html = '<h1 class="doc-title">T</h1><h2>概述</h2><h2>多余</h2><h2>总结</h2>';
        const once = postProcess(html, opts({ scheme: 'decimal-nested', skeleton })).text;
        const twice = postProcess(once, opts({ scheme: 'decimal-nested', skeleton })).text;
        expect(twice).toBe(once);
    });
});

// 全局后处理改动会作用于「所有预设(TAB)」。本矩阵用各预设真实的 scheme + 图/表编号配置,
// 跑同一份代表性文档(标题 + 目录/摘要前置 + 摘要子节 + 两章各带一图),验证:
//  - 前置标题不编号;真正第一章按各自 scheme 正确起编;
//  - 无"章0泄漏"(0.1 / 0-1);图号互不重复(章相对 vs 顺序都对)。
describe('多预设(各TAB)生成逻辑正确性矩阵', () => {
    const PRESETS = [
        { name: 'ACADEMIC 报告', scheme: 'decimal-nested', fig: true, tab: true, firstChapter: '1. 引言', secondChapter: '2. 系统设计' },
        { name: 'ACADEMIC_JOURNAL 学术期刊', scheme: 'decimal-nested', fig: false, tab: false, firstChapter: '1. 引言', secondChapter: '2. 系统设计' },
        { name: 'CREATIVE', scheme: 'chapter', fig: true, tab: true, firstChapter: '第一章 引言', secondChapter: '第二章 系统设计' },
        { name: 'CORPORATE 机关公文', scheme: 'chinese-hierarchical', fig: false, tab: false, firstChapter: '一、 引言', secondChapter: '二、 系统设计' },
        { name: 'WORK_REPORT 工作汇报/方案', scheme: 'chinese-hierarchical', fig: false, tab: false, firstChapter: '一、 引言', secondChapter: '二、 系统设计' },
        { name: 'MEETING_MINUTES 会议纪要', scheme: 'chinese-hierarchical', fig: false, tab: false, firstChapter: '一、 引言', secondChapter: '二、 系统设计' },
        { name: 'MINIMALIST', scheme: 'decimal', fig: false, tab: false, firstChapter: '1. 引言', secondChapter: '2. 系统设计' },
    ];
    const html = [
        '<h1 class="doc-title">某某设计方案</h1>',
        '<h2>目录</h2>',
        '<h2>摘要</h2><h3>研究背景</h3>',
        '<h2>引言</h2><div class="figure-caption">系统架构</div>',
        '<h2>系统设计</h2><div class="figure-caption">模块图</div>',
    ].join('');

    for (const p of PRESETS) {
        it(`${p.name}: 前置不编号 / 第一章起编正确 / 无章0泄漏 / 图号不撞`, () => {
            const { text } = postProcess(html, opts({ scheme: p.scheme, figureChapterRelative: p.fig, tableChapterRelative: p.tab }));
            // 前置事务性标题不编号
            expect(text).toContain('<h2>目录</h2>');
            expect(text).toContain('<h2>摘要</h2>');
            // 摘要下的子节不产生"章0"编号
            expect(text).not.toContain('0.1');
            expect(text).not.toContain('0-1');
            // 真正的第一/第二章按各自 scheme 起编
            expect(text).toContain(`<h2>${p.firstChapter}</h2>`);
            expect(text).toContain(`<h2>${p.secondChapter}</h2>`);
            // 图号互不重复(章相对 → 图1-1/图2-1;顺序 → 图1/图2)
            const figs = [...text.matchAll(/图\d+(?:-\d+)?/g)].map((m) => m[0]);
            expect(figs.length).toBe(2);
            expect(new Set(figs).size).toBe(2);
        });
    }
});

describe('extractSourceCaptions — 真实 Word 形态回归', () => {
    // 真实文档实测的图号断档真凶:图题与图片占位符挤在同一段,提取器不认 →
    // 源图题集缺失 → 裁剪器把 AI 忠实输出的对应图题当「编造」删掉。
    it('图片占位符与图题同段也能提取', () => {
        const set = extractSourceCaptions('<p>__IMG_28__图4-20成果评分细则定制样例图</p>');
        expect(set.figures).toHaveLength(1);
        expect(set.figures[0].prefix).toBe('图4-20');
        expect(set.figures[0].normPrefix).toBe('图4-20');
    });

    it('U+2011 不换行连字符编号(图 3‑1)解析出完整前缀', () => {
        const set = extractSourceCaptions('<p>图 3‑1信息中心及上层应用总体技术路线</p>');
        expect(set.figures).toHaveLength(1);
        // normPrefix 把连字符变体折成 ASCII '-'
        expect(set.figures[0].normPrefix).toBe('图3-1');
    });

    it('表题同理(U+2011)', () => {
        const set = extractSourceCaptions('<p>表 5‑1 服务器端硬件配置表</p>');
        expect(set.tables).toHaveLength(1);
        expect(set.tables[0].normPrefix).toBe('表5-1');
    });

    it('普通段落不误判为图题', () => {
        const set = extractSourceCaptions('<p>图形化界面的设计原则如下所述。</p>');
        expect(set.figures).toHaveLength(0);
    });
});

describe('reconcileCaptionsToSource — 分类裁剪与源编号自洽性(真实文档回归)', () => {
    // 场景:73 张图全部无题注、20 张表只有 2 个题注且源编号乱(表63 在 表1 前)

    it('源文某类完全无题注 → 该类 AI 生成的编号题注照单全收', () => {
        const src = extractSourceCaptions('<p>表1 数据安全设计清单</p>'); // 只有表题,无图题
        const html = [
            '<div class="figure-caption">图1 系统总体架构</div>',
            '<div class="figure-caption">图2 部署拓扑</div>',
            '<div class="table-caption">表1 数据安全设计清单</div>',
        ].join('');
        const { text } = reconcileCaptionsToSource(html, src);
        expect(text).toContain('图1 系统总体架构');
        expect(text).toContain('图2 部署拓扑');
        expect(text).toContain('表1 数据安全设计清单');
    });

    it('源题注编号不自洽(表63 在 表1 前)→ 保留重编后的顺序号,标题对齐源文', () => {
        const src = extractSourceCaptions('<p>表63 应用安全设计清单</p><p>表1 数据安全设计清单</p>');
        // renumberStructure 已把成稿两个表题统一编为 表1/表2
        const html = [
            '<div class="table-caption">表1 应用安全设计清单</div>',
            '<div class="table-caption">表2 数据安全设计清单</div>',
        ].join('');
        const { text } = reconcileCaptionsToSource(html, src);
        expect(text).toContain('表1 应用安全设计清单');
        expect(text).toContain('表2 数据安全设计清单'); // 标题对齐到源文全称
        expect(text).not.toContain('表63'); // 源乱号不得写回
    });

    it('源题注编号自洽 → 仍改写回源题注(保留源编号,原行为不回归)', () => {
        const src = extractSourceCaptions('<p>图3-1 总体架构图</p><p>图3-2 数据流图</p>');
        const html = [
            '<div class="figure-caption">图1 总体架构</div>',
            '<div class="figure-caption">图2 数据流</div>',
        ].join('');
        const { text } = reconcileCaptionsToSource(html, src);
        expect(text).toContain('图3-1 总体架构图');
        expect(text).toContain('图3-2 数据流图');
    });

    it('有源题注的类仍然裁掉编造题注(原行为不回归)', () => {
        const src = extractSourceCaptions('<p>表1 数据安全设计清单</p>');
        const html = [
            '<div class="table-caption">表1 数据安全设计清单</div>',
            '<div class="table-caption">表2 凭空编造的表题</div>',
        ].join('');
        const { text } = reconcileCaptionsToSource(html, src);
        expect(text).toContain('表1 数据安全设计清单');
        expect(text).not.toContain('凭空编造');
    });
});

// 标题编号一律按层级重编,对编号乱掉的源文是产品价值;但源文若是一本书的第 3~5 章、
// 或某分册从第 4 章起,重编就把作者写的章号悄悄改了(实测:第三/四/五章 → 第一/二/三章)。
// 规则刻意保守:只在「编号自洽 且 不从 1 起」时沿用 —— 从 1 起的文档沿用与重编等价,行为不变。
describe('源文标题编号的沿用判定', () => {
    const node = (number: string, text: string, sourceLevel: number, i: number) => ({
        id: `sk${i}`, sourceLevel, outputLevel: Math.min(sourceLevel + 1, 6), number, text, norm: text,
    });
    const sk = (rows: [string, string, number][]) => rows.map((r, i) => node(r[0], r[1], r[2], i));
    const body = (nodes: ReturnType<typeof sk>) =>
        '<h1 class="doc-title">城市的呼吸</h1>' + nodes.map((n) =>
            `<h${n.outputLevel} data-sk="${n.id}">${n.number} ${n.text}</h${n.outputLevel}>` +
            `<p>${n.text}这一节的正文内容,写得足够长以免被当成标题行。</p>`).join('');
    const headsOf = (html: string) =>
        (html.match(/<h[2-6][^>]*>([\s\S]*?)<\/h[2-6]>/g) ?? []).map((h) => h.replace(/<[^>]+>/g, '').trim());

    it('不从 1 起且自洽 → 判为应沿用', () => {
        expect(headingNumbersShouldBePreserved(sk([['3', '甲', 1], ['4', '乙', 1], ['5', '丙', 1]]))).toBe(true);
    });

    it('从 1 起 → 不特殊处理(沿用与重编等价)', () => {
        expect(headingNumbersShouldBePreserved(sk([['1', '甲', 1], ['2', '乙', 1]]))).toBe(false);
    });

    it('跳号 / 缺编号 → 不可信,照常重编', () => {
        expect(headingNumbersShouldBePreserved(sk([['3', '甲', 1], ['5', '乙', 1]]))).toBe(false);
        expect(headingNumbersShouldBePreserved(sk([['3', '甲', 1], ['', '乙', 1]]))).toBe(false);
    });

    it('书的第 3~5 章:章号原样保留,不被重编成第一章', () => {
        const nodes = sk([['3', '甲', 1], ['4', '乙', 1], ['5', '丙', 1]]);
        const out = postProcess(body(nodes), opts({ scheme: 'chapter', skeleton: nodes })).text;
        expect(headsOf(out)).toEqual(['第三章 甲', '第四章 乙', '第五章 丙']);
    });

    it('分册从第 4 章起,子节编号跟着源文走', () => {
        const nodes = sk([['4', '甲', 1], ['4.1', '甲一', 2], ['4.2', '甲二', 2], ['5', '乙', 1]]);
        const out = postProcess(body(nodes), opts({ scheme: 'decimal-nested', skeleton: nodes })).text;
        expect(headsOf(out)).toEqual(['4. 甲', '4.1 甲一', '4.2 甲二', '5. 乙']);
    });

    it('源文编号乱掉时仍然重编(产品价值不能丢)', () => {
        const nodes = sk([['3', '甲', 1], ['5', '乙', 1], ['6', '丙', 1]]);
        const out = postProcess(body(nodes), opts({ scheme: 'chapter', skeleton: nodes })).text;
        expect(headsOf(out)).toEqual(['第一章 甲', '第二章 乙', '第三章 丙']);
    });
});

// 回归:中文论文里「图2 给出了…」这种引用句极常见。只按开头「图N」就认题注,
// 会把整段正文转成居中的题注 div(内容形态被改),还会污染源文题注清单、连带把编号判成不连续。
describe('正文里引用图表的句子不能当成题注', () => {
    const caps = (html: string) => extractSourceCaptions(html);

    it.each([
        '<p>图2 给出了不同方法的对比结果。</p>',
        '<p>表1 列出了各类计量设备的接入方式。可以看出网关直连占多数。</p>',
        '<p>图3 中的曲线表明，热负荷对室外温度的响应存在滞后；这一现象在冬季尤为明显。</p>',
        '<p>图4 显示了聚类结果，其中横轴为时间。</p>',
        // 这条没有句末标点、中间也不断句,只能靠长度拦下
        '<p>图2 中给出的三条曲线分别对应基准方法、按日期类型分组的改进方法以及本文提出的时序聚类方法在整个测试集上的逐日预测表现与误差分布情况对比</p>',
    ])('引用句不登记为源文题注: %s', (html) => {
        const c = caps(html);
        expect(c.figures.length + c.tables.length).toBe(0);
    });

    it.each([
        ['<p>图1 平台总体架构示意图</p>', 1, 0],
        ['<p>表1 计量设备接入方式对照表</p>', 0, 1],
        ['<p>图 3-2 数据处理流程</p>', 1, 0],
    ])('真题注仍然照常识别: %s', (html, figs, tabs) => {
        const c = caps(html);
        expect(c.figures.length).toBe(figs);
        expect(c.tables.length).toBe(tabs);
    });

    it('引用句不会被提升成题注 div(正文形态不被改)', () => {
        const src = '<p>图1 平台总体架构示意图</p><p>图1 给出了平台的四层结构。</p>';
        const out = postProcess(src, opts({ scheme: 'decimal', sourceCaptions: extractSourceCaptions(src) })).text;
        expect((out.match(/figure-caption/g) ?? []).length).toBe(1);
        expect(out).toMatch(/<p[^>]*>图1 给出了平台的四层结构。<\/p>/);
    });
});
