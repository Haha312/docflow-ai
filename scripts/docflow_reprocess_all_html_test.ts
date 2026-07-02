import fs from 'node:fs';
import path from 'node:path';
import { extractSourceCaptions, postProcess } from '../backend/src/utils/postProcess';
import { buildSkeleton } from '../backend/src/utils/skeleton';
import { countStructure, buildIntegrityReport } from '../backend/src/utils/integrity';

const OUT_DIR = process.env.OUT_DIR || path.resolve('test-results/docflow-generation');

const PRESETS: Array<{ id: string; scheme: string; figureChapterRelative: boolean; tableChapterRelative: boolean }> = [
  { id: 'ACADEMIC', scheme: 'decimal-nested', figureChapterRelative: true, tableChapterRelative: true },
  { id: 'ACADEMIC_JOURNAL', scheme: 'decimal-nested', figureChapterRelative: false, tableChapterRelative: false },
  { id: 'CORPORATE', scheme: 'chinese-hierarchical', figureChapterRelative: false, tableChapterRelative: false },
  { id: 'WORK_REPORT', scheme: 'chinese-hierarchical', figureChapterRelative: false, tableChapterRelative: false },
  { id: 'MEETING_MINUTES', scheme: 'chinese-hierarchical', figureChapterRelative: false, tableChapterRelative: false },
];

function findFile(prefix: string, suffix: string): string {
  const files = fs.readdirSync(OUT_DIR);
  const match = files.find((name) => name.startsWith(prefix) && name.endsWith(suffix) && !name.includes('.reprocessed'));
  if (!match) throw new Error(`File not found: ${prefix}*${suffix}`);
  return path.join(OUT_DIR, match);
}

function countClass(html: string, className: string): number {
  const re = new RegExp(`class=["'][^"']*${className}`, 'gi');
  return (html.match(re) ?? []).length;
}

function main() {
  const sourceHtml = fs.readFileSync(path.join(OUT_DIR, 'source-real-upload.html'), 'utf8').replace(/\n<!-- STRUCTURE_DATA -->\n[\s\S]*$/, '');
  const sourceStructure = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'source-structure.json'), 'utf8'));
  const minSourceLevel = Math.min(...sourceStructure.map((heading: { level: number }) => heading.level));
  const normalizedStructure = minSourceLevel > 1
    ? sourceStructure.map((heading: { level: number }) => ({ ...heading, level: Math.max(1, heading.level - minSourceLevel + 1) }))
    : sourceStructure;
  const skeleton = buildSkeleton(normalizedStructure);
  const inputCounts = countStructure(sourceHtml);
  const sourceCaptions = extractSourceCaptions(sourceHtml);

  const summary = PRESETS.map((preset) => {
    const inputFile = findFile(`${preset.id}-`, '.html');
    const html = fs.readFileSync(inputFile, 'utf8');
    const pp = postProcess(html, {
      scheme: preset.scheme,
      figureChapterRelative: preset.figureChapterRelative,
      tableChapterRelative: preset.tableChapterRelative,
      skeleton,
      preserveSourceHeadingNumbers: true,
      sourceCaptions,
    });

    const parsed = path.parse(inputFile);
    const outFile = path.join(parsed.dir, `${parsed.name}.reprocessed.html`);
    fs.writeFileSync(outFile, pp.text, 'utf8');

    const outputCounts = countStructure(pp.text);
    const report = buildIntegrityReport(inputCounts, outputCounts, pp.issues);
    return {
      preset: preset.id,
      input: path.basename(inputFile),
      output: path.basename(outFile),
      headings: outputCounts.headings,
      headingsByLevel: outputCounts.headingsByLevel,
      tables: outputCounts.tables,
      images: outputCounts.images,
      figureCaptions: countClass(pp.text, 'figure-caption'),
      tableCaptions: countClass(pp.text, 'table-caption'),
      charRetentionPct: report.charRetentionPct,
      headingsMatched: report.headingsMatched,
      issues: report.issues,
    };
  });

  fs.writeFileSync(path.join(OUT_DIR, 'reprocess-all-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

main();
