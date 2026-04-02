// 运行方式: cd D:\docuflow-ai\frontend && node ..\analyze_doc.mjs
import fs from 'fs';
import JSZip from 'jszip';
import mammoth from 'mammoth';

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
  const styleRe = /<w:style\b[^>]*w:type="paragraph"[^>]*>([\s\S]*?)<\/w:style>/g;
  let m;
  while ((m = styleRe.exec(stylesXml)) !== null) {
    const nameM = m[1].match(/w:name[^>]*w:val="([^"]+)"/);
    const idM   = m[0].match(/w:styleId="([^"]+)"/);
    const name  = nameM?.[1] ?? '';
    if (/^(heading\s*\d|标题\s*\d)/i.test(name)) {
      console.log(`  styleId="${idM?.[1]}"  name="${name}"`);
    }
  }

  // ── numbering.xml ──
  const numEntry = zip.file('word/numbering.xml');
  if (numEntry) {
    const numXml = await numEntry.async('text');
    const abstractNumCount = (numXml.match(/<w:abstractNum\b/g) || []).length;
    const numCount = (numXml.match(/<w:num\b/g) || []).length;
    console.log('\n=== 编号配置 ===');
    console.log('abstractNum 定义数:', abstractNumCount);
    console.log('num 实例数:', numCount);
  } else {
    console.log('\n=== 编号配置 === (无 numbering.xml)');
  }

  // ── mammoth 转换结果 ──
  console.log('\n=== Mammoth HTML 转换 ===');
  const result = await mammoth.convertToHtml({ buffer: buf });
  const html = result.value;
  console.log('HTML长度:', html.length, 'chars');
  console.log('警告数:', result.messages.length);
  result.messages.slice(0, 5).forEach(msg => console.log(' >', msg.message));

  // 统计 HTML 中的标签
  console.log('\n标签分布:');
  for (const tag of ['h1','h2','h3','h4','ol','ul','li','table','img','p']) {
    const re = new RegExp(`<${tag}[\\s>]`, 'gi');
    const count = (html.match(re) || []).length;
    if (count > 0) console.log(`  <${tag}>: ${count}`);
  }

  // 打印前 60 个 <h1>/<h2>/<h3> 的文本
  console.log('\n=== 标题抽样（前60条）===');
  const headingRe = /<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let hCount = 0;
  let hm;
  while ((hm = headingRe.exec(html)) !== null && hCount < 60) {
    const text = hm[2].replace(/<[^>]+>/g, '').trim().slice(0, 80);
    console.log(`  <${hm[1]}> ${text}`);
    hCount++;
  }

  // 检测 PATTERN B（每个 <ol> 只有一个 <li>）
  console.log('\n=== PATTERN B 检测（单item ol块）===');
  const singleOlRe = /<ol><li>([\s\S]*?)<\/li><\/ol>/g;
  let patternBCount = 0;
  let pbm;
  while ((pbm = singleOlRe.exec(html)) !== null) {
    patternBCount++;
    if (patternBCount <= 5) {
      console.log(`  [${patternBCount}] "${pbm[1].replace(/<[^>]+>/g,'').trim().slice(0,60)}"`);
    }
  }
  console.log('PATTERN B 总计:', patternBCount, '个单item ol');

  // 检测连续 <ol> (PATTERN A)
  const patternA = (html.match(/<\/ol>\s*<ol>/g) || []).length;
  console.log('PATTERN A (连续ol):', patternA, '处');

  // chunk 大小估算
  console.log('\n=== 分块预估 ===');
  const CHUNK_SIZE = 12000;
  const estimatedChunks = Math.ceil(html.length / CHUNK_SIZE);
  console.log(`HTML ${html.length} chars → 约 ${estimatedChunks} 个 chunk（@${CHUNK_SIZE} chars/chunk）`);
}

main().catch(err => { console.error(err); process.exit(1); });
