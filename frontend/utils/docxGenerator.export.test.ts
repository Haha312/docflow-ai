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

    // 参考文献的字体/行距/悬挂缩进配了很久却一直是死配置:预览和导出都读,
    // 生成层从不产出 .references 元素。现在由后端确定性打标,这里守住导出这一端。
    it('参考文献的悬挂缩进真的写进了 docx', async () => {
        const journal = styleOf(DocPreset.ACADEMIC_JOURNAL);
        const html = `${SAMPLE}<h2>参考文献</h2><ol class="references"><li>[1] 张三. 题名[J]. 刊名, 2024, 40(3): 1-8.</li><li>[2] 李四. 题名[M]. 北京: 某出版社, 2023.</li></ol>`;
        const blob = await generateDocx(html, journal);
        const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
        const xml = await zip.file('word/document.xml')!.async('string');
        // 0.63cm → twip ≈ 357
        const expected = Math.round(parseFloat(journal.referencesHangingIndent!) * 566.93);
        // 按文献那一段定位:文档里别处(表格单元格)也有 w:ind,取全文第一个会取错
        const at = xml.indexOf('题名[J]');
        expect(at, '文献没进导出').toBeGreaterThan(0);
        const para = xml.slice(xml.lastIndexOf('<w:p>', at), at);
        const m = /<w:ind[^>]*w:hanging="(\d+)"/.exec(para);
        expect(m, '文献段落上没有悬挂缩进').not.toBeNull();
        expect(Math.abs(Number(m![1]) - expected), `悬挂缩进 ${m![1]} 与预设 ${expected} 不符`).toBeLessThan(10);
        // 两条文献各自成段,没有被并成一段
        expect(xml).toContain('题名[J]');
        expect(xml).toContain('题名[M]');
    }, 30000);

    it('DOI 用自己的字体字号,不再借关键词的', async () => {
        const journal = styleOf(DocPreset.ACADEMIC_JOURNAL);
        const blob = await generateDocx(`${SAMPLE}<p class="doc-doi">DOI: 10.13335/j.1000.2024.03.001</p>`, journal);
        const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
        const xml = await zip.file('word/document.xml')!.async('string');
        const i = xml.indexOf('10.13335');
        expect(i, 'DOI 没进导出').toBeGreaterThan(0);
        const para = xml.slice(xml.lastIndexOf('<w:p ', i) === -1 ? xml.lastIndexOf('<w:p>', i) : xml.lastIndexOf('<w:p ', i), i);
        const en = journal.doiFont!.split(',')[0].replace(/['"]/g, '').trim();
        expect(para, `DOI 字体 ${en} 没写进去`).toContain(en);
        // 期刊预设 doiBold: true
        expect(para).toContain('<w:b/>');
    }, 30000);

    // 富文本编辑器里改某一段的字体/字号,产出的是行内样式。导出侧此前只认粗体/斜体/下划线,
    // 行内字体一律丢弃 —— 用户在编辑器里改完,预览是对的,下载下来又变回原样。
    it('编辑器里改的行内字体字号进得了 docx', async () => {
        const html = `${SAMPLE}<p>正文里<span style="font-family: &quot;KaiTi&quot;, serif; font-size: 18pt">这几个字改成了楷体小二</span>其余不变。</p>`;
        const blob = await generateDocx(html, styleOf(DocPreset.ACADEMIC));
        const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
        const xml = await zip.file('word/document.xml')!.async('string');
        const i = xml.indexOf('楷体小二');
        expect(i, '这段文字没进导出').toBeGreaterThan(0);
        const run = xml.slice(xml.lastIndexOf('<w:r>', i), i);
        expect(run, '行内字体没写进去').toContain('KaiTi');
        expect(run, '行内字号没写进去(18pt = 36 半磅)').toContain('w:val="36"');
    }, 30000);

    // 标题走的是另一条导出路径(整行一个 run),在标题里改字体原本会被悄悄吃掉
    it('标题里改的行内字体也进得了 docx', async () => {
        const html = `${SAMPLE}<h2>正常章标题<span style="font-family: KaiTi, serif">这几个字改成楷体</span></h2>`;
        const blob = await generateDocx(html, styleOf(DocPreset.ACADEMIC));
        const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
        const xml = await zip.file('word/document.xml')!.async('string');
        const i = xml.indexOf('这几个字改成楷体');
        expect(i, '标题文字没进导出').toBeGreaterThan(0);
        const run = xml.slice(xml.lastIndexOf('<w:r>', i), i);
        expect(run, '标题里的行内字体丢了').toContain('KaiTi');
        // 同一标题里没改字体的那半仍是标题字体、且保持加粗
        const j = xml.indexOf('正常章标题');
        const run0 = xml.slice(xml.lastIndexOf('<w:r>', j), j);
        expect(run0, '标题原有的加粗丢了').toContain('<w:b/>');
    }, 30000);

    // styleWithCSS 开着的浏览器(以及网页粘贴)产出的加粗是 <span style="font-weight:bold">,
    // 不是 <b> —— 只按标签识别的话这类加粗会静默丢失
    it('span 行内样式形态的粗/斜体也进得了 docx', async () => {
        const html = `${SAMPLE}<p>前文<span style="font-weight: bold">样式加粗</span>与<span style="font-style: italic">样式斜体</span>后文</p>`;
        const blob = await generateDocx(html, styleOf(DocPreset.ACADEMIC));
        const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
        const xml = await zip.file('word/document.xml')!.async('string');
        const boldAt = xml.indexOf('样式加粗');
        expect(boldAt).toBeGreaterThan(0);
        expect(xml.slice(xml.lastIndexOf('<w:r>', boldAt), boldAt), 'span 形态加粗丢了').toContain('<w:b/>');
        const italAt = xml.indexOf('样式斜体');
        expect(xml.slice(xml.lastIndexOf('<w:r>', italAt), italAt), 'span 形态斜体丢了').toContain('<w:i/>');
    }, 30000);

    it('标题里的编号空格不被正文那套空格清理吃掉', async () => {
        const html = `${SAMPLE}<h2>2. 方法<span style="font-family: KaiTi, serif">设计</span></h2>`;
        const blob = await generateDocx(html, styleOf(DocPreset.ACADEMIC));
        const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
        const xml = await zip.file('word/document.xml')!.async('string');
        const all = [...xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join('');
        expect(all, '编号后的空格被吃掉了').toContain('2. 方法设计');
    }, 30000);

    it('没改字体的标题仍走原来的整行输出', async () => {
        const { xml } = await buildDocx(DocPreset.ACADEMIC);
        const i = xml.indexOf('引言');
        if (i > 0) {
            const run = xml.slice(xml.lastIndexOf('<w:r>', i), i);
            expect(run).toContain('<w:b/>');
        }
    }, 30000);

    it('没改字体的部分仍按预设走,不被行内样式带偏', async () => {
        const st = styleOf(DocPreset.ACADEMIC);
        const html = `${SAMPLE}<p>前半段<span style="font-size: 18pt">改过</span>后半段</p>`;
        const blob = await generateDocx(html, st);
        const zip = await JSZip.loadAsync(Buffer.from(await blob.arrayBuffer()));
        const xml = await zip.file('word/document.xml')!.async('string');
        const i = xml.indexOf('后半段');
        const run = xml.slice(xml.lastIndexOf('<w:r>', i), i);
        const baseHalfPt = Math.round(parseFloat(st.baseSize) * 2);
        expect(run, `后半段应回到预设字号 ${baseHalfPt}`).toContain(`w:val="${baseHalfPt}"`);
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
