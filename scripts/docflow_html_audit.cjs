const fs = require('fs');
const path = require('path');

const OUT_DIR = process.env.OUT_DIR || path.resolve('test-results/docflow-generation');

function count(re, text) {
  return (text.match(re) || []).length;
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function auditHtml(filePath) {
  const html = fs.readFileSync(filePath, 'utf8');
  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => ({
    level: Number(m[1]),
    text: stripTags(m[2]).slice(0, 120),
  }));
  const headingLevels = {};
  for (const h of headings) headingLevels[h.level] = (headingLevels[h.level] || 0) + 1;
  const text = stripTags(html);
  const figureCaptionText = [...text.matchAll(/图\s*\d+(?:[-.]\d+)?[^\s。；;]{0,80}/g)].map((m) => m[0]);
  const tableCaptionText = [...text.matchAll(/表\s*\d+(?:[-.]\d+)?[^\s。；;]{0,80}/g)].map((m) => m[0]);
  return {
    file: filePath,
    chars: html.length,
    textChars: text.length,
    h1: headingLevels[1] || 0,
    h2: headingLevels[2] || 0,
    h3: headingLevels[3] || 0,
    h4: headingLevels[4] || 0,
    h5: headingLevels[5] || 0,
    h6: headingLevels[6] || 0,
    headings: headings.length,
    tables: count(/<table\b/gi, html),
    images: count(/<img\b/gi, html),
    dataImages: count(/data:image\//gi, html),
    figureCaptionClass: count(/class=["'][^"']*figure-caption/gi, html),
    tableCaptionClass: count(/class=["'][^"']*table-caption/gi, html),
    figureCaptionText: figureCaptionText.length,
    tableCaptionText: tableCaptionText.length,
    headingSamples: headings.slice(0, 30),
    figureCaptionSamples: figureCaptionText.slice(0, 20),
    tableCaptionSamples: tableCaptionText.slice(0, 20),
  };
}

function main() {
  const files = fs.readdirSync(OUT_DIR)
    .filter((name) => /^[A-Z_]+-.+\.html$/.test(name))
    .map((name) => path.join(OUT_DIR, name));
  const audits = files.map(auditHtml);
  fs.writeFileSync(path.join(OUT_DIR, 'html-audit-summary.json'), JSON.stringify(audits, null, 2), 'utf8');
  console.log(JSON.stringify(audits.map((a) => ({
    file: path.basename(a.file),
    textChars: a.textChars,
    headings: a.headings,
    h1: a.h1,
    h2: a.h2,
    h3: a.h3,
    h4: a.h4,
    h5: a.h5,
    tables: a.tables,
    images: a.images,
    figureCaptionClass: a.figureCaptionClass,
    tableCaptionClass: a.tableCaptionClass,
    figureCaptionText: a.figureCaptionText,
    tableCaptionText: a.tableCaptionText,
  })), null, 2));
}

main();
