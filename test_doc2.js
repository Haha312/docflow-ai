const fs = require('fs');
// 直接指向 frontend/node_modules 中的 jszip
const JSZip = require('D:/docuflow-ai/frontend/node_modules/jszip');

async function analyze() {
  const filePath = 'C:/Users/86188/Desktop/基于三维信息技术的新能源电站数字化设计关键技术研究报告(1).docx';

  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch (e) {
    console.error('读取文件失败:', e.message);
    process.exit(1);
  }
  console.log('文件大小:', (buf.length / 1024).toFixed(1), 'KB');

  const zip = await JSZip.loadAsync(buf);

  // 列出所有文件
  const files = Object.keys(zip.files);
  console.log('\nZIP内容:');
  files.forEach(f => console.log(' ', f));

  // 读取 document.xml
  const docEntry = zip.file('word/document.xml');
  if (!docEntry) {
    console.error('未找到 word/document.xml');
    return;
  }

  const xml = await docEntry.async('text');
  console.log('\ndocument.xml 大小:', (xml.length / 1024).toFixed(1), 'KB');

  // 统计段落数
  const paraCount = (xml.match(/<w:p[ >]/g) || []).length;
  console.log('段落数 (w:p):', paraCount);

  // 统计表格
  const tableCount = (xml.match(/<w:tbl[ >]/g) || []).length;
  console.log('表格数 (w:tbl):', tableCount);

  // 统计 pStyle 引用
  const pStyleMatches = xml.match(/w:val="([^"]+)"/g) || [];

  // 检测是否有 OMML 公式
  const formulaCount = (xml.match(/<m:oMath[ >]/g) || []).length;
  console.log('OMML公式数 (m:oMath):', formulaCount);

  // 检测图片
  const inlineCount = (xml.match(/<wp:inline/g) || []).length;
  const anchorCount = (xml.match(/<wp:anchor/g) || []).length;
  console.log('图片数 inline:', inlineCount, '  anchor:', anchorCount, '  合计:', inlineCount + anchorCount);

  // 读取 styles.xml 分析标题样式
  const stylesEntry = zip.file('word/styles.xml');
  if (stylesEntry) {
    const stylesXml = await stylesEntry.async('text');
    console.log('\n--- styles.xml 分析 ---');
    // 提取所有样式ID和名称
    const styleIdRegex = /w:styleId="([^"]+)"/g;
    const styleNameRegex = /<w:name\s+w:val="([^"]+)"/g;
    const styleIds = [];
    let m;
    while ((m = styleIdRegex.exec(stylesXml)) !== null) {
      styleIds.push(m[1]);
    }
    // 找标题相关
    const headingStyleIds = styleIds.filter(s => /heading|[Hh]eading|\d[级章节]|标题/i.test(s));
    console.log('标题相关样式ID:', headingStyleIds.join(', ') || '(未找到)');
    console.log('全部样式ID (前40):', styleIds.slice(0, 40).join(', '));
  }

  // 分析前200个段落的样式
  console.log('\n--- 前200段落样式分布 ---');
  const pStyleCount = {};
  const pStyleRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  const pMatches = xml.match(/<w:p[ >]/g) || [];
  // 用不同方式统计 pStyle
  const allPStyleRefs = xml.match(/<w:pStyle w:val="([^"]+)"/g) || [];
  const styleFreq = {};
  for (const ref of allPStyleRefs) {
    const mv = ref.match(/w:val="([^"]+)"/);
    if (mv) {
      styleFreq[mv[1]] = (styleFreq[mv[1]] || 0) + 1;
    }
  }
  const sorted = Object.entries(styleFreq).sort((a, b) => b[1] - a[1]);
  console.log('段落样式频率 (前20):');
  sorted.slice(0, 20).forEach(([style, cnt]) => console.log(`  ${style}: ${cnt}`));

  // 抽取前30个有文本内容的标题段落
  console.log('\n--- 标题内容抽样 (前30条) ---');
  const headingPRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let count = 0;
  let hm;
  const xmlSlice = xml.slice(0, 300000); // 只看前300KB避免太慢
  while ((hm = headingPRegex.exec(xmlSlice)) !== null && count < 30) {
    const block = hm[0];
    if (!/[Hh]eading|[Tt]itle|标题\d/.test(block)) continue;
    const pStyleM = block.match(/<w:pStyle w:val="([^"]+)"/);
    const style = pStyleM ? pStyleM[1] : '?';
    // 提取文本
    const texts = [];
    const tRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
    let tm;
    while ((tm = tRegex.exec(block)) !== null) {
      if (tm[1].trim()) texts.push(tm[1]);
    }
    const text = texts.join('').trim();
    if (text) {
      console.log(`  [${style}] ${text.slice(0, 80)}`);
      count++;
    }
  }

  // 检查 numbering.xml
  const numEntry = zip.file('word/numbering.xml');
  if (numEntry) {
    const numXml = await numEntry.async('text');
    console.log('\n--- numbering.xml ---');
    console.log('大小:', (numXml.length / 1024).toFixed(1), 'KB');
    const abstractCount = (numXml.match(/<w:abstractNum /g) || []).length;
    const numCount = (numXml.match(/<w:num /g) || []).length;
    console.log('abstractNum 数:', abstractCount, '  num 数:', numCount);
  } else {
    console.log('\n无 numbering.xml');
  }

  // 检查关系文件（图片等）
  const relEntry = zip.file('word/_rels/document.xml.rels');
  if (relEntry) {
    const relXml = await relEntry.async('text');
    const imgRels = (relXml.match(/Type="[^"]*\/image"/g) || []).length;
    console.log('\n图片关系数:', imgRels);
  }
}

analyze().catch(e => {
  console.error('脚本错误:', e);
  process.exit(1);
});
