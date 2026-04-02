// 运行: node analyze_doc2.cjs  （在 D:\docuflow-ai\frontend 目录下）
// 模拟后端图片提取后的实际文本量与分块情况
const fs = require('fs');
const JSZip = require('jszip');
const mammoth = require('mammoth');

const FILE = 'C:\\Users\\86188\\Desktop\\基于三维信息技术的新能源电站数字化设计关键技术研究报告(1).docx';

// 与 backend/src/utils/imageUtils.ts 相同逻辑
function extractImagesAsPlaceholders(html) {
  const imageMap = {};
  let idx = 0;
  const textOnly = html.replace(/<img\s[^>]*>/gi, (match) => {
    const key = `__IMG_${idx}__`;
    imageMap[key] = match;
    idx++;
    return key;
  });
  return { textOnly, imageMap };
}

// 与 backend/src/utils/chunking.ts 相同逻辑（简化版）
function splitContentBySemantics(content, maxChars = 12000) {
  if (content.length <= maxChars) return [content];
  const chunks = [];
  let processed = 0;
  const headingRe = /<h[1-6]\b[^>]*>/gi;
  const headingPositions = [];
  let m;
  while ((m = headingRe.exec(content)) !== null) headingPositions.push(m.index);

  while (processed < content.length) {
    if (content.length - processed <= maxChars) {
      chunks.push(content.slice(processed));
      break;
    }
    const targetEnd = processed + maxChars;
    const searchStart70 = processed + Math.floor(maxChars * 0.7);
    const candidateHeadings = headingPositions.filter(p => p > searchStart70 && p < targetEnd && p > processed);
    if (candidateHeadings.length > 0) {
      const splitIndex = candidateHeadings[candidateHeadings.length - 1];
      chunks.push(content.slice(processed, splitIndex));
      processed = splitIndex;
      continue;
    }
    chunks.push(content.slice(processed, targetEnd));
    processed = targetEnd;
  }
  return chunks;
}

async function main() {
  const buf = fs.readFileSync(FILE);
  const result = await mammoth.convertToHtml({ buffer: buf });
  const html = result.value;

  console.log('=== 原始 HTML ===');
  console.log('总大小:', (html.length / 1024 / 1024).toFixed(2), 'MB');

  // 1. 图片提取后的实际文本量
  const { textOnly, imageMap } = extractImagesAsPlaceholders(html);
  const imgCount = Object.keys(imageMap).length;
  console.log('\n=== 图片提取后 ===');
  console.log('图片数量:', imgCount);
  console.log('文本大小:', (textOnly.length / 1024).toFixed(1), 'KB');
  console.log('图片占比:', (((html.length - textOnly.length) / html.length) * 100).toFixed(1), '%');

  // 2. 模拟 FORMULA_DATA 提取（本文档几乎无公式，跳过）

  // 3. 实际分块
  console.log('\n=== 实际分块预估 ===');
  for (const sz of [6000, 9000, 12000, 16000]) {
    const chunks = splitContentBySemantics(textOnly, sz);
    console.log(`  @${sz} chars → ${chunks.length} 个chunk，最大chunk: ${Math.max(...chunks.map(c=>c.length))} chars`);
  }

  // 4. TOC 内容检测（mammoth 无法识别 toc 样式 → 变成普通 <p>）
  console.log('\n=== TOC 内容检测 ===');
  // TOC 通常由 "章节名...页码" 格式的段落组成，用正则粗略匹配
  const tocLines = (textOnly.match(/<p>[^<]{1,60}\.{3,}[^<]{1,10}<\/p>/g) || []);
  console.log('疑似TOC行（含省略号+页码）:', tocLines.length, '行');
  tocLines.slice(0, 10).forEach(l => console.log(' ', l.replace(/<[^>]+>/g,'').trim()));

  // 5. img 标签大小分布
  const imgSizes = Object.values(imageMap).map(tag => tag.length);
  imgSizes.sort((a, b) => b - a);
  const totalImgBytes = imgSizes.reduce((s, n) => s + n, 0);
  console.log('\n=== 图片大小分布 ===');
  console.log('图片总字节:', (totalImgBytes / 1024 / 1024).toFixed(2), 'MB');
  console.log('最大单图:', (imgSizes[0] / 1024).toFixed(0), 'KB');
  console.log('最小单图:', (imgSizes[imgSizes.length - 1] / 1024).toFixed(1), 'KB');
  console.log('中位数:', (imgSizes[Math.floor(imgSizes.length / 2)] / 1024).toFixed(0), 'KB');

  // 6. 文本内容头部预览（跳过图片，看实际内容结构）
  console.log('\n=== 文本内容前2000字符 ===');
  console.log(textOnly.slice(0, 2000));
}

main().catch(err => { console.error(err); process.exit(1); });
