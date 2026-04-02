import fs from 'node:fs/promises';
import mammoth from 'mammoth';

const DOCX_PATH = 'C:/Users/86188/Desktop/基于三维信息技术的新能源电站数字化设计关键技术研究报告(1).docx';
const API_BASE = 'http://localhost:3001';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const MODEL = process.env.MODEL || 'deepseek';

const styleConfig = {
  fontFamily: 'SimSun',
  baseSize: '16px',
  lineHeight: '1.5',
  headingFont: 'SimHei',
  headingNumbering: 'decimal',
  bodyAlign: 'justify',
  textIndent: '2em',
  spacingBefore: '0.5em',
  spacingAfter: '0.5em',
  h1Size: '24px',
  h1Bold: true,
  h1Italic: false,
  h1Align: 'center',
  h1Indent: '0',
  h2Size: '20px',
  h2Bold: true,
  h2Italic: false,
  h2Align: 'left',
  h2Indent: '0',
  h3Size: '18px',
  h3Bold: true,
  h3Italic: false,
  h3Indent: '0',
  h4Size: '16px',
  h4Bold: true,
  h4Italic: false,
  h4Indent: '0',
  tableFont: 'SimSun',
  tableSize: '14px',
  tableCaptionFont: 'SimHei',
  tableCaptionSize: '14px',
  tableCaptionAlign: 'center',
  tableNumbering: 'arabic',
  figureFont: 'SimSun',
  figureSize: '14px',
  figureNumbering: 'arabic'
};

const normalize = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function analyzeOutput(html) {
  const headingRegex = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
  const headings = [];
  let m;
  while ((m = headingRegex.exec(html)) !== null) {
    const level = Number(m[1]);
    const attrs = m[2] || '';
    const isDocTitle = /class\s*=\s*["'][^"']*\bdoc-title\b/i.test(attrs);
    if (isDocTitle) continue;
    const text = normalize(m[3]);
    if (text) headings.push({ level, text });
  }

  const repeatedLevelOne = [];
  const byLevel = new Map();
  for (const h of headings) {
    if (!byLevel.has(h.level)) byLevel.set(h.level, []);
    byLevel.get(h.level).push(h.text);
  }
  for (const [level, arr] of byLevel.entries()) {
    let run = 0;
    for (const t of arr) {
      if (/^\s*1([.)、\s]|$)/.test(t)) run += 1;
      else run = 0;
      if (run >= 2) repeatedLevelOne.push({ level, sample: t });
    }
  }

  const paraRegex = /<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const blocks = [];
  while ((m = paraRegex.exec(html)) !== null) {
    const txt = normalize(m[2]);
    if (txt.length >= 25) blocks.push(txt);
  }
  const duplicates = [];
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i] === blocks[i - 1]) duplicates.push(blocks[i].slice(0, 120));
  }

  return {
    headingCount: headings.length,
    repeatedLevelOneCount: repeatedLevelOne.length,
    duplicateAdjacentBlockCount: duplicates.length,
    repeatedLevelOne,
    duplicateSamples: duplicates.slice(0, 5),
    headingSamples: headings.slice(0, 12)
  };
}

async function main() {
  if (!ADMIN_TOKEN) throw new Error('ADMIN_TOKEN is required');
  const token = ADMIN_TOKEN;

  const buffer = await fs.readFile(DOCX_PATH);
  const { value: html } = await mammoth.convertToHtml({ buffer });

  const resp = await fetch(`${API_BASE}/api/generate`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content: html,
      preset: 'academic',
      fileName: 'long-doc-check.docx',
      styleConfig,
      model: MODEL
    })
  });

  if (!resp.ok || !resp.body) throw new Error(`generate failed: ${resp.status}`);

  const decoder = new TextDecoder();
  const reader = resp.body.getReader();
  let sse = '';
  let output = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    sse += decoder.decode(value, { stream: true });
    const parts = sse.split('\n\n');
    sse = parts.pop() || '';
    for (const part of parts) {
      const line = part.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const data = JSON.parse(line.slice(6));
      if (data.delta) output += data.delta;
      if (data.error) throw new Error(`backend error: ${data.error}`);
    }
  }

  const report = analyzeOutput(output);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

