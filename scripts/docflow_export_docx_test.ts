import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from '../frontend/node_modules/jsdom/lib/api.js';
import { DocPreset } from '../frontend/types';
import type { PresetConfig } from '../frontend/types';

const OUT_DIR = process.env.OUT_DIR || path.resolve('test-results/docflow-generation');

const FILES: Array<{ preset: DocPreset; label: string }> = [
  { preset: DocPreset.ACADEMIC, label: '报告论文' },
  { preset: DocPreset.ACADEMIC_JOURNAL, label: '学术期刊' },
  { preset: DocPreset.CORPORATE, label: '机关公文' },
  { preset: DocPreset.WORK_REPORT, label: '工作汇报方案' },
  { preset: DocPreset.MEETING_MINUTES, label: '会议纪要' },
];

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://127.0.0.1',
    pretendToBeVisual: true,
  });

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    DOMParser: dom.window.DOMParser,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    HTMLImageElement: dom.window.HTMLImageElement,
    localStorage: dom.window.localStorage,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
}

function parseArgs() {
  const onlyArg = process.argv.find((arg) => arg.startsWith('--only='));
  const only = onlyArg
    ? new Set(onlyArg.slice('--only='.length).split(',').map((item) => item.trim()).filter(Boolean))
    : null;
  const suffixArg = process.argv.find((arg) => arg.startsWith('--input-suffix='));
  const inputSuffix = suffixArg ? suffixArg.slice('--input-suffix='.length) : '';
  return { only, inputSuffix };
}

function findInputFile(preset: DocPreset, inputSuffix: string): string {
  const suffix = inputSuffix ? `${inputSuffix}.html` : '.html';
  const files = fs.readdirSync(OUT_DIR);
  const match = files.find((name) =>
    name.startsWith(`${preset}-`)
    && name.endsWith(suffix)
    && (inputSuffix || !name.includes('.reprocessed')),
  );
  if (!match) throw new Error(`Input HTML not found for ${preset} (${suffix})`);
  return path.join(OUT_DIR, match);
}

async function main() {
  setupDom();
  fs.mkdirSync(path.join(OUT_DIR, 'docx'), { recursive: true });

  const [{ PRESETS }, { generateDocx }] = await Promise.all([
    import('../frontend/constants'),
    import('../frontend/utils/docxGenerator'),
  ]);

  const { only, inputSuffix } = parseArgs();
  const selected = FILES.filter((item) => !only || only.has(item.preset) || only.has(item.label));

  const summary: Array<{ preset: DocPreset; label: string; ok: boolean; ms: number; bytes?: number; outFile?: string; error?: string }> = [];
  for (const item of selected) {
    const input = findInputFile(item.preset, inputSuffix);
    const output = path.join(OUT_DIR, 'docx', `${item.preset}-${item.label}.docx`);
    const preset = (PRESETS as PresetConfig[]).find((candidate) => candidate.id === item.preset);
    if (!preset) throw new Error(`Preset not found: ${item.preset}`);
    const started = Date.now();
    try {
      const html = fs.readFileSync(input, 'utf8');
      console.log(`Exporting ${item.preset} from ${path.basename(input)} (${html.length} chars)`);
      const blob = await generateDocx(html, preset.styleConfig);
      const buffer = Buffer.from(await blob.arrayBuffer());
      fs.writeFileSync(output, buffer);
      const ms = Date.now() - started;
      summary.push({ preset: item.preset, label: item.label, ok: true, ms, bytes: buffer.length, outFile: output });
      console.log(`DONE ${item.preset}: ${buffer.length} bytes, ${ms}ms`);
    } catch (error) {
      const ms = Date.now() - started;
      const message = error instanceof Error ? error.stack || error.message : String(error);
      fs.writeFileSync(path.join(OUT_DIR, 'docx', `${item.preset}-${item.label}.error.txt`), message, 'utf8');
      summary.push({ preset: item.preset, label: item.label, ok: false, ms, error: message });
      console.error(`FAILED ${item.preset}: ${message}`);
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'docx', 'export-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  if (summary.some((item) => !item.ok)) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
