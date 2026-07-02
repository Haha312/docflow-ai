const fs = require('fs');
const path = require('path');
const mammoth = require('../frontend/node_modules/mammoth');
const JSZip = require('../frontend/node_modules/jszip');

const API_BASE = process.env.API_BASE || 'http://127.0.0.1:3001';
const SOURCE_DOCX = process.env.SOURCE_DOCX || 'E:/下载内容/DocFlow_总部基建全过程综合数字化管理平台项目-数字化知识管理和共享服务项目—详细设计说明书11.13.docx';
const OUT_DIR = process.env.OUT_DIR || path.resolve('test-results/docflow-generation');

const presets = [
  {
    id: 'ACADEMIC',
    label: '报告论文',
    styleConfig: {
      fontFamily: '"SimSun", "Times New Roman", serif',
      headingFont: '"Microsoft YaHei", "Arial", sans-serif',
      baseSize: '12pt',
      h1Size: '22pt', h1Bold: true, h1Italic: false,
      h2Size: '15pt', h2Bold: true, h2Italic: false,
      h3Size: '14pt', h3Bold: true, h3Italic: false,
      h4Size: '12pt', h4Bold: true, h4Italic: false,
      h5Size: '12pt', h5Bold: true, h5Italic: false, h5Indent: '0',
      h6Size: '12pt', h6Bold: true, h6Italic: true, h6Indent: '0',
      lineHeight: '1.5', h1Align: 'justify', h2Align: 'left', bodyAlign: 'justify',
      spacingBefore: '0行', spacingAfter: '0行', textIndent: '2em',
      h1Indent: '0', h2Indent: '0', h3Indent: '0', h4Indent: '0',
      primaryColor: '#000000', headingNumbering: 'decimal-nested',
      figureNumbering: 'chapter-relative', figureFont: '"SimHei", sans-serif', figureSize: '10.5pt', figureAlign: 'center',
      tableNumbering: 'chapter-relative', tableFont: '"SimSun", serif', tableSize: '10.5pt',
      tableCaptionAlign: 'center', tableCaptionFont: '"SimHei", sans-serif', tableCaptionSize: '10.5pt',
      pageMargins: { top: '2.54cm', bottom: '2.54cm', left: '3.18cm', right: '3.18cm' },
      pageSize: 'A4', columns: 1, generateToc: true,
    },
  },
  {
    id: 'ACADEMIC_JOURNAL',
    label: '学术期刊',
    styleConfig: {
      fontFamily: '"SimSun", "Times New Roman", serif',
      headingFont: '"SimHei", sans-serif',
      baseSize: '10.5pt',
      h1Size: '22pt', h1Bold: true, h1Italic: false, h1Font: '"SimHei", sans-serif',
      h2Size: '12pt', h2Bold: true, h2Italic: false, h2Font: '"SimHei", sans-serif',
      h3Size: '10.5pt', h3Bold: true, h3Italic: false, h3Font: '"SimHei", sans-serif',
      h4Size: '10.5pt', h4Bold: false, h4Italic: false, h4Font: '"SimSun", "Songti SC", serif',
      h5Size: '10.5pt', h5Bold: false, h5Italic: true, h5Indent: '0',
      h6Size: '10.5pt', h6Bold: false, h6Italic: true, h6Indent: '0',
      lineHeight: '1.0', h1Align: 'left', h2Align: 'left', bodyAlign: 'justify',
      spacingBefore: '0行', spacingAfter: '0行', textIndent: '2em',
      h1Indent: '0', h2Indent: '0', h3Indent: '0', h4Indent: '0',
      primaryColor: '#000000', headingNumbering: 'decimal-nested',
      englishTitleSize: '12pt', englishTitleFont: '"Times New Roman", serif',
      authorFont: '"FangSong", "FangSong_GB2312", serif', authorSize: '14pt',
      affiliationFont: '"KaiTi", "KaiTi_GB2312", "STKaiti", serif', affiliationSize: '10.5pt',
      abstractFont: '"SimSun", serif', abstractSize: '9pt',
      englishAbstractFont: '"Times New Roman", serif', englishAbstractSize: '9pt',
      keywordsFont: '"SimSun", serif', keywordsSize: '9pt',
      figureNumbering: 'sequential', figureFont: '"SimHei", sans-serif', figureSize: '9pt', figureAlign: 'center',
      tableNumbering: 'sequential', tableFont: '"SimSun", serif', tableSize: '7.5pt',
      tableCaptionAlign: 'center', tableCaptionFont: '"SimHei", sans-serif', tableCaptionSize: '9pt',
      pageMargins: { top: '2.5cm', bottom: '1.7cm', left: '2.0cm', right: '2.0cm', header: '1.8cm', footer: '0cm' },
      pageSize: 'A4', columns: 2, columnGap: '0.78cm', generateToc: false,
    },
  },
  {
    id: 'CORPORATE',
    label: '机关公文',
    styleConfig: {
      fontFamily: '"FangSong", "FangSong_GB2312", serif',
      headingFont: '"SimHei", "Heiti SC", sans-serif',
      baseSize: '16pt',
      h1Size: '22pt', h1Bold: true, h1Italic: false, h1Font: '"SimSun", "FZXiaoBiaoSong-B05S", serif',
      h2Size: '16pt', h2Bold: true, h2Italic: false, h2Font: '"SimHei", "Heiti SC", sans-serif',
      h3Size: '16pt', h3Bold: false, h3Italic: false, h3Font: '"KaiTi", "KaiTi_GB2312", serif',
      h4Size: '16pt', h4Bold: true, h4Italic: false, h4Font: '"FangSong", "FangSong_GB2312", serif',
      h5Size: '16pt', h5Bold: true, h5Italic: false, h5Indent: '0',
      h6Size: '16pt', h6Bold: true, h6Italic: false, h6Indent: '0',
      lineHeight: '28pt', h1Align: 'justify', h2Align: 'left', bodyAlign: 'justify',
      spacingBefore: '0行', spacingAfter: '0行', textIndent: '2em',
      h1Indent: '0', h2Indent: '0', h3Indent: '0', h4Indent: '0',
      primaryColor: '#000000', headingNumbering: 'chinese-hierarchical',
      figureNumbering: 'sequential', figureFont: '"KaiTi", "KaiTi_GB2312", serif', figureSize: '12pt', figureAlign: 'center',
      tableNumbering: 'sequential', tableFont: '"FangSong", "FangSong_GB2312", serif', tableSize: '14pt',
      tableCaptionAlign: 'center', tableCaptionFont: '"SimHei", sans-serif', tableCaptionSize: '14pt',
      pageMargins: { top: '3.7cm', bottom: '3.5cm', left: '2.8cm', right: '2.6cm' },
      pageSize: 'A4', columns: 1, generateToc: false,
    },
  },
  {
    id: 'WORK_REPORT',
    label: '工作汇报方案',
    styleConfig: {
      fontFamily: '"FangSong", "FangSong_GB2312", serif',
      headingFont: '"SimHei", "Heiti SC", sans-serif',
      baseSize: '16pt',
      h1Size: '22pt', h1Bold: true, h1Italic: false, h1Font: '"SimHei", "Heiti SC", sans-serif',
      h2Size: '16pt', h2Bold: true, h2Italic: false, h2Font: '"SimHei", "Heiti SC", sans-serif',
      h3Size: '16pt', h3Bold: false, h3Italic: false, h3Font: '"KaiTi", "KaiTi_GB2312", serif',
      h4Size: '16pt', h4Bold: true, h4Italic: false, h4Font: '"FangSong", "FangSong_GB2312", serif',
      h5Size: '16pt', h5Bold: false, h5Italic: false, h5Indent: '0',
      h6Size: '16pt', h6Bold: false, h6Italic: false, h6Indent: '0',
      lineHeight: '28pt', h1Align: 'center', h2Align: 'left', bodyAlign: 'justify',
      spacingBefore: '0行', spacingAfter: '0行', textIndent: '2em',
      h1Indent: '0', h2Indent: '0', h3Indent: '0', h4Indent: '0',
      primaryColor: '#000000', headingNumbering: 'chinese-hierarchical',
      figureNumbering: 'sequential', figureFont: '"KaiTi", "KaiTi_GB2312", serif', figureSize: '12pt', figureAlign: 'center',
      tableNumbering: 'sequential', tableFont: '"FangSong", "FangSong_GB2312", serif', tableSize: '14pt',
      tableCaptionAlign: 'center', tableCaptionFont: '"SimHei", sans-serif', tableCaptionSize: '14pt',
      pageMargins: { top: '3.0cm', bottom: '2.8cm', left: '2.8cm', right: '2.6cm' },
      pageSize: 'A4', columns: 1, generateToc: true,
    },
  },
  {
    id: 'MEETING_MINUTES',
    label: '会议纪要',
    styleConfig: {
      fontFamily: '"FangSong", "FangSong_GB2312", serif',
      headingFont: '"SimHei", "Heiti SC", sans-serif',
      baseSize: '16pt',
      h1Size: '22pt', h1Bold: true, h1Italic: false, h1Font: '"SimHei", "Heiti SC", sans-serif',
      h2Size: '16pt', h2Bold: true, h2Italic: false, h2Font: '"SimHei", "Heiti SC", sans-serif',
      h3Size: '16pt', h3Bold: false, h3Italic: false, h3Font: '"KaiTi", "KaiTi_GB2312", serif',
      h4Size: '16pt', h4Bold: true, h4Italic: false, h4Font: '"FangSong", "FangSong_GB2312", serif',
      h5Size: '16pt', h5Bold: false, h5Italic: false, h5Indent: '0',
      h6Size: '16pt', h6Bold: false, h6Italic: false, h6Indent: '0',
      lineHeight: '28pt', h1Align: 'center', h2Align: 'left', bodyAlign: 'justify',
      spacingBefore: '0行', spacingAfter: '0行', textIndent: '2em',
      h1Indent: '0', h2Indent: '0', h3Indent: '0', h4Indent: '0',
      primaryColor: '#000000', headingNumbering: 'chinese-hierarchical',
      figureNumbering: 'sequential', figureFont: '"KaiTi", "KaiTi_GB2312", serif', figureSize: '12pt', figureAlign: 'center',
      tableNumbering: 'sequential', tableFont: '"FangSong", "FangSong_GB2312", serif', tableSize: '14pt',
      tableCaptionAlign: 'center', tableCaptionFont: '"SimHei", sans-serif', tableCaptionSize: '14pt',
      pageMargins: { top: '3.0cm', bottom: '2.8cm', left: '2.8cm', right: '2.6cm' },
      pageSize: 'A4', columns: 1, generateToc: false,
    },
  },
];

async function convertDocxToHtml(filePath) {
  const fileBuffer = fs.readFileSync(filePath);
  const arrayBuffer = fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength
  );
  let dynamicStyleMap = [];
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const stylesEntry = zip.file('word/styles.xml');
    if (stylesEntry) {
      const stylesXml = await stylesEntry.async('text');
      const matches = [...stylesXml.matchAll(/<w:style\b[^>]*w:type="paragraph"[\s\S]*?<w:name w:val="([^"]+)"[\s\S]*?<\/w:style>/g)];
      for (const m of matches) {
        const name = m[1];
        const enMatch = name.match(/^heading\s+(\d+)$/i);
        const cnMatch = name.match(/^标题\s*(\d+)$/);
        const level = enMatch ? enMatch[1] : cnMatch ? cnMatch[1] : null;
        if (level && Number(level) <= 6) dynamicStyleMap.push(`p[style-name='${name}'] => h${level}:fresh`);
      }
    }
  } catch (_) {}
  const result = await mammoth.convertToHtml(
    { buffer: fileBuffer },
    { ...(dynamicStyleMap.length > 0 ? { styleMap: dynamicStyleMap } : {}) }
  );
  return result.value;
}

function loadToken() {
  const tokenPath = path.join(OUT_DIR, 'test-token.json');
  const raw = fs.readFileSync(tokenPath);
  const text = raw[0] === 0xff && raw[1] === 0xfe
    ? raw.toString('utf16le')
    : raw.toString('utf8');
  const tokenData = JSON.parse(text.replace(/^\uFEFF/, ''));
  return tokenData.token;
}

function parseArgs() {
  const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean)) : null;
  return { only };
}

async function generateOne(token, content, preset) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.TEST_TIMEOUT_MS || 900000));
  const startedAt = Date.now();
  let fullText = '';
  let report = null;
  let eventCount = 0;
  try {
    const response = await fetch(`${API_BASE}/api/generate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content,
        preset: preset.id,
        fileName: path.basename(SOURCE_DOCX),
        styleConfig: preset.styleConfig,
        model: process.env.TEST_MODEL || 'deepseek',
        preserveSourceHeadingNumbers: true,
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 1000)}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      for (const event of events) {
        for (const line of event.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          eventCount++;
          const data = JSON.parse(line.slice(6));
          if (data.error) throw new Error(`${data.error}${data.errorDetail ? ': ' + data.errorDetail : ''}`);
          if (data.integrityReport) {
            report = data.integrityReport;
          } else if (data.text) {
            fullText = data.text;
          } else if (data.delta) {
            fullText += data.delta;
          }
          if (eventCount % 250 === 0) {
            console.log(`[${preset.label}] events=${eventCount} chars=${fullText.length}`);
          }
        }
      }
    }
    return { ok: true, html: fullText, integrityReport: report, ms: Date.now() - startedAt, eventCount };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const { only } = parseArgs();
  const selected = presets.filter((p) => !only || only.has(p.id) || only.has(p.label));
  const token = loadToken();
  const cachePath = path.join(OUT_DIR, 'source-mammoth.html');
  const realUploadCachePath = path.join(OUT_DIR, 'source-real-upload.html');
  let content;
  if (fs.existsSync(realUploadCachePath)) {
    content = fs.readFileSync(realUploadCachePath, 'utf8');
  } else if (fs.existsSync(cachePath)) {
    content = fs.readFileSync(cachePath, 'utf8');
  } else {
    content = await convertDocxToHtml(SOURCE_DOCX);
    fs.writeFileSync(cachePath, content, 'utf8');
  }
  console.log(`source html chars=${content.length}`);
  const summaryPath = path.join(OUT_DIR, 'batch-summary.json');
  let summary = [];
  if (fs.existsSync(summaryPath)) {
    try {
      const raw = fs.readFileSync(summaryPath);
      const text = raw[0] === 0xff && raw[1] === 0xfe ? raw.toString('utf16le') : raw.toString('utf8');
      summary = JSON.parse(text.replace(/^\uFEFF/, ''));
      if (!Array.isArray(summary)) summary = [];
    } catch (_) {
      summary = [];
    }
  }
  const upsertSummary = (entry) => {
    const idx = summary.findIndex((item) => item.preset === entry.preset);
    if (idx >= 0) summary[idx] = entry;
    else summary.push(entry);
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
  };
  for (const preset of selected) {
    const safeName = `${preset.id}-${preset.label}`;
    console.log(`\n=== Generating ${safeName} ===`);
    const startedAt = new Date().toISOString();
    try {
      const result = await generateOne(token, content, preset);
      fs.writeFileSync(path.join(OUT_DIR, `${safeName}.html`), result.html, 'utf8');
      fs.writeFileSync(path.join(OUT_DIR, `${safeName}.integrity.json`), JSON.stringify(result.integrityReport, null, 2), 'utf8');
      upsertSummary({ preset: preset.id, label: preset.label, ok: true, startedAt, ms: result.ms, chars: result.html.length, eventCount: result.eventCount, integrityReport: result.integrityReport });
      console.log(`DONE ${safeName}: chars=${result.html.length}, ms=${result.ms}`);
    } catch (error) {
      const message = error && error.stack ? error.stack : String(error);
      fs.writeFileSync(path.join(OUT_DIR, `${safeName}.error.txt`), message, 'utf8');
      upsertSummary({ preset: preset.id, label: preset.label, ok: false, startedAt, error: message });
      console.error(`FAILED ${safeName}: ${message}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
