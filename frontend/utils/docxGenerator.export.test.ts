import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { PRESETS } from '../constants';
import { generateDocx } from './docxGenerator';
import { DocPreset } from '../types';

/**
 * 真正跑一遍导出:生成 .docx、解开包、读 XML。
 *
 * 之前这条路只有"类型能过、单测能过"的保障 —— 但 makeFont 之类的函数在导出路径上处处被调,
 * 改坏了不会有任何单测报警,只会让用户下载到一个打不开的文件。这里必须端到端生成一次。
 */

const styleOf = (id: DocPreset) => PRESETS.find((p) => p.id === id)!.styleConfig;

const SAMPLE = `
  <h1 class="doc-title">基于时序聚类的园区多能负荷短期预测方法</h1>
  <h2 class="doc-title-en">A Short-term Multi-energy Load Forecasting Method</h2>
  <div class="author-info">陈屿舟，方岚</div>
  <div class="affiliation">（东临大学能源与动力工程学院）</div>
  <div class="abstract-cn"><p>摘要：本文提出一种基于时序聚类的短期负荷预测方法。</p></div>
  <p class="keywords">关键词：多能负荷；短期预测</p>
  <hr class="journal-split">
  <h2>1 引言</h2>
  <p>随着综合能源服务的推进，园区已由单一供电对象演变为多能耦合的用能主体。</p>
  <div class="table-caption">表1 方法性能对比表</div>
  <table>
    <tr><th>方法</th><th>电负荷</th></tr>
    <tr><td>基准方法</td><td>5.28</td></tr>
    <tr><td>本文方法</td><td>3.42</td></tr>
  </table>
`;

/** 生成 .docx 并解出 word/document.xml */
const buildDocx = async (id: DocPreset) => {
    const blob = await generateDocx(SAMPLE, styleOf(id));
    const buf = Buffer.from(await blob.arrayBuffer());
    // zip 魔数:文件本身必须是合法压缩包,否则 Word 直接打不开
    expect(buf.subarray(0, 2).toString('binary'), 'docx 不是合法 zip').toBe('PK');
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml')!.async('string');
    return { buf, zip, xml };
};

describe('导出 .docx:端到端真正生成一次', () => {
    it.each(PRESETS.map((p) => [p.title, p.id] as const))('%s 能生成结构完整的 docx', async (title, id) => {
        const { buf, zip, xml } = await buildDocx(id);
        expect(buf.length, `${title} 生成的文件过小`).toBeGreaterThan(3000);
        // OOXML 的必备部件,缺一个 Word 就报"文件已损坏"
        for (const part of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) {
            expect(zip.file(part), `${title} 缺少 ${part}`).toBeTruthy();
        }
        expect(xml).toContain('基于时序聚类');
        expect(xml).toContain('随着综合能源服务的推进');
        expect(xml).toContain('本文方法');           // 表格内容没丢
    }, 30000);

    it('期刊:三线表 —— 竖线与行间横线都不画', async () => {
        const { xml } = await buildDocx(DocPreset.ACADEMIC_JOURNAL);
        const tbl = xml.slice(xml.indexOf('<w:tbl>'), xml.indexOf('</w:tbl>') + 8);
        expect(tbl).toContain('w:insideV');
        // 三线表:内竖线/内横线必须是 none
        const insideV = /<w:insideV[^/]*w:val="([a-z]+)"/.exec(tbl)?.[1];
        const insideH = /<w:insideH[^/]*w:val="([a-z]+)"/.exec(tbl)?.[1];
        expect(insideV, '期刊表格仍画着竖线').toBe('none');
        expect(insideH, '期刊表格仍画着行间横线').toBe('none');
    }, 30000);

    it('工作报告:仍是全网格表,没被三线表波及', async () => {
        const { xml } = await buildDocx(DocPreset.ACADEMIC);
        const tbl = xml.slice(xml.indexOf('<w:tbl>'), xml.indexOf('</w:tbl>') + 8);
        const insideV = /<w:insideV[^/]*w:val="([a-z]+)"/.exec(tbl)?.[1];
        expect(insideV, '非期刊预设的表格竖线被误删').not.toBe('none');
    }, 30000);

    it('中英混排:期刊的西文字体落到 ascii 面', async () => {
        const journal = styleOf(DocPreset.ACADEMIC_JOURNAL);
        const { xml } = await buildDocx(DocPreset.ACADEMIC_JOURNAL);
        if (!journal.bodyFontEn) return;                       // 未配置则跳过
        const en = journal.bodyFontEn.split(',')[0].replace(/['"]/g, '').trim();
        expect(xml, `西文字体 ${en} 没有写进 ascii 面`).toContain(`w:ascii="${en}"`);
    }, 30000);

    it('页边距按预设写入(不是兜底值)', async () => {
        const { zip } = await buildDocx(DocPreset.ACADEMIC_JOURNAL);
        const xml = await zip.file('word/document.xml')!.async('string');
        const pm = styleOf(DocPreset.ACADEMIC_JOURNAL).pageMargins!;
        // 2.5cm → 25mm → twip = 25/25.4*1440 ≈ 1417
        const expectTop = Math.round((parseFloat(pm.top) * 10 / 25.4) * 1440);
        const top = /w:top="(\d+)"/.exec(xml.slice(xml.indexOf('<w:pgMar')))?.[1];
        expect(Math.abs(Number(top) - expectTop), `上边距 ${top} 与预设 ${expectTop} 不符`).toBeLessThan(20);
    }, 30000);
});
