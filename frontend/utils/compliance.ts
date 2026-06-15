import { DocPreset, StyleConfig } from '../types';

/**
 * 格式合规校验:把"输出是否符合某个命名标准"变成一份可验收的逐项清单。
 * 校验对标的是预设默认值;用户在 StyleEditor 改动后,偏离项会翻⚠ —— 这正是
 * "你偏离了标准"的预期信号。纯函数,无副作用,便于单测。
 */

export interface ComplianceCheck {
  id: string;
  label: string;                       // 人类可读检查项,如 "正文字体 仿宋"
  expected: string;                    // 期望值展示,如 "仿宋"
  read: (s: StyleConfig) => string;    // 从 StyleConfig 读出的实际值(已简化为可展示字符串)
  pass: (s: StyleConfig) => boolean;
}

export interface CheckResult {
  id: string;
  label: string;
  expected: string;
  actual: string;
  pass: boolean;
}

export interface ComplianceSpec {
  standardId: string;
  standardName: string;                // 展示用,如 "GB/T 9704-2012 党政机关公文格式"
  checks: ComplianceCheck[];
}

// 取字体族里第一个字体名(去引号),用于简洁展示 '"FangSong", serif' → 'FangSong'
const firstFont = (s: string): string => {
  if (!s) return '—';
  const m = s.match(/["']([^"']+)["']/);
  return (m ? m[1] : s.split(',')[0]).replace(/['"]/g, '').trim();
};

const has = (s: string, re: RegExp) => re.test(s || '');

// ───────── GB/T 9704-2012 党政机关公文 ─────────
const GB9704: ComplianceSpec = {
  standardId: 'GB9704',
  standardName: 'GB/T 9704-2012 党政机关公文格式',
  checks: [
    { id: 'font',     label: '正文字体 仿宋', expected: '仿宋',   read: s => firstFont(s.fontFamily),  pass: s => has(s.fontFamily, /FangSong|仿宋/i) },
    { id: 'hfont',    label: '标题字体 黑体', expected: '黑体',   read: s => firstFont(s.headingFont), pass: s => has(s.headingFont, /SimHei|黑体|Heiti/i) },
    { id: 'size',     label: '正文字号 三号', expected: '16pt',   read: s => s.baseSize,               pass: s => s.baseSize === '16pt' },
    { id: 'line',     label: '行距 固定28磅', expected: '28pt',   read: s => s.lineHeight,             pass: s => s.lineHeight === '28pt' },
    { id: 'indent',   label: '首行缩进 2字符', expected: '2em',   read: s => s.textIndent,             pass: s => s.textIndent === '2em' || has(s.textIndent, /2\s*(字符|em)/i) },
    { id: 'num',      label: '层级编号 一、(一) 1.', expected: '党政式', read: s => s.headingNumbering,  pass: s => s.headingNumbering === 'chinese-hierarchical' },
    { id: 'mTop',     label: '上边距 3.7cm', expected: '3.7cm',  read: s => s.pageMargins?.top ?? '默认',    pass: s => s.pageMargins?.top === '3.7cm' },
    { id: 'mBottom',  label: '下边距 3.5cm', expected: '3.5cm',  read: s => s.pageMargins?.bottom ?? '默认', pass: s => s.pageMargins?.bottom === '3.5cm' },
    { id: 'mLeft',    label: '左边距 2.8cm', expected: '2.8cm',  read: s => s.pageMargins?.left ?? '默认',   pass: s => s.pageMargins?.left === '2.8cm' },
    { id: 'mRight',   label: '右边距 2.6cm', expected: '2.6cm',  read: s => s.pageMargins?.right ?? '默认',  pass: s => s.pageMargins?.right === '2.6cm' },
    { id: 'page',     label: '纸张 A4',      expected: 'A4',     read: s => s.pageSize ?? 'A4',          pass: s => (s.pageSize ?? 'A4') === 'A4' },
    { id: 'cols',     label: '单栏排版',     expected: '1 栏',   read: s => `${s.columns ?? 1} 栏`,       pass: s => (s.columns ?? 1) === 1 },
  ],
};

// ───────── 毕业论文(通用学术格式)─────────
const THESIS: ComplianceSpec = {
  standardId: 'THESIS',
  standardName: '毕业论文通用格式',
  checks: [
    { id: 'font',   label: '正文字体 宋体', expected: '宋体',   read: s => firstFont(s.fontFamily), pass: s => has(s.fontFamily, /SimSun|宋体|Song/i) },
    { id: 'size',   label: '正文字号 小四', expected: '12pt',   read: s => s.baseSize,              pass: s => s.baseSize === '12pt' },
    { id: 'line',   label: '行距 1.5 倍',   expected: '1.5',    read: s => s.lineHeight,            pass: s => s.lineHeight === '1.5' },
    { id: 'num',    label: '标题编号 1.1.1', expected: '多级数字', read: s => s.headingNumbering,    pass: s => s.headingNumbering === 'decimal-nested' || s.headingNumbering === 'decimal' },
    { id: 'toc',    label: '自动生成目录', expected: '生成',     read: s => (s.generateToc ? '生成' : '否'), pass: s => s.generateToc === true },
    { id: 'page',   label: '纸张 A4',      expected: 'A4',      read: s => s.pageSize ?? 'A4',       pass: s => (s.pageSize ?? 'A4') === 'A4' },
    { id: 'fig',    label: '图表编号规范', expected: '已设',     read: s => s.figureNumbering || '—', pass: s => !!s.figureNumbering },
  ],
};

const PRESET_SPEC: Partial<Record<DocPreset, ComplianceSpec>> = {
  [DocPreset.CORPORATE]: GB9704,
  [DocPreset.ACADEMIC]: THESIS,
  [DocPreset.ACADEMIC_JOURNAL]: THESIS,
  // CREATIVE / MINIMALIST 无对标的强制标准 → 不展示合规 tab
};

export function evaluateCompliance(
  preset: DocPreset,
  s: StyleConfig,
): { spec: ComplianceSpec | null; results: CheckResult[] } {
  const spec = PRESET_SPEC[preset] ?? null;
  if (!spec) return { spec: null, results: [] };
  const results: CheckResult[] = spec.checks.map(c => ({
    id: c.id,
    label: c.label,
    expected: c.expected,
    actual: c.read(s),
    pass: c.pass(s),
  }));
  return { spec, results };
}
