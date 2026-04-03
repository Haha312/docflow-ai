// node analyze_doc3.cjs
const fs = require('fs');
const JSZip = require('jszip');
const mammoth = require('mammoth');

const FILE = 'C:\\Users\\86188\\Desktop\\卫星光学遥感影像二次多项式拟合算法实施步骤.docx';

async function main() {
  const buf = fs.readFileSync(FILE);
  const zip = await JSZip.loadAsync(buf);

  // 1. 读 styles.xml，找所有标题样式
  const stylesXml = await zip.file('word/styles.xml').async('text');
  console.log('=== 标题样式 ===');
  const styleBlocks = stylesXml.match(/<w:style\b[\s\S]*?<\/w:style>/g) || [];
  for (const block of styleBlocks) {
    const nameM = block.match(/w:name[^/]*w:val="([^"]+)"/);
    const idM   = block.match(/w:styleId="([^"]+)"/);
    const name  = nameM?.[1] ?? '';
    if (/^(heading\s*\d|标题\s*\d)/i.test(name)) {
      console.log(`  styleId="${idM?.[1]}"  name="${name}"`);
    }
  }

  // 2. mammoth HTML 里的标题分布
  const result = await mammoth.convertToHtml({ buffer: buf });
  const html = result.value;
  console.log('\n=== Mammoth 标题分布 ===');
  for (const tag of ['h1','h2','h3','h4','h5','h6']) {
    const count = (html.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length;
    if (count > 0) console.log(`  <${tag}>: ${count}`);
  }

  console.log('\n=== 所有标题内容 ===');
  const headingRe = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let hm;
  while ((hm = headingRe.exec(html)) !== null) {
    console.log(`  <${hm[1]}> "${hm[2].replace(/<[^>]+>/g,'').trim().slice(0,60)}"`);
  }

  // 3. 模拟 docxParser.ts 的 extractDocumentStructure
  //    读 document.xml，找所有用了 heading 样式的段落，记录 level
  const docXml = await zip.file('word/document.xml').async('text');

  // 提取 styleId → level 映射
  const styleLevelMap = {};
  for (const block of styleBlocks) {
    const nameM = block.match(/w:name[^/]*w:val="([^"]+)"/);
    const idM   = block.match(/w:styleId="([^"]+)"/);
    const name  = nameM?.[1] ?? '';
    const idVal = idM?.[1] ?? '';
    const enM = name.match(/^heading\s+(\d+)$/i);
    const cnM = name.match(/^标题\s*(\d+)$/);
    const level = enM ? parseInt(enM[1]) : cnM ? parseInt(cnM[1]) : null;
    if (level && level <= 6 && idVal) styleLevelMap[idVal] = level;
  }
  console.log('\n=== styleId → level 映射 ===', JSON.stringify(styleLevelMap));

  // 找文档中用了 heading 样式的段落
  const paraRe = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g;
  let pm;
  const headings = [];
  while ((pm = paraRe.exec(docXml)) !== null) {
    const pContent = pm[1];
    const styleM = pContent.match(/<w:pStyle\s+w:val="([^"]+)"/);
    if (!styleM) continue;
    const styleId = styleM[1];
    const level = styleLevelMap[styleId];
    if (!level) continue;
    // 提取文字
    const text = pContent.replace(/<[^>]+>/g, '').trim().slice(0, 60);
    if (text) headings.push({ level, styleId, text });
  }
  console.log('\n=== document.xml 里的标题段落 ===');
  headings.forEach(h => console.log(`  H${h.level} (styleId=${h.styleId}): "${h.text}"`));

  const minLevel = headings.length > 0 ? Math.min(...headings.map(h => h.level)) : '—';
  const hasH1 = headings.some(h => h.level === 1);
  console.log(`\n最低标题级别: H${minLevel}，含H1: ${hasH1}`);
}

main().catch(err => { console.error(err); process.exit(1); });
