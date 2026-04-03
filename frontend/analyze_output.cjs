// node analyze_output.cjs
const fs = require('fs');
const JSZip = require('jszip');

const FILE = 'E:\\下载内容\\DocFlow_卫星光学遥感影像二次多项式拟合算法实施步骤 (1).docx';

async function main() {
  const buf = fs.readFileSync(FILE);
  const zip = await JSZip.loadAsync(buf);
  const docXml = await zip.file('word/document.xml').async('text');

  // 提取所有段落的样式和文字
  const paraRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pm;
  console.log('=== 输出文档段落样式 (前60条) ===');
  let count = 0;
  while ((pm = paraRe.exec(docXml)) !== null && count < 60) {
    const pContent = pm[1];
    const styleM = pContent.match(/<w:pStyle\s+w:val="([^"]+)"/);
    const style = styleM?.[1] ?? '(正文)';
    const text = pContent.replace(/<[^>]+>/g, '').replace(/\s+/g,' ').trim().slice(0, 60);
    if (!text) continue;
    count++;
    console.log(`  [${style}] "${text}"`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
