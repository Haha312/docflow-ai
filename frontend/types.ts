
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
export interface PageMargins { top: string; bottom: string; left: string; right: string }
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

  // Page setup(可选:旧预设缺省时 docxGenerator 用默认值兜底)
  pageMargins?: PageMargins; // 页边距 (GB/T 9704: 上3.7 下3.5 左2.8 右2.6cm)
  pageSize?: PageSizeName;   // 纸张,默认 A4

  // TOC Generation
  generateToc?: boolean; // 导出 DOCX 时是否自动生成目录页
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