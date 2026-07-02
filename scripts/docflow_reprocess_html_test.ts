import fs from 'node:fs';
import path from 'node:path';
import { extractSourceCaptions, postProcess } from '../backend/src/utils/postProcess';
import { buildSkeleton } from '../backend/src/utils/skeleton';
import { countStructure, buildIntegrityReport } from '../backend/src/utils/integrity';

const OUT_DIR = process.env.OUT_DIR || path.resolve('test-results/docflow-generation');

const targets = [
  {
    htmlFile: 'WORK_REPORT-工作汇报方案.html',
    outFile: 'WORK_REPORT-工作汇报方案.reprocessed.html',
    scheme: 'chinese-hierarchical',
    figureChapterRelative: false,
    tableChapterRelative: false,
  },
  {
    htmlFile: 'MEETING_MINUTES-会议纪要.html',
    outFile: 'MEETING_MINUTES-会议纪要.reprocessed.html',
    scheme: 'chinese-hierarchical',
    figureChapterRelative: false,
    tableChapterRelative: false,
  },
];

function main() {
  const sourceStructure = JSON.parse(fs.readFileSync(path.join(OUT_DIR, 'source-structure.json'), 'utf8'));
  const minSourceLevel = Math.min(...sourceStructure.map((heading: { level: number }) => heading.level));
  const normalizedStructure = minSourceLevel > 1
    ? sourceStructure.map((heading: { level: number }) => ({ ...heading, level: Math.max(1, heading.level - minSourceLevel + 1) }))
    : sourceStructure;
  const skeleton = buildSkeleton(normalizedStructure);
  const sourceHtml = fs.readFileSync(path.join(OUT_DIR, 'source-real-upload.html'), 'utf8').replace(/\n<!-- STRUCTURE_DATA -->\n[\s\S]*$/, '');
  const inputCounts = countStructure(sourceHtml);
  const sourceCaptions = extractSourceCaptions(sourceHtml);

  const summary = targets.map((target) => {
    const html = fs.readFileSync(path.join(OUT_DIR, target.htmlFile), 'utf8');
    const pp = postProcess(html, {
      scheme: target.scheme,
      figureChapterRelative: target.figureChapterRelative,
      tableChapterRelative: target.tableChapterRelative,
      skeleton,
      preserveSourceHeadingNumbers: true,
      sourceCaptions,
    });
    fs.writeFileSync(path.join(OUT_DIR, target.outFile), pp.text, 'utf8');
    const outputCounts = countStructure(pp.text);
    const report = buildIntegrityReport(inputCounts, outputCounts, pp.issues);
    return {
      target: target.htmlFile,
      output: target.outFile,
      headings: outputCounts.headings,
      headingsByLevel: outputCounts.headingsByLevel,
      tables: outputCounts.tables,
      images: outputCounts.images,
      charRetentionPct: report.charRetentionPct,
      headingsMatched: report.headingsMatched,
      issues: report.issues,
    };
  });

  fs.writeFileSync(path.join(OUT_DIR, 'reprocess-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(JSON.stringify(summary, null, 2));
}

main();
