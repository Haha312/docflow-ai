import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { generateDocx } from './docxGenerator';
import { PRESETS } from '../constants';
import { DocPreset } from '../types';

const styleOf = (id: DocPreset) => PRESETS.find((p) => p.id === id)!.styleConfig;

async function docXml(html: string, preset: DocPreset): Promise<string> {
  const blob = await generateDocx(html, styleOf(preset));
  const buf = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  return zip.file('word/document.xml')!.async('string');
}

const paragraphContaining = (xml: string, text: string): string => {
  const blocks = xml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
  return blocks.find((p) => p.includes(text)) || '';
};

const CREATIVE_HTML = `
<h1 class="doc-title">时间的河流</h1>
<h2>第一章 远行之前</h2>
<p>清晨的街道还没有完全醒来，窗外的风从树叶间穿过。</p>
<h3>第一节 旧地图</h3>
<p>他把地图铺在桌上，沿着折痕寻找那些被铅笔圈出的地名。</p>
<h4>一、 旅途的开端</h4>
<p>那些零散的注记后来成了整本书的线索。</p>
`;

describe('generateDocx 出版物排版', () => {
  it('章标题使用正文 h2，但导出为大号居中目录一级标题', async () => {
    const xml = await docXml(CREATIVE_HTML, DocPreset.CREATIVE);
    const chapter = paragraphContaining(xml, '第一章 远行之前');

    expect(chapter).toContain('<w:pStyle w:val="Heading1"/>');
    expect(chapter).toContain('<w:jc w:val="center"/>');
    expect(chapter).toContain('<w:sz w:val="48"/>');
    expect(chapter).toContain('<w:spacing w:before="960" w:after="480"');
  });

  it('节/小节按出版物目录层级下沉，正文保持五号宋体固定18磅行距', async () => {
    const xml = await docXml(CREATIVE_HTML, DocPreset.CREATIVE);
    const section = paragraphContaining(xml, '第一节 旧地图');
    const subsection = paragraphContaining(xml, '一、 旅途的开端');
    const body = paragraphContaining(xml, '清晨的街道');

    expect(section).toContain('<w:pStyle w:val="Heading2"/>');
    expect(section).toContain('<w:sz w:val="28"/>');
    expect(subsection).toContain('<w:pStyle w:val="Heading3"/>');
    expect(subsection).toContain('<w:sz w:val="24"/>');
    expect(body).toContain('<w:sz w:val="21"/>');
    expect(body).toContain('<w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="exact"/>');
    expect(body).toContain('w:firstLineChars="200"');
  });
});
