/**
 * A4 版面度量:纸张尺寸、页边距换算。
 *
 * 原先定义在 Home.tsx 顶部。抽出来是为了让 previewStyles.ts 能用到它而不必反向
 * import Home(会成环)—— 内容与行为完全未变,Home.tsx 继续 re-export 这几个符号,
 * 既有的 import(如 paginate.test.ts)不受影响。
 */

/** 纸宽 px(96dpi 下 A4 宽) */
export const A4_SHEET_W = 794;
/** 纸高 px(96dpi 下 A4 高) */
export const A4_SHEET_H = 1123;

/**
 * 页边距回退值(styleConfig 未定义 pageMargins 时用)。
 *
 * 必须与 docxGenerator 的兜底 {上下 2.54cm、左右 3.18cm} 换算后一致 —— 否则一份没设
 * 页边距的自定义样式,预览和导出的 Word 会是两张皮(预览每页多塞内容、页数对不上)。
 * 2.54cm ≈ 96px、3.18cm ≈ 120px(96dpi)。改这里必须同步改 docxGenerator,有测试守着。
 */
export const DEFAULT_MARGINS_PX = { top: 96, right: 120, bottom: 96, left: 120 };

/** 默认页边距下的每页可用内容高度(供分页单测与旧调用点参照) */
export const PAGE_USABLE_H = A4_SHEET_H - DEFAULT_MARGINS_PX.top - DEFAULT_MARGINS_PX.bottom;

/** CSS 长度(cm/mm/in/pt/px)→ px(96dpi)。预设页边距用 cm 表示。 */
export const cssLenToPx = (v?: string): number | null => {
  if (!v) return null;
  const m = String(v).trim().match(/^([\d.]+)\s*(cm|mm|in|pt|px)?$/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  switch ((m[2] || 'px').toLowerCase()) {
    case 'cm': return Math.round(n * 96 / 2.54);
    case 'mm': return Math.round(n * 96 / 25.4);
    case 'in': return Math.round(n * 96);
    case 'pt': return Math.round(n * 96 / 72);
    default: return Math.round(n);
  }
};

/**
 * 预设的页边距(px)。此前预览把边距写死(且测量用 40px、渲染用 56px 自相矛盾),
 * 与导出 .docx 实际用的 styleConfig.pageMargins 对不上 —— 预览页比成品页能多塞
 * 约 9% 内容,页数与版面都不准(真实文档实测)。现在两边同源。
 */
export const marginsPxOf = (m?: { top?: string; bottom?: string; left?: string; right?: string }) => ({
  top: cssLenToPx(m?.top) ?? DEFAULT_MARGINS_PX.top,
  right: cssLenToPx(m?.right) ?? DEFAULT_MARGINS_PX.right,
  bottom: cssLenToPx(m?.bottom) ?? DEFAULT_MARGINS_PX.bottom,
  left: cssLenToPx(m?.left) ?? DEFAULT_MARGINS_PX.left,
});
