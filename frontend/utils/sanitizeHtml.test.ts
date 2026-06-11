import { describe, it, expect, beforeAll } from 'vitest';
import JSZip from 'jszip';
import mammoth from 'mammoth';
import { sanitizeDocxPreview } from './sanitizeHtml';

/**
 * 这些用例从「用户友好性 + 安全」两个角度验证 .docx 原文对比预览:
 *  1. 真实管线:构造恶意 .docx → 跑 FileDropzone 同款 mammoth.convertToHtml → 过 sanitizeDocxPreview。
 *     证明危险向量被中和,同时排版内容(标题/表格/合法链接)完好。
 *  2. 直接净化:针对 mammoth 之外可能出现的标记(<script>、onerror、data: 图片)做边界覆盖。
 */

// 1×1 透明 PNG 的 data URI —— 模拟 mammoth 内嵌图片输出
const DATA_URI_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function buildMaliciousDocx(): Promise<Uint8Array> {
  const zip = new JSZip();

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`,
  );

  zip.folder('_rels')!.file(
    '.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );

  const word = zip.folder('word')!;

  // styles.xml 让 mammoth 把 Heading1 样式名映射成 <h1>
  word.file(
    'styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
</w:styles>`,
  );

  // 攻击向量:外链关系 Target 指向 javascript:,TargetMode=External
  word.folder('_rels')!.file(
    'document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId100" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="javascript:alert(document.domain)//" TargetMode="External"/>
  <Relationship Id="rId200" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/safe" TargetMode="External"/>
</Relationships>`,
  );

  word.file(
    'document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Quarterly Report</w:t></w:r></w:p>
    <w:p><w:r><w:t>Para with </w:t></w:r><w:hyperlink r:id="rId100"><w:r><w:t>malicious link</w:t></w:r></w:hyperlink><w:r><w:t> and a </w:t></w:r><w:hyperlink r:id="rId200"><w:r><w:t>safe link</w:t></w:r></w:hyperlink></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Sales</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>East</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>100</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body>
</w:document>`,
  );

  // mammoth 在 Node 运行时(vitest)只认 path/buffer/file —— 用 uint8array 走 buffer 选项最稳。
  return zip.generateAsync({ type: 'uint8array' });
}

describe('sanitizeDocxPreview — 真实 mammoth 管线端到端', () => {
  let rawMammothHtml: string;
  let sanitized: string;

  beforeAll(async () => {
    const buffer = await buildMaliciousDocx();
    const result = await mammoth.convertToHtml({ buffer });
    rawMammothHtml = result.value;
    sanitized = sanitizeDocxPreview(rawMammothHtml);
  });

  it('前提成立:未净化的 mammoth 产物确实带 javascript: 向量(否则测试无意义)', () => {
    expect(rawMammothHtml).toMatch(/javascript:/i);
  });

  it('安全:净化后 javascript: 协议被剥离', () => {
    expect(sanitized).not.toMatch(/javascript:/i);
  });

  it('用户友好:标题被保留(<h1>Quarterly Report</h1>)', () => {
    expect(sanitized).toContain('<h1>Quarterly Report</h1>');
  });

  it('用户友好:表格结构与单元格内容被保留', () => {
    expect(sanitized).toContain('<table>');
    expect(sanitized).toContain('Region');
    expect(sanitized).toContain('East');
    expect(sanitized).toContain('100');
  });

  it('用户友好:合法 https 链接保留,恶意链接仅去掉 href(文案仍在)', () => {
    expect(sanitized).toContain('href="https://example.com/safe"');
    expect(sanitized).toContain('malicious link'); // 文案保留
    expect(sanitized).not.toContain('href="javascript:alert(document.domain)//"');
  });

  it('净化后用真实 DOM 解析,确认没有任何 javascript: 协议的 <a>', () => {
    const host = document.createElement('div');
    host.innerHTML = sanitized;
    const bad = Array.from(host.querySelectorAll('a')).filter((a) =>
      (a.getAttribute('href') ?? '').trim().toLowerCase().startsWith('javascript:'),
    );
    expect(bad).toHaveLength(0);
    expect(host.querySelector('h1')?.textContent).toBe('Quarterly Report');
    expect(host.querySelectorAll('td')).toHaveLength(4);
  });
});

describe('sanitizeDocxPreview — 直接净化边界覆盖', () => {
  it('剥离 <script> 标签', () => {
    const out = sanitizeDocxPreview('<p>hi</p><script>window.__pwned=1</script>');
    expect(out).toContain('<p>hi</p>');
    expect(out.toLowerCase()).not.toContain('<script');
  });

  it('剥离 onerror 等事件处理属性,但保留 <img>', () => {
    const out = sanitizeDocxPreview('<img src="x" onerror="window.__pwned=1">');
    expect(out.toLowerCase()).not.toContain('onerror');
  });

  it('保留 data: base64 图片(内嵌图片不被清空)', () => {
    const out = sanitizeDocxPreview(`<img src="${DATA_URI_PNG}">`);
    expect(out).toContain('data:image/png;base64,');
  });

  it('保留排版需要的 id 与 style 属性', () => {
    const out = sanitizeDocxPreview('<h2 id="toc-1" style="text-align:center">标题</h2>');
    expect(out).toContain('id="toc-1"');
    expect(out).toContain('text-align:center');
  });
});
