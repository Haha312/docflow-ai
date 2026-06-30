import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { convertMillimetersToTwip } from 'docx';
import { generateDocx } from './docxGenerator';
import { PRESETS } from '../constants';
import { DocPreset } from '../types';

const mm = convertMillimetersToTwip;
const styleOf = (id: DocPreset) => PRESETS.find((p) => p.id === id)!.styleConfig;

async function docXml(html: string, preset: DocPreset): Promise<string> {
  const blob = await generateDocx(html, styleOf(preset));
  const buf = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  return zip.file('word/document.xml')!.async('string');
}
const attr = (xml: string, tag: string, name: string): number =>
  parseInt(new RegExp(`<w:${tag}[^>]*w:${name}="(\\d+)"`).exec(xml)?.[1] ?? '0', 10);

// 一篇有代表性的"长"期刊文章:篇首(标题/作者/单位/摘要/关键词)+ 多级章节 + 三线表 + 图题 + 参考文献
const JOURNAL_HTML = `
<h1 class="doc-title">基于GIS+BIM的新能源工程数字化协同设计平台</h1>
<div class="cover-meta">张三，李四</div>
<div class="affiliation">（电力系统技术研究院，北京 100000）</div>
<div class="abstract-cn"><p>摘要：本文提出一种融合GIS与BIM的协同设计平台，实现了风光电站的数字化设计。</p></div>
<div class="keywords">关键词：GIS；BIM；协同设计；新能源</div>
<h2>0 引言</h2><p>新能源工程数字化是行业趋势。</p>
<h2>1 平台目标</h2><p>实现高效协同。</p>
<h3>1.1 协同工作</h3><p>跨专业协同。</p>
<h3>1.2 精细化管理</h3><p>资源精细化。</p>
<h2>2 平台架构</h2><p>分层架构。</p>
<table><tr><th>设备</th><th>参数</th></tr><tr><td>燃气轮机</td><td>1000kW</td></tr><tr><td>余热锅炉</td><td>800kW</td></tr></table>
<p>表1 主要设备参数</p>
<p>图1 平台架构示意图</p>
<h2>3 总结</h2><p>本文实现了协同设计平台。</p>
`;

describe('generateDocx 学术期刊(PST 规范)深度核对', () => {
  it('页面几何:页边距 2.5/1.7/2.0/2.0 + 页眉1.8/页脚0 + A4', async () => {
    const xml = await docXml(JOURNAL_HTML, DocPreset.ACADEMIC_JOURNAL);
    expect(attr(xml, 'pgMar', 'top')).toBe(mm(25));     // 2.5cm
    expect(attr(xml, 'pgMar', 'bottom')).toBe(mm(17));  // 1.7cm
    expect(attr(xml, 'pgMar', 'left')).toBe(mm(20));    // 2.0cm
    expect(attr(xml, 'pgMar', 'right')).toBe(mm(20));   // 2.0cm
    expect(attr(xml, 'pgMar', 'header')).toBe(mm(18));  // 页眉1.8cm
    expect(attr(xml, 'pgMar', 'footer')).toBe(mm(0));   // 页脚0
    expect(attr(xml, 'pgSz', 'w')).toBe(mm(210));       // A4
    expect(attr(xml, 'pgSz', 'h')).toBe(mm(297));
  });

  it('双栏:正文节 w:cols num=2 + 栏间距 0.78cm', async () => {
    const xml = await docXml(JOURNAL_HTML, DocPreset.ACADEMIC_JOURNAL);
    const cols = /<w:cols\b[^>]*w:num="2"[^>]*>/.exec(xml) || /<w:cols\b[^>]*w:space="(\d+)"[^>]*w:num="2"/.exec(xml);
    expect(xml).toMatch(/<w:cols\b[^>]*w:num="2"/);     // 存在 2 栏节
    expect(attr(xml, 'cols', 'space')).toBe(mm(7.8));   // 0.78cm 栏间距
  });

  it('标题字号:文档标题二号(44 half-pt) / 章小四(24) / 三级五号(21)', async () => {
    const xml = await docXml(JOURNAL_HTML, DocPreset.ACADEMIC_JOURNAL);
    expect(xml).toMatch(/<w:sz w:val="44"\/>/);  // 文档标题 22pt
    expect(xml).toMatch(/<w:sz w:val="24"\/>/);  // 章标题 12pt (小四)
    expect(xml).toMatch(/<w:sz w:val="21"\/>/);  // 三级标题 10.5pt (五号)
  });

  it('三线表:外框线 0.75pt(sz=6)+ 内线 0.5pt(sz=4)', async () => {
    const xml = await docXml(JOURNAL_HTML, DocPreset.ACADEMIC_JOURNAL);
    expect(xml).toMatch(/<w:tblBorders>/);
    expect(xml).toMatch(/w:sz="6"/);  // 外框 0.75pt
    expect(xml).toMatch(/w:sz="4"/);  // 内线 0.5pt
  });

  it('DUMP: sectPr / 首个 tblBorders(供肉眼核对)', async () => {
    const xml = await docXml(JOURNAL_HTML, DocPreset.ACADEMIC_JOURNAL);
    const sectprs = xml.match(/<w:sectPr[\s\S]*?<\/w:sectPr>/g) || [];
    // eslint-disable-next-line no-console
    console.log('\n===== sectPr 节数:', sectprs.length, '=====');
    sectprs.forEach((s, i) => console.log(`--- sectPr #${i} ---\n` + s.replace(/></g, '>\n<')));
    const tbl = /<w:tblBorders>[\s\S]*?<\/w:tblBorders>/.exec(xml);
    // eslint-disable-next-line no-console
    console.log('\n===== tblBorders =====\n' + (tbl ? tbl[0].replace(/></g, '>\n<') : 'NONE'));
  });
});
