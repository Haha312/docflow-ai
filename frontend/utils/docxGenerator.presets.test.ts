import { describe, expect, it } from 'vitest';
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

const paragraphs = (xml: string): string[] => xml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
const paragraphContaining = (xml: string, text: string): string => paragraphs(xml).find((p) => p.includes(text)) || '';
const firstAttr = (xml: string, tag: string, name: string): number =>
  parseInt(new RegExp(`<w:${tag}[^>]*w:${name}="(\\d+)"`).exec(xml)?.[1] ?? '0', 10);

const COMMON_HTML = `
<h1 class="doc-title">新能源工程数字化设计方案</h1>
<h2>1. 总体目标</h2>
<p>项目以统一数据底座为基础，提升设计协同效率和成果交付质量。</p>
<h3>1.1 设计原则</h3>
<p>系统应保持结构清晰、权限明确、过程可追溯。</p>
<h4>1.1.1 实施路径</h4>
<p>先完成数据治理，再分阶段接入专业设计模块。</p>
<div class="figure-caption">图1 平台总体架构</div>
<table><tr><th>模块</th><th>作用</th></tr><tr><td>数据中心</td><td>统一管理工程数据</td></tr></table>
<div class="table-caption">表1 功能模块说明</div>
`;

describe('generateDocx 全模板导出硬指标', () => {
  it('报告/论文: 正文 h2/h3/h4 导出为 Word 1/2/3 级标题，正文小四 1.5 倍行距', async () => {
    const xml = await docXml(COMMON_HTML, DocPreset.ACADEMIC);
    const h2 = paragraphContaining(xml, '总体目标');
    const h3 = paragraphContaining(xml, '设计原则');
    const h4 = paragraphContaining(xml, '实施路径');
    const body = paragraphContaining(xml, '项目以统一数据底座');

    expect(h2).toContain('<w:pStyle w:val="Heading1"/>');
    expect(h2).toContain('<w:sz w:val="30"/>');
    expect(h3).toContain('<w:pStyle w:val="Heading2"/>');
    expect(h3).toContain('<w:sz w:val="28"/>');
    expect(h4).toContain('<w:pStyle w:val="Heading3"/>');
    expect(h4).toContain('<w:sz w:val="24"/>');
    expect(body).toContain('<w:sz w:val="24"/>');
    expect(body).toContain('w:firstLineChars="200"');
    expect(body).toContain('w:line="360"');
  });

  it('机关公文: GB/T 页边距、28磅固定行距、红线和正文层级正确', async () => {
    const html = `
      <div class="doc-issuer">某某市人民政府文件</div>
      <hr class="doc-divider">
      <p class="doc-ref-number">某政发〔2026〕1号</p>
      <h1 class="doc-title">关于推进数字化协同工作的通知</h1>
      <p class="doc-addressee">各区人民政府：</p>
      <h2>一、总体要求</h2>
      <p>各单位要按照统一部署推进系统建设。</p>
      <h3>（一）基本原则</h3>
      <p>坚持统筹规划、分步实施。</p>
      <h4>1. 具体措施</h4>
      <p>明确责任分工和时间节点。</p>
    `;
    const xml = await docXml(html, DocPreset.CORPORATE);
    const h2 = paragraphContaining(xml, '总体要求');
    const h3 = paragraphContaining(xml, '基本原则');
    const body = paragraphContaining(xml, '各单位要按照统一部署');

    expect(firstAttr(xml, 'pgMar', 'top')).toBe(mm(37));
    expect(firstAttr(xml, 'pgMar', 'bottom')).toBe(mm(35));
    expect(firstAttr(xml, 'pgMar', 'left')).toBe(mm(28));
    expect(firstAttr(xml, 'pgMar', 'right')).toBe(mm(26));
    expect(xml).toMatch(/<w:bottom w:val="single" w:color="CC0000"/);
    expect(h2).toContain('<w:pStyle w:val="Heading1"/>');
    expect(h2).toContain('<w:sz w:val="32"/>');
    expect(h2).toContain('w:line="560"');
    expect(h3).toContain('<w:pStyle w:val="Heading2"/>');
    expect(body).toContain('<w:sz w:val="32"/>');
    expect(body).toContain('<w:spacing w:before="0" w:after="0" w:line="560" w:lineRule="exact"/>');
    expect(body).toContain('w:firstLineChars="200"');
  });

  it('工作汇报/方案: 机关材料页边距、目录开关、三号仿宋正文和28磅固定行距', async () => {
    const html = `
      <h1 class="doc-title">数字化建设工作汇报</h1>
      <p class="doc-subtitle">2026年上半年</p>
      <p class="doc-meta">信息化办公室</p>
      <h2>一、工作进展</h2>
      <p>围绕年度重点任务，持续推进平台建设和数据治理。</p>
      <h3>（一）平台建设情况</h3>
      <p>已完成核心功能上线和试运行。</p>
      <h4>1. 下一步安排</h4>
      <p>继续完善应用场景。</p>
    `;
    const xml = await docXml(html, DocPreset.WORK_REPORT);
    const subtitle = paragraphContaining(xml, '2026年上半年');
    const meta = paragraphContaining(xml, '信息化办公室');
    const h2 = paragraphContaining(xml, '工作进展');
    const body = paragraphContaining(xml, '围绕年度重点任务');

    expect(firstAttr(xml, 'pgMar', 'top')).toBe(mm(30));
    expect(firstAttr(xml, 'pgMar', 'bottom')).toBe(mm(28));
    expect(xml).toContain('<w:instrText');
    expect(xml).toContain('TOC \\h');
    expect(subtitle).toContain('<w:jc w:val="center"/>');
    expect(meta).toContain('<w:jc w:val="center"/>');
    expect(h2).toContain('<w:pStyle w:val="Heading1"/>');
    expect(h2).toContain('<w:sz w:val="32"/>');
    expect(body).toContain('<w:sz w:val="32"/>');
    expect(body).toContain('<w:spacing w:before="0" w:after="0" w:line="560" w:lineRule="exact"/>');
    expect(body).toContain('w:firstLineChars="200"');
  });

  it('会议纪要: 会议元信息不首行缩进、正文28磅固定行距且不生成目录', async () => {
    const html = `
      <h1 class="doc-title">项目推进会会议纪要</h1>
      <p class="meeting-issue">第3期</p>
      <div class="meeting-meta">
        <p>会议时间：2026年7月1日</p>
        <p>会议地点：第一会议室</p>
        <p>主持人：张三</p>
        <p>参会人员：李四、王五</p>
      </div>
      <h2>一、会议议题</h2>
      <p>会议听取了项目推进情况汇报。</p>
      <h3>（一）议定事项</h3>
      <p>由信息化办公室牵头完善实施计划。</p>
    `;
    const xml = await docXml(html, DocPreset.MEETING_MINUTES);
    const issue = paragraphContaining(xml, '第3期');
    const meta = paragraphContaining(xml, '会议时间');
    const h2 = paragraphContaining(xml, '会议议题');
    const body = paragraphContaining(xml, '会议听取了项目推进情况汇报');

    expect(xml).not.toContain('<w:instrText');
    expect(xml).not.toContain('TOC \\h');
    expect(firstAttr(xml, 'pgMar', 'top')).toBe(mm(30));
    expect(issue).toContain('<w:jc w:val="center"/>');
    expect(meta).not.toContain('w:firstLineChars');
    expect(h2).toContain('<w:pStyle w:val="Heading1"/>');
    expect(body).toContain('<w:sz w:val="32"/>');
    expect(body).toContain('w:line="560"');
  });

  it('互联网文档: 无首行缩进、段后12pt、h2 为 Word 一级标题、代码块等宽', async () => {
    const html = `
      <h1 class="doc-title">接口使用说明</h1>
      <h2>1. 快速开始</h2>
      <p>调用接口前需要先创建访问密钥。</p>
      <h3>1.1 请求参数</h3>
      <p>字段 <code>token</code> 用于鉴权。</p>
      <pre><code>curl https://example.com/api</code></pre>
    `;
    const xml = await docXml(html, DocPreset.MINIMALIST);
    const h2 = paragraphContaining(xml, '快速开始');
    const h3 = paragraphContaining(xml, '请求参数');
    const body = paragraphContaining(xml, '调用接口前');
    const code = paragraphContaining(xml, 'curl https://example.com/api');

    expect(h2).toContain('<w:pStyle w:val="Heading1"/>');
    expect(h2).toContain('<w:sz w:val="32"/>');
    expect(h3).toContain('<w:pStyle w:val="Heading2"/>');
    expect(h3).toContain('<w:sz w:val="28"/>');
    expect(body).toContain('<w:spacing w:before="0" w:after="240" w:line="384" w:lineRule="auto"/>');
    expect(body).not.toContain('w:firstLineChars');
    expect(code).toContain('Courier New');
  });

  it('通用图题/表题: class 标注的 caption 不应被导出成正文段落', async () => {
    const xml = await docXml(COMMON_HTML, DocPreset.ACADEMIC);
    const figure = paragraphContaining(xml, '图1 平台总体架构');
    const table = paragraphContaining(xml, '表1 功能模块说明');

    expect(figure).not.toContain('w:firstLineChars');
    expect(figure).toContain('<w:jc w:val="center"/>');
    expect(figure).toContain('<w:sz w:val="21"/>');
    expect(table).not.toContain('w:firstLineChars');
    expect(table).toContain('<w:jc w:val="center"/>');
    expect(table).toContain('<w:sz w:val="21"/>');
  });
});
