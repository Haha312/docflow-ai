import { describe, expect, it } from 'vitest';
import {
    countNumberedItems,
    detectCorporateElementClasses,
    ensureFigureCaptions,
    extractDocumentHeadingMap,
    extractLastHeadings,
    hasSameBodyHallucination,
    reorderCorporateDocument,
} from '../generationHtml';

describe('generationHtml helpers', () => {
    describe('detectCorporateElementClasses', () => {
        it('tags Chinese government document header elements by content', () => {
            const html = [
                '<p>\u673a\u5bc6\u260510\u5e74</p>',
                '<p>\u7279\u6025</p>',
                '<p>\u653f\u53d1\u30142026\u30155\u53f7</p>',
                '<div>\u67d0\u67d0\u6587\u4ef6</div>',
                '<p>\u5404\u90e8\u95e8\uff1a</p>',
                '<h1>\u5173\u4e8e\u9879\u76ee\u5efa\u8bbe\u7684\u901a\u77e5</h1>',
            ].join('\n');

            const result = detectCorporateElementClasses(html);

            expect(result).toContain('class="doc-classification"');
            expect(result).toContain('class="doc-urgency"');
            expect(result).toContain('class="doc-ref-number"');
            expect(result).toContain('class="doc-issuer"');
            expect(result).toContain('class="doc-addressee"');
            expect(result).toContain('class="doc-title"');
        });

        it('does not overwrite existing document classes', () => {
            const html = '<p class="doc-title">\u5df2\u6709\u6807\u9898</p>';

            expect(detectCorporateElementClasses(html)).toBe(html);
        });
    });

    describe('reorderCorporateDocument', () => {
        it('moves corporate header slots ahead of body content and injects a divider', () => {
            const html = [
                '<p>\u6b63\u6587\u7b2c\u4e00\u6bb5</p>',
                '<h1 class="doc-title">\u6807\u9898</h1>',
                '<p class="doc-ref-number">\u653f\u53d1\u30142026\u30155\u53f7</p>',
                '<div class="doc-issuer">\u67d0\u67d0\u6587\u4ef6</div>',
                '<p class="doc-addressee">\u5404\u90e8\u95e8\uff1a</p>',
            ].join('\n');

            const result = reorderCorporateDocument(html);

            expect(result.indexOf('doc-issuer')).toBeLessThan(result.indexOf('doc-ref-number'));
            expect(result.indexOf('doc-ref-number')).toBeLessThan(result.indexOf('doc-title'));
            expect(result.indexOf('doc-title')).toBeLessThan(result.indexOf('doc-addressee'));
            expect(result.indexOf('doc-addressee')).toBeLessThan(result.indexOf('\u6b63\u6587\u7b2c\u4e00\u6bb5'));
            expect(result).toContain('<hr class="doc-divider">');
        });

        it('leaves content unchanged when no title slot is present', () => {
            const html = '<p class="doc-ref-number">\u653f\u53d1\u30142026\u30155\u53f7</p><p>\u6b63\u6587</p>';

            expect(reorderCorporateDocument(html)).toBe(html);
        });
    });

    describe('ensureFigureCaptions', () => {
        it('injects a missing caption after image placeholders', () => {
            const result = ensureFigureCaptions('__IMG_0__<p>body</p>', 2);

            expect(result).toContain('__IMG_0__\n<div class="figure-caption">Figure 3</div>');
        });

        it('keeps existing nearby captions unchanged', () => {
            const html = '__IMG_0__<div class="figure-caption">Figure 9</div><p>body</p>';

            expect(ensureFigureCaptions(html, 2)).toBe(html);
        });
    });

    describe('numbered item repetition guards', () => {
        it('counts explicit and list item numbering', () => {
            expect(countNumberedItems('(1) A (2) B')).toBe(2);
            expect(countNumberedItems('<ol><li>A</li><li>B</li><li>C</li></ol>')).toBe(3);
            expect(countNumberedItems('\uff081\uff09A \uff082\uff09B \uff083\uff09C')).toBe(3);
        });

        it('detects repeated same-body numbered output', () => {
            const repeated = [
                '(1) repeated section body',
                '(2) repeated section body',
                '(3) repeated section body',
                '(4) repeated section body',
                '(5) repeated section body',
            ].join(' ');

            expect(hasSameBodyHallucination(repeated)).toBe(true);
        });

        it('allows varied numbered output', () => {
            const varied = [
                '(1) first section body',
                '(2) second section body',
                '(3) third section body',
                '(4) fourth section body',
                '(5) fifth section body',
            ].join(' ');

            expect(hasSameBodyHallucination(varied)).toBe(false);
        });
    });

    describe('journal front matter headings', () => {
        it('excludes doc-title/doc-title-en from continuation heading helpers', () => {
            const html = [
                '<h1 class="doc-title">中文题名</h1>',
                '<h2 class="doc-title-en">English Title</h2>',
                '<h2>引言</h2>',
                '<h3>研究背景</h3>',
            ].join('');

            expect(extractLastHeadings(html, 5)).toBe('引言 -> 研究背景');
            const map = extractDocumentHeadingMap(html);
            expect(map.outline).toContain('H2: 引言');
            expect(map.outline).not.toContain('English Title');
            expect(map.levelMap.has('english title')).toBe(false);
        });
    });
});
