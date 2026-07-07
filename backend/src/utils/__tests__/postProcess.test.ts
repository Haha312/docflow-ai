import { describe, it, expect } from 'vitest';
import { postProcess, enforceSingleTitleAndDemote, PostProcessOptions } from '../postProcess';
import { buildSkeleton } from '../skeleton';

const opts = (over: Partial<PostProcessOptions> = {}): PostProcessOptions => ({
    scheme: 'decimal-nested',
    figureChapterRelative: false,
    tableChapterRelative: false,
    ...over,
});

describe('enforceSingleTitleAndDemote', () => {
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
