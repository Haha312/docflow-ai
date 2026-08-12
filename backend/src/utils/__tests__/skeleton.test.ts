import { describe, it, expect } from 'vitest';
import { buildSkeleton, expectedChapterCount, createSkeletonMatcher, derivePseudoHeadings, isSkeletonUntrustworthy, dropIncoherentHeadings } from '../skeleton';

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

// 骨架非空 ≠ 骨架可信。真实文档实测:某技术规范书的章标题在 Word 里只是加粗段落,
// 结构提取抓到 5 条 —— 2 条是文档标题的两行、3 条是三级小节,真正的 4 个章一条没有。
// 后端原本只在骨架为空时才回落文本推断,于是全盘采信,4 个章全被压成了小节。
describe('骨架可信度判据', () => {
    const derived = (...texts: string[]) => texts.map((t) => ({ level: 1, text: t, number: '' }));

    it('骨架漏掉正文里的主干章 → 判为不可信', () => {
        const skeleton = [
            { text: '临沂正信工程勘察设计有限公司三维设计校核软件技术服务项目' },  // 其实是文档标题
            { text: '技术规范书' },                                              // 标题的下半行
            { text: '3.1 总体要求' }, { text: '★ 3.2 实施范围及运行要求' },
        ];
        const fromText = derived('1、总则', '2、供方职责', '3、技术要求', '4、技术服务');
        expect(isSkeletonUntrustworthy(skeleton, fromText)).toBe(true);
    });

    // 前端剔掉题名行之后,这份文档的骨架只剩 3 条三级小节 —— 依然不该被当成全部结构
    it('骨架只剩小节、一个主干章都没有 → 仍判不可信', () => {
        const skeleton = [
            { text: '3.1 总体要求' }, { text: '★ 3.2 实施范围及运行要求' },
            { text: '★ 3.3 三维设计校核软件应具备的专业功能' },
        ];
        const fromText = derived('1、总则', '2、供方职责', '3、技术要求', '4、技术服务');
        expect(isSkeletonUntrustworthy(skeleton, fromText)).toBe(true);
    });

    it('骨架覆盖了主干章 → 可信,不要瞎回落', () => {
        const skeleton = [
            { text: '总则' }, { text: '供方职责' }, { text: '技术要求' }, { text: '技术服务' },
        ];
        const fromText = derived('1、总则', '2、供方职责', '3、技术要求', '4、技术服务');
        expect(isSkeletonUntrustworthy(skeleton, fromText)).toBe(false);
    });

    it('覆盖一半以上就算可信(容忍个别没对上)', () => {
        const skeleton = [{ text: '总则' }, { text: '供方职责' }, { text: '技术要求' }];
        const fromText = derived('1、总则', '2、供方职责', '3、技术要求', '4、技术服务');
        expect(isSkeletonUntrustworthy(skeleton, fromText)).toBe(false);
    });

    it('文本推断本身样本太少 → 不做判断,宁可信骨架', () => {
        expect(isSkeletonUntrustworthy([{ text: '毫不相干' }], derived('1、总则'))).toBe(false);
        expect(isSkeletonUntrustworthy([{ text: '毫不相干' }], [])).toBe(false);
    });
});

// 逐行看模式只能认出「像标题的行」,认不出「这行属不属于这份文档的编号体系」。
// 人工排版判的正是后者:先看出源文用的哪套号,再拿章号连不连得上判断是标题还是正文条款。
describe('整篇编号一致性', () => {
    const d = (level: number, text: string) => ({ level, text, number: '' });

    it('父号对不上当前章的「小节」是正文引用,不是小节', () => {
        const out = dropIncoherentHeadings([
            d(1, '3、技术要求'), d(2, '3.1 总体要求'), d(2, '5.2 见第五章规定'), d(2, '3.2 实施范围'),
        ]);
        expect(out.map((h) => h.text)).toEqual(['3、技术要求', '3.1 总体要求', '3.2 实施范围']);
    });

    it('章号倒退的是正文列表项', () => {
        const out = dropIncoherentHeadings([
            d(1, '1、总则'), d(1, '2、供方职责'), d(1, '1. 交付物清单'), d(1, '3、技术要求'),
        ]);
        expect(out.map((h) => h.text)).toEqual(['1、总则', '2、供方职责', '3、技术要求']);
    });

    it('没写号的标题不受影响', () => {
        const out = dropIncoherentHeadings([d(1, '总则'), d(2, '适用范围'), d(1, '职责')]);
        expect(out).toHaveLength(3);
    });
});

describe('derivePseudoHeadings 的行判定', () => {
    const src = (...lines: string[]) => lines.map((l) => `<p>${l}</p>`).join('');

    it('冒号收尾的引导句不算标题', () => {
        const out = derivePseudoHeadings(src(
            '1、总则', '2、供方职责', '2.1 供方提供的软件及资料要求如下：', '3、技术要求',
        ));
        expect(out.map((h) => h.text)).toEqual(['1、总则', '2、供方职责', '3、技术要求']);
    });

    it('装饰符打头的小节认得出来', () => {
        const out = derivePseudoHeadings(src('3、技术要求', '3.1 总体要求', '★ 3.2 实施范围', '4、技术服务'));
        expect(out.map((h) => h.number)).toEqual(['3', '3.1', '3.2', '4']);
        expect(out.map((h) => h.level)).toEqual([1, 2, 2, 1]);
    });

    it('编号与正文紧贴时按号的段数定层级', () => {
        const out = derivePseudoHeadings(src('3、技术要求', '3.1 总体要求', '3.1.1变电专业功能', '4、技术服务'));
        expect(out.map((h) => h.level)).toEqual([1, 2, 3, 1]);
    });
});
