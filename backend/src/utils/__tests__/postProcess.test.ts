import { describe, it, expect } from 'vitest';
import { postProcess, enforceSingleTitleAndDemote, PostProcessOptions } from '../postProcess';

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

describe('reconcileImages', () => {
    it('丢失/重复占位符 → 报 issue,不改文本', () => {
        const html = '<h2>章</h2><p>__IMG_0__</p><p>__IMG_0__</p>'; // IMG_1 缺失, IMG_0 重复
        const { issues } = postProcess(html, opts({ expectedImagePlaceholders: ['__IMG_0__', '__IMG_1__'] }));
        expect(issues.some((x) => x.type === 'image_missing')).toBe(true);
        expect(issues.some((x) => x.type === 'image_duplicated')).toBe(true);
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
