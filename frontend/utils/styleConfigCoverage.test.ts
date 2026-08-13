import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { PRESETS } from '../constants';
import { generatePreviewStyles } from './previewStyles';

/**
 * 「所见即所得」的结构性保障。
 *
 * 预览(previewStyles)与导出(docxGenerator)都从同一份 styleConfig 生成。只要有字段
 * 单边读取,用户就会遇到「预览一个样、导出另一个样」——而且悄无声息,没人会发现。
 * 历史上就是这么漏的:tableStyle(期刊三线表画成网格)、pageMargins 兜底值不一致、
 * pageSize(预览写死 A4)、primaryColor(预览黑字导出彩字)、期刊 12 个死配置。
 *
 * 这条测试把不变式钉死:凡是导出侧读的 styleConfig 字段,预览侧必须也读。
 * 确有理由只在导出侧生效的,写进 EXPORT_ONLY 并注明原因 —— 让豁免是显式的、可审查的。
 */

const DIR = path.resolve(__dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(DIR, f), 'utf8');

/** 确有理由只在导出侧处理的字段 —— 每一条都要给出原因 */
const EXPORT_ONLY: Record<string, string> = {
    generateToc: '目录由 Word 域生成,预览不渲染域',
    h5Size: '产品未使用 h5/h6 层级', h5Font: '同上', h5Bold: '同上', h5Indent: '同上', h5Italic: '同上',
    h6Size: '同上', h6Font: '同上', h6Bold: '同上', h6Indent: '同上', h6Italic: '同上',
};

/**
 * 暂未落地的配置 —— 不是"忘了做",而是当前落不了地,原因写清楚,别让它假装已实现。
 *
 * 头一类的根因在生成层:期刊提示词只要求 AI 产出 8 个类(doc-title / doc-title-en /
 * author-info / affiliation / abstract-cn / abstract-en / keywords / journal-split),
 * 没有 .references、.doi、.full-width。给不存在的元素写样式是死代码 —— 要让这些配置生效,
 * 得先在提示词里加上对应的类,那是生成层的改动,不该混在排版层里做。
 */
const NOT_IMPLEMENTED: Record<string, string> = {
    figureWidthFull: '预览已实现 column-span,但没有产出 .full-width 标记的来源:模型看不到图的像素宽,判不了通栏;要做得在前端回填图片时按实际宽度打标',
    figureWidthHalf: '双栏下 max-width:100% 已等价于半栏宽,无需额外配置',
    linesPerPage: '每页行数是排版约束,由页高与行距共同决定,不是可直接下发的属性',
    charsPerLine: '每行字数同理,由栏宽与字号决定',
    inFigureFont: '图内文字属于图片本身(位图/矢量),排版层改不了', inFigureSize: '同上',
};

const declaredFields = (): string[] => {
    const types = read('types.ts');
    const start = types.indexOf('export interface StyleConfig');
    const block = types.slice(start, types.indexOf('\n}', start));
    return [...block.matchAll(/^\s*([a-zA-Z][a-zA-Z0-9]*)\??:/gm)].map((m) => m[1]);
};

const fieldsReadBy = (file: string, prefix: string): Set<string> => {
    const src = read(file);
    const declared = new Set(declaredFields());
    const found = new Set<string>();
    for (const m of src.matchAll(new RegExp(`\\b${prefix}\\.([a-zA-Z][a-zA-Z0-9]*)`, 'g'))) {
        if (declared.has(m[1])) found.add(m[1]);
    }
    return found;
};

describe('styleConfig 字段覆盖:预览与导出必须读同一批字段', () => {
    const previewFields = fieldsReadBy('utils/previewStyles.ts', 's');
    const docxFields = fieldsReadBy('utils/docxGenerator.ts', 'styleConfig');

    it('导出侧读的字段,预览侧都要读(否则预览与成品不一致)', () => {
        const missing = [...docxFields]
            .filter((f) => !previewFields.has(f) && !(f in EXPORT_ONLY) && !(f in NOT_IMPLEMENTED))
            .sort();
        expect(missing, `这些字段只有导出读、预览不读:${missing.join(', ')}`).toEqual([]);
    });

    it('预览侧读的字段,导出侧也要读(否则预览有效果、导出丢失)', () => {
        const missing = [...previewFields].filter((f) => !docxFields.has(f) && !(f in NOT_IMPLEMENTED)).sort();
        expect(missing, `这些字段只有预览读、导出不读:${missing.join(', ')}`).toEqual([]);
    });

    it('豁免清单里的字段确实只被导出侧读(过期豁免要及时清掉)', () => {
        const stale = Object.keys(EXPORT_ONLY).filter((f) => previewFields.has(f));
        expect(stale, `这些字段预览侧已经支持了,请从 EXPORT_ONLY 移除:${stale.join(', ')}`).toEqual([]);
    });

    it('预设里配置的字段,不能一处都没人消费(死配置)', () => {
        const consumers = [
            read('utils/previewStyles.ts'), read('utils/docxGenerator.ts'),
            read('Home.tsx'), read('services/geminiService.ts'),
        ].join('\n');
        const dead: string[] = [];
        for (const preset of PRESETS) {
            for (const field of Object.keys(preset.styleConfig)) {
                if (field in EXPORT_ONLY || field in NOT_IMPLEMENTED) continue;
                if (!new RegExp(`\\.${field}\\b`).test(consumers)) dead.push(`${preset.title}.${field}`);
            }
        }
        expect([...new Set(dead)], `这些配置写了但没人读:${dead.join(', ')}`).toEqual([]);
    });

    it('未落地清单不能过期:一旦两边都实现了,要从清单里移除', () => {
        const stale = Object.keys(NOT_IMPLEMENTED).filter((f) => previewFields.has(f) && docxFields.has(f));
        expect(stale, `这些字段已经两边都实现了,请从 NOT_IMPLEMENTED 移除:${stale.join(', ')}`).toEqual([]);
    });

    it('每个预设都能生成完整样式(冒烟)', () => {
        for (const p of PRESETS) {
            const css = generatePreviewStyles(p.styleConfig, true);
            expect(css.length, p.title).toBeGreaterThan(2000);
        }
    });
});
