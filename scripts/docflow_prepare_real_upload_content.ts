import fs from 'node:fs';
import path from 'node:path';
import mammoth from '../frontend/node_modules/mammoth/lib/index.js';
import JSZip from '../frontend/node_modules/jszip/lib/index.js';
import { JSDOM } from '../frontend/node_modules/jsdom/lib/api.js';
import { extractDocumentStructure, extractRawTextWithFormulas } from '../frontend/utils/docxParser';

const SOURCE_DOCX = process.env.SOURCE_DOCX || 'E:/下载内容/DocFlow_总部基建全过程综合数字化管理平台项目-数字化知识管理和共享服务项目—详细设计说明书11.13.docx';
const OUT_DIR = process.env.OUT_DIR || path.resolve('test-results/docflow-generation');

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    DOMParser: dom.window.DOMParser,
  });
}

async function buildDynamicStyleMap(arrayBuffer: ArrayBuffer): Promise<string[]> {
  const styleMap: string[] = [];
  try {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const stylesEntry = zip.file('word/styles.xml');
    if (!stylesEntry) return styleMap;

    const stylesXml = await stylesEntry.async('text');
    const stylesDoc = new DOMParser().parseFromString(stylesXml, 'application/xml');
    const allStyles = stylesDoc.getElementsByTagName('w:style');
    for (const style of Array.from(allStyles)) {
      if (style.getAttribute('w:type') !== 'paragraph') continue;
      const nameEl = style.getElementsByTagName('w:name')[0];
      const name = nameEl?.getAttribute('w:val') ?? '';
      const enMatch = name.match(/^heading\s+(\d+)$/i);
      const cnMatch = name.match(/^标题\s*(\d+)$/);
      const level = enMatch ? enMatch[1] : cnMatch ? cnMatch[1] : null;
      if (level && Number(level) <= 6) {
        styleMap.push(`p[style-name='${name}'] => h${level}:fresh`);
      }
    }
  } catch (error) {
    console.warn('[prepare] dynamic style map skipped:', error);
  }
  return styleMap;
}

async function main() {
  setupDom();
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const buffer = fs.readFileSync(SOURCE_DOCX);
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const dynamicStyleMap = await buildDynamicStyleMap(arrayBuffer);
  const result = await mammoth.convertToHtml(
    { buffer },
    { ...(dynamicStyleMap.length > 0 ? { styleMap: dynamicStyleMap } : {}) },
  );
  let finalContent = result.value;

  let formulaChars = 0;
  const rawContext = await extractRawTextWithFormulas(arrayBuffer);
  if (rawContext?.includes('$$')) {
    finalContent += `\n<!-- FORMULA_DATA -->\n${rawContext}`;
    formulaChars = rawContext.length;
  }

  const structure = await extractDocumentStructure(arrayBuffer);
  let preserveSourceHeadingNumbers = false;
  if (structure.length > 0) {
    preserveSourceHeadingNumbers = structure.filter((heading) => heading.number).length / structure.length >= 0.7;
    finalContent += `\n<!-- STRUCTURE_DATA -->\n${JSON.stringify(structure)}`;
  }

  fs.writeFileSync(path.join(OUT_DIR, 'source-real-upload.html'), finalContent, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'source-structure.json'), JSON.stringify(structure, null, 2), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'source-real-upload-meta.json'), JSON.stringify({
    source: SOURCE_DOCX,
    htmlChars: result.value.length,
    finalChars: finalContent.length,
    dynamicStyleMap,
    structureCount: structure.length,
    numberedHeadings: structure.filter((heading) => heading.number).length,
    preserveSourceHeadingNumbers,
    formulaChars,
    warnings: result.messages,
  }, null, 2), 'utf8');

  console.log(JSON.stringify({
    htmlChars: result.value.length,
    finalChars: finalContent.length,
    structureCount: structure.length,
    numberedHeadings: structure.filter((heading) => heading.number).length,
    preserveSourceHeadingNumbers,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
