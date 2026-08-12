import { describe, it, expect } from 'vitest';
import { finalizeStructure, visibleHeadingNumber, type RawHeading } from './docxParser';

const h = (level: number, text: string, leading = false): RawHeading =>
    ({ level, text, number: '', leading });

describe('visibleHeadingNumber', () => {
    it('读得出各种写法的源文编号', () => {
        expect(visibleHeadingNumber('3.2 实施范围')).toBe('3.2');
        expect(visibleHeadingNumber('★ 3.2 实施范围')).toBe('3.2');
        expect(visibleHeadingNumber('1、总则')).toBe('1');
        expect(visibleHeadingNumber('二、供方职责')).toBe('2');
        expect(visibleHeadingNumber('十、附则')).toBe('10');
        expect(visibleHeadingNumber('第三章 技术要求')).toBe('3');
        expect(visibleHeadingNumber('3-2 实施范围')).toBe('3.2');
    });

    it('正文里的数字不算编号', () => {
        expect(visibleHeadingNumber('2024年度总结')).toBe('');
        expect(visibleHeadingNumber('5G通信技术')).toBe('');
        expect(visibleHeadingNumber('技术规范书')).toBe('');
    });
});

describe('finalizeStructure', () => {
    // 真实文档实测:题名在 Word 里也带大纲级别,占掉了第 1、2 章的位置,
    // 真正的「1、总则」被挤成 1.1,后面每一章都跟着错。
    it('开头无编号的题名行不算章', () => {
        const out = finalizeStructure([
            h(1, '临沂正信工程勘察设计有限公司三维设计校核软件技术服务项目', true),
            h(1, '技术规范书', true),
            h(1, '1、总则', true),
            h(1, '2、供方职责'),
        ]);
        expect(out.map((x) => x.text)).toEqual(['1、总则', '2、供方职责']);
        expect(out.map((x) => x.number)).toEqual(['1', '2']);
    });

    it('摘要/前言这类真章节即使在开头也保留', () => {
        const out = finalizeStructure([
            h(1, '某某研究报告', true),
            h(1, '摘要', true),
            h(1, '1 引论'),
        ]);
        expect(out.map((x) => x.text)).toEqual(['摘要', '1 引论']);
    });

    it('沿用源文编号,不自己从 1 数', () => {
        const out = finalizeStructure([
            h(1, '3 技术要求'), h(2, '3.1 总体要求'), h(2, '★ 3.2 实施范围'), h(1, '4 技术服务'),
        ]);
        expect(out.map((x) => x.number)).toEqual(['3', '3.1', '3.2', '4']);
    });

    it('源文没写号才用层级计数兜底', () => {
        const out = finalizeStructure([h(1, '总则'), h(2, '适用范围'), h(1, '职责')]);
        expect(out.map((x) => x.number)).toEqual(['1', '1.1', '2']);
    });

    it('全无编号时不误删开头的标题', () => {
        const out = finalizeStructure([h(1, '总则', true), h(1, '职责')]);
        expect(out).toHaveLength(2);
    });
});
