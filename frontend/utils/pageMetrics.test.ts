import { describe, it, expect } from 'vitest';
import { PRESETS } from '../constants';
import { marginsPxOf, cssLenToPx, DEFAULT_MARGINS_PX } from './pageMetrics';

/** px(96dpi) → mm */
const pxToMm = (px: number) => (px / 96) * 25.4;

/** 与 docxGenerator 里 toMm 同口径 */
const toMm = (v?: string): number | null => {
    const m = (v || '').match(/([\d.]+)\s*(cm|mm|in)?/i);
    if (!m) return null;
    const n = parseFloat(m[1]);
    const unit = (m[2] || 'mm').toLowerCase();
    return unit === 'cm' ? n * 10 : unit === 'in' ? n * 25.4 : n;
};

/** docxGenerator 在 styleConfig.pageMargins 缺省时用的兜底 */
const DOCX_FALLBACK_MARGINS = { top: '2.54cm', bottom: '2.54cm', left: '3.18cm', right: '3.18cm' };

const SIDES = ['top', 'bottom', 'left', 'right'] as const;

describe('cssLenToPx', () => {
    it('各单位换算到 96dpi 像素', () => {
        expect(cssLenToPx('2.54cm')).toBe(96);
        expect(cssLenToPx('25.4mm')).toBe(96);
        expect(cssLenToPx('1in')).toBe(96);
        expect(cssLenToPx('72pt')).toBe(96);
        expect(cssLenToPx('96px')).toBe(96);
    });

    it('空值/非法值返回 null,交给调用方兜底', () => {
        expect(cssLenToPx(undefined)).toBeNull();
        expect(cssLenToPx('auto')).toBeNull();
    });
});

// 「所见即所得」是产品的核心承诺:A4 预览的页边距必须和导出的 .docx 一致,
// 否则预览每页塞的内容比成品多,页数与版面全对不上(真实文档实测踩过:预览 56 页 / Word 101 页)。
describe('预览页边距与 .docx 导出一致', () => {
    for (const preset of PRESETS) {
        it(`${preset.title}:四边都对得上`, () => {
            const pm = preset.styleConfig.pageMargins;
            expect(pm, `${preset.title} 没有定义 pageMargins,会落到两套不同的兜底值`).toBeTruthy();
            const preview = marginsPxOf(pm);
            for (const side of SIDES) {
                const previewMm = pxToMm(preview[side]);
                const docxMm = toMm(pm![side]) ?? 0;
                // 容差 0.6mm:px 取整带来的误差远小于此,真出现偏差就是配置写错了
                expect(Math.abs(previewMm - docxMm), `${preset.title} ${side}`).toBeLessThan(0.6);
            }
        });
    }

    it('未定义页边距时,预览的兜底值与 docx 的兜底值一致', () => {
        const preview = marginsPxOf(undefined);
        for (const side of SIDES) {
            const previewMm = pxToMm(preview[side]);
            const docxMm = toMm(DOCX_FALLBACK_MARGINS[side])!;
            expect(Math.abs(previewMm - docxMm), side).toBeLessThan(0.6);
        }
    });

    it('兜底常量本身没被改歪', () => {
        expect(DEFAULT_MARGINS_PX).toEqual({ top: 96, right: 120, bottom: 96, left: 120 });
    });
});
