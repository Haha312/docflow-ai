import { describe, it, expect } from 'vitest';
import { splitContentBySemantics } from '../chunking';

describe('splitContentBySemantics', () => {
    it('短内容 → 单块', () => {
        expect(splitContentBySemantics('short', 4000)).toEqual(['short']);
    });

    it('无损:各块拼接 === 原文(无重叠/无丢失)', () => {
        const content = 'A'.repeat(5000) + '\n' + 'B'.repeat(5000) + '\n' + 'C'.repeat(5000);
        const chunks = splitContentBySemantics(content, 4000);
        expect(chunks.length).toBeGreaterThan(1);
        expect(chunks.join('')).toBe(content);
    });

    it('绝不把 __IMG_N__ 占位符切成两半(硬切点正好落在占位符内)', () => {
        // maxChars=4000 → targetEnd≈4000;让占位符恰好横跨该切点
        const head = 'x'.repeat(3995);
        const content = head + '__IMG_12__' + 'y'.repeat(6000) + '__IMG_7__' + 'z'.repeat(2000);
        const chunks = splitContentBySemantics(content, 4000);

        expect(chunks.join('')).toBe(content); // 无损

        // 每个源占位符完整出现在恰好一块里
        for (const tok of ['__IMG_12__', '__IMG_7__']) {
            expect(chunks.filter((c) => c.includes(tok)).length).toBe(1);
        }
        // 任何块里出现的每个 __IMG_ 都能配出完整的 __IMG_\d+__(无半个 token)
        for (const c of chunks) {
            const opens = (c.match(/__IMG_/g) || []).length;
            const fulls = (c.match(/__IMG_\d+__/g) || []).length;
            expect(opens).toBe(fulls);
        }
    });

    it('在标题处优先切分,第二块以标题开头', () => {
        const content = '<p>' + 'a'.repeat(3000) + '</p><h2>第二章</h2><p>' + 'b'.repeat(3000) + '</p>';
        const chunks = splitContentBySemantics(content, 3200);
        expect(chunks.join('')).toBe(content);
        expect(chunks.length).toBe(2);
        expect(chunks[1].startsWith('<h2')).toBe(true);
    });

    it('无边界长文本兜底不在词中间硬切(优先延伸到空白)', () => {
        // 全是无空白字符直到一处空格,确认兜底会延伸到空格而非 targetEnd 处硬切
        const content = 'w'.repeat(4050) + ' ' + 'q'.repeat(4050);
        const chunks = splitContentBySemantics(content, 4000);
        expect(chunks.join('')).toBe(content);
        // 第一块应在空格处结束(长度 4051,含空格),而非 4000 处硬切
        expect(chunks[0].length).toBe(4051);
        expect(chunks[0].endsWith(' ')).toBe(true);
    });
});
