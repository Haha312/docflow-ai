
export enum DocPreset {
  CORPORATE = 'CORPORATE',
  ACADEMIC = 'ACADEMIC',
  ACADEMIC_JOURNAL = 'ACADEMIC_JOURNAL',
  CREATIVE = 'CREATIVE',
  MINIMALIST = 'MINIMALIST'
}

export type NumberingStyle = 'none' | 'decimal' | 'decimal-nested' | 'chinese-hierarchical' | 'chapter';
export type FigureNumberingStyle = 'sequential' | 'chapter-relative'; // 图1 vs 图1-1
export type Alignment = 'left' | 'center' | 'right' | 'justify';

// 页边距(cm 字符串,如 "3.7cm"),docx 库的 UniversalMeasure 直接接受
// header/footer = 页眉/页脚距页边(可选,旧预设缺省时引擎兜底)
export interface PageMargins { top: string; bottom: string; left: string; right: string; header?: string; footer?: string }
export type PageSizeName = 'A4' | 'A3' | 'Letter';

// ===== 内容完整性报告(镜像 backend/src/utils/integrity.ts,需手动保持一致)=====
export type IntegritySeverity = 'info' | 'warning' | 'critical';
export interface IntegrityIssue { type: string; severity: IntegritySeverity; detail: string }
export interface StructuralCounts {
  paragraphs: number;
  headings: number;
  headingsByLevel: Record<number, number>;
  listItems: number;
  charCount: number;
  images: number;
}
export interface IntegrityReport {
  input: StructuralCounts;
  output: StructuralCounts;
  charRetentionPct: number;
  headingsMatched: boolean;
  issues: IntegrityIssue[];
  truncated: boolean;
}

export interface StyleConfig {
  fontFamily: string;     // 正文字体
  headingFont: string;    // 标题字体 (默认/通用)
  baseSize: string;       // 正文字号 (e.g., "12pt")
  
  // Heading Size & Style
  h1Size: string;         
  h1Bold: boolean;
  h1Italic: boolean;
  h1Font?: string; // Specific font for H1

  h2Size: string;
  h2Bold: boolean;
  h2Italic: boolean;
  h2Font?: string; // Specific font for H2
  
  h3Size: string;
  h3Bold: boolean;
  h3Italic: boolean;
  h3Font?: string; // Specific font for H3
  
  h4Size: string;
  h4Bold: boolean;
  h4Italic: boolean;
  h4Font?: string; // Specific font for H4

  // New H5 & H6
  h5Size: string;
  h5Bold: boolean;
  h5Italic: boolean;
  h5Font?: string; 
  h5Indent: string;

  h6Size: string;
  h6Bold: boolean;
  h6Italic: boolean;
  h6Font?: string;
  h6Indent: string;

  lineHeight: string;     // 行距
  
  // Alignment
  h1Align: Alignment;
  h2Align: Alignment;
  bodyAlign: Alignment;

  // Spacing
  spacingBefore: string;  // 段前间距 (e.g., "0.5行")
  spacingAfter: string;   // 段后间距
  
  // Indentation
  textIndent: string;     // 正文首行缩进 (e.g., "2em")
  h1Indent: string;       // 一级标题缩进
  h2Indent: string;       // 二级标题缩进
  h3Indent: string;       // 三级标题缩进
  h4Indent: string;       // 四级标题缩进
  
  primaryColor: string;   // 标题颜色
  headingNumbering: NumberingStyle; // 标题编号风格

  // Journal Specifics
  englishTitleSize?: string;  // 英文标题字号
  englishTitleFont?: string;  // 英文标题字体 (Times New Roman)
  
  authorFont?: string;
  authorSize?: string;
  
  affiliationFont?: string;
  affiliationSize?: string;
  
  abstractFont?: string;      // 中文摘要字体
  abstractSize?: string;      // 中文摘要字号
  
  englishAbstractFont?: string; // 英文摘要字体
  englishAbstractSize?: string; // 英文摘要字号

  keywordsFont?: string;  // 关键词字体
  keywordsSize?: string;  // 关键词字号

  // Figure/Chart Configuration
  figureNumbering: FigureNumberingStyle;
  figureFont: string;
  figureSize: string;
  figureAlign: Alignment;

  // Table Configuration
  tableNumbering: FigureNumberingStyle; // 表格编号风格 (表1 vs 表1-1)
  tableFont: string;      // 表格内字体 (Header will match this)
  tableSize: string;      // 表格内字号 (Header will match this)
  tableCaptionAlign: Alignment; // 表题对齐 (表格上方的标题)
  tableCaptionFont: string; // 表题字体
  tableCaptionSize: string; // 表题字号

  // Layout
  columns?: number; // 分栏数量
  columnGap?: string; // 栏间距 (e.g. "0.78cm");缺省时引擎用默认

  // Page setup(可选:旧预设缺省时 docxGenerator 用默认值兜底)
  pageMargins?: PageMargins; // 页边距 (GB/T 9704: 上3.7 下3.5 左2.8 右2.6cm)
  pageSize?: PageSizeName;   // 纸张,默认 A4

  // TOC Generation
  generateToc?: boolean; // 导出 DOCX 时是否自动生成目录页

  // ===== 期刊精细排版(PST 等;全部可选,缺省时引擎回退到通用逻辑)=====
  // 中英分字体:中文用 fontFamily/headingFont,英文与数字用下列字体(按字符类型拆 run)
  bodyFontEn?: string;      // 正文英文/数字字体 (Times New Roman)
  headingFontEn?: string;   // 标题英文/数字字体 (Arial)

  // 每级标题段前/段后(pt 字符串,如 "6pt"/"12pt"),覆盖按字号算的默认行比例
  h1SpacingBefore?: string; h1SpacingAfter?: string;
  h2SpacingBefore?: string; h2SpacingAfter?: string;
  h3SpacingBefore?: string; h3SpacingAfter?: string;
  h4SpacingBefore?: string; h4SpacingAfter?: string;

  // 篇首(标题/作者/摘要)行距,与正文 lineHeight 分区(PST 篇首 1.25 倍)
  frontMatterLineHeight?: string;

  // 专用元素加黑/行距/段首缩进
  englishTitleBold?: boolean;
  tableCaptionBold?: boolean;
  figureCaptionBold?: boolean;
  abstractLineHeight?: string;       // 中文摘要固定行距 (e.g. "14pt")
  abstractIndentChars?: number;      // 中文摘要段首缩进字符数 (PST: 6pt≈不足1字,按需)
  englishAbstractLineHeight?: string;
  keywordsLineHeight?: string;

  // DOI / 英文关键词 独立样式
  doiFont?: string; doiSize?: string; doiBold?: boolean;
  englishKeywordsFont?: string; englishKeywordsSize?: string;

  // 图:图内文字 与 图宽(半栏/通栏)
  inFigureFont?: string; inFigureSize?: string;
  figureWidthHalf?: string;  // 半栏图宽 (e.g. "6.5cm")
  figureWidthFull?: string;  // 通栏图宽 (e.g. "14cm")

  // 参考文献专用排版(六号宋体 + 0.63cm 悬挂缩进 + 12pt 行距)
  referencesFont?: string; referencesSize?: string;
  referencesLineHeight?: string; referencesHangingIndent?: string;

  // 三线表:内线/外框线宽(pt 数值,如 0.5 / 0.75)
  tableInnerBorderPt?: number; tableOuterBorderPt?: number;

  // 行×字网格(w:docGrid):每页行数 / 每行字数(对齐网格的单倍行距基础)
  linesPerPage?: number; charsPerLine?: number;
}

export interface PresetConfig {
  id: DocPreset;
  title: string;
  description: string;
  icon: string;
  systemInstruction: string; // Base instruction
  color: string;
  styleConfig: StyleConfig;
}

export interface ProcessedDocument {
  originalText: string;
  formattedContent: string;
  title: string;
  preset: DocPreset;
  timestamp: number;
}

export interface AIState {
  isThinking: boolean;
  error: string | null;
  stopMessage: string | null;
  progressStep: string;
  progress: number;
  /** 预估总时长(秒),null 表示未知 */
  estimatedSec: number | null;
  /** 生成开始时间戳(ms) */
  startedAt: number | null;
}