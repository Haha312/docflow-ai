import { describe, it, expect } from 'vitest';
import { buildSkeleton, expectedChapterCount, createSkeletonMatcher, derivePseudoHeadings } from '../skeleton';

describe('buildSkeleton — 源文层级 → 输出层级(章=h2)', () => {
    it('sourceLevel 1(章)→ outputLevel 2(h2);2→3;3→4', () => {
        const sk = buildSkeleton([
            { level: 1, text: '概述', number: '1' },
            { level: 2, text: '背景', number: '1.1' },
            { level: 3, text: '细节', number: '1.1.1' },
        ]);
        expect(sk.map((n) => n.outputLevel)).toEqual([2, 3, 4]);
        expect(sk.map((n) => n.id)).toEqual(['sk0', 'sk1', 'sk2']);
    });

    it('过滤空文本/非法层级;保序;封顶 6', () => {
        const sk = buildSkeleton([
            { level: 1, text: '一章', number: '1' },
            { level: 0, text: '非法', number: '' },
            { level: 2, text: '   ', number: '' },
            { level: 6, text: '深层', number: '1.1.1.1.1.1' },
        ]);
        expect(sk.map((n) => n.text)).toEqual(['一章', '深层']);
        expect(sk[1].outputLevel).toBe(6); // min(6+1,6)
    });

    it('非数组输入 → 空骨架(优雅降级)', () => {
        expect(buildSkeleton(undefined as any)).toEqual([]);
    });
});

describe('expectedChapterCount — 章数 = outputLevel===2 的节点数', () => {
    it('6 个一级标题 → 6 章(不受子节影响)', () => {
        const titles = ['概述', '总体设计', '数据架构', '功能实现', '部署方案', '总结'];
        const sk = buildSkeleton([
            ...titles.map((t, i) => ({ level: 1, text: t, number: String(i + 1) })),
            { level: 2, text: '某节', number: '1.1' },
            { level: 3, text: '某小节', number: '1.1.1' },
        ]);
        expect(expectedChapterCount(sk)).toBe(6);
    });
});

describe('createSkeletonMatcher — 顺序对齐 + 重名处理', () => {
    it('按顺序匹配,每节点只用一次,未匹配返回 null', () => {
        const sk = buildSkeleton([
            { level: 1, text: 'A', number: '1' },
            { level: 1, text: 'B', number: '2' },
        ]);
        const m = createSkeletonMatcher(sk);
        expect(m.match('A')?.node.id).toBe('sk0');
        expect(m.match('B')?.node.id).toBe('sk1');
        expect(m.match('A')).toBeNull(); // 已用尽
        expect(m.match('不存在')).toBeNull();
        expect(m.usedCount()).toBe(2);
        expect(m.unusedNodes()).toHaveLength(0);
    });

    it('重名标题按出现顺序对到不同节点', () => {
        const sk = buildSkeleton([
            { level: 1, text: '小结', number: '1' },
            { level: 1, text: '小结', number: '2' },
        ]);
        const m = createSkeletonMatcher(sk);
        expect(m.match('小结')?.index).toBe(0);
        expect(m.match('小结')?.index).toBe(1);
        expect(m.match('小结')).toBeNull();
    });

    it('漏掉的骨架节点 → unusedNodes 暴露(内容缺失信号)', () => {
        const sk = buildSkeleton([
            { level: 1, text: '甲', number: '1' },
            { level: 1, text: '乙', number: '2' },
            { level: 1, text: '丙', number: '3' },
        ]);
        const m = createSkeletonMatcher(sk);
        m.match('甲');
        m.match('丙');
        const unused = m.unusedNodes();
        expect(unused.map((n) => n.text)).toEqual(['乙']);
    });
});

// 计数器只该在标题行没写序号时兜底。之前无条件自增,把源文写的序号丢掉 ——
// 一本书的第 3 章粘进来会被算成第 1 章,后处理再也无从知道原本是几。
describe('derivePseudoHeadings 沿用标题行自带的序号', () => {
    const p = (...lines: string[]) => lines.map((l) => `<p>${l}</p>`).join('');

    it('中文章号原样带出(第三章 → 3)', () => {
        const hs = derivePseudoHeadings(p('第三章 看不见的那张网', '正文足够长的一段内容用于占位。', '第四章 一千八百块表'));
        expect(hs.map((h) => h.number)).toEqual(['3', '4']);
    });

    it('阿拉伯层级号沿用,父号取自上一条章标题', () => {
        const hs = derivePseudoHeadings(p('4. 技术方案', '正文足够长的一段内容用于占位。', '4.2 采集层设计', '4.3 平台层设计'));
        expect(hs.map((h) => h.number)).toEqual(['4', '4.2', '4.3']);
    });

    it('十位中文数字也认(第十二章 → 12)', () => {
        const hs = derivePseudoHeadings(p('第十二章 甲', '正文足够长的一段内容用于占位。', '第十三章 乙'));
        expect(hs.map((h) => h.number)).toEqual(['12', '13']);
    });

    it('中文顿号序号同样沿用(一、二、)', () => {
        const hs = derivePseudoHeadings(p('一、总体要求', '正文足够长的一段内容用于占位。', '二、主要任务'));
        expect(hs.map((h) => h.number)).toEqual(['1', '2']);
    });
});
