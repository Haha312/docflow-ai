// 运行: node analyze_doc.cjs  （在 D:\docuflow-ai\frontend 目录下）
const fs = require('fs');
const JSZip = require('jszip');
const mammoth = require('mammoth');

const FILE = 'C:\\Users\\86188\\Desktop\\基于三维信息技术的新能源电站数字化设计关键技术研究报告(1).docx';

async function main() {
  const buf = fs.readFileSync(FILE);
  console.log('=== 文件基本信息 ===');
  console.log('文件大小:', (buf.length / 1024).toFixed(1), 'KB');

  const zip = await JSZip.loadAsync(buf);

  // ── document.xml 基础统计 ──
  const docXml = await zip.file('word/document.xml').async('text');
  console.log('\n=== document.xml 统计 ===');
  console.log('XML大小:', (docXml.length / 1024).toFixed(1), 'KB');
  console.log('段落数(w:p):', (docXml.match(/<w:p[ >]/g) || []).length);
  console.log('表格数(w:tbl):', (docXml.match(/<w:tbl[ >]/g) || []).length);
  console.log('OMML公式数(m:oMath):', (docXml.match(/<m:oMath[ >]/g) || []).length);
  console.log('图片inline:', (docXml.match(/<wp:inline/g) || []).length);
  console.log('图片anchor:', (docXml.match(/<wp:anchor/g) || []).length);

  // ── 样式分析 ──
  const stylesXml = await zip.file('word/styles.xml').async('text');
  console.log('\n=== 标题样式 ===');
  const styleBlocks = stylesXml.match(/<w:style\b[\s\S]*?<\/w:style>/g) || [];
  for (const block of styleBlocks) {
    const nameM = block.match(/w:name[^/]*w:val="([^"]+)"/);
    const idM   = block.match(/w:styleId="([^"]+)"/);
    const name  = nameM?.[1] ?? '';
    if (/^(heading\s*\d|标题\s*\d)/i.test(name)) {
      console.log(`  styleId="${idM?.[1]}"  name="${name}"`);
    }
  }

  // ── numbering.xml ──
  const numEntry = zip.file('word/numbering.xml');
  if (numEntry) {
    const numXml = await numEntry.async('text');
    console.log('\n=== 编号配置 ===');
    console.log('abstractNum 定义数:', (numXml.match(/<w:abstractNum\b/g) || []).length);
    console.log('num 实例数:', (numXml.match(/<w:num\b/g) || []).length);
  } else {
    console.log('\n=== 编号配置 === (无 numbering.xml)');
  }

  // ── mammoth 转换 ──
  console.log('\n=== Mammoth HTML 转换 ===');
  const result = await mammoth.convertToHtml({ buffer: buf });
  const html = result.value;
  console.log('HTML长度:', html.length, 'chars');
  console.log('警告数:', result.messages.length);
  result.messages.slice(0, 8).forEach(msg => console.log(' >', msg.message));

  console.log('\n标签分布:');
  for (const tag of ['h1','h2','h3','h4','ol','ul','li','table','img','p']) {
    const count = (html.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length;
    if (count > 0) console.log(`  <${tag}>: ${count}`);
  }

  // ── 标题抽样 ──
  console.log('\n=== 标题抽样（全部 h1/h2/h3）===');
  const headingRe = /<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let hm;
  while ((hm = headingRe.exec(html)) !== null) {
    const text = hm[2].replace(/<[^>]+>/g, '').trim().slice(0, 80);
    console.log(`  <${hm[1]}> ${text}`);
  }

  // ── PATTERN B 检测 ──
  console.log('\n=== PATTERN B（单item <ol>）===');
  const singleOlRe = /<ol><li>([\s\S]*?)<\/li><\/ol>/g;
  let pbCount = 0, pbm;
  while ((pbm = singleOlRe.exec(html)) !== null) {
    pbCount++;
    if (pbCount <= 10) {
      console.log(`  [${pbCount}] "${pbm[1].replace(/<[^>]+>/g,'').trim().slice(0,70)}"`);
    }
  }
  console.log('PATTERN B 总计:', pbCount, '个');

  // ── PATTERN A 检测 ──
  console.log('PATTERN A（连续<ol>）:', (html.match(/<\/ol>\s*<ol>/g) || []).length, '处');

  // ── 分块预估 ──
  console.log('\n=== 分块预估 ===');
  for (const chunkSize of [6000, 9000, 12000, 16000]) {
    console.log(`  @${chunkSize} chars → 约 ${Math.ceil(html.length / chunkSize)} 个chunk`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
