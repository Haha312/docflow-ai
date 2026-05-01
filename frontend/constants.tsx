
import { DocPreset, PresetConfig } from './types';

export const FONT_FAMILY_OPTIONS = [
  { label: '宋体 (SimSun)', value: '"SimSun", "Songti SC", serif' },
  { label: '仿宋 (FangSong)', value: '"FangSong", "FangSong_GB2312", serif' },
  { label: '黑体 (SimHei)', value: '"SimHei", "Heiti SC", sans-serif' },
  { label: '楷体 (KaiTi)', value: '"KaiTi", "KaiTi_GB2312", serif' },
  { label: '微软雅黑 (Microsoft YaHei)', value: '"Microsoft YaHei", sans-serif' },
  { label: 'Times New Roman', value: '"Times New Roman", serif' },
  { label: 'Arial', value: '"Arial", sans-serif' },
  { label: 'Georgia', value: '"Georgia", serif' }
];

export const FONT_SIZE_OPTIONS = [
  { label: '一号 (26pt)', value: '26pt' },
  { label: '小一 (24pt)', value: '24pt' },
  { label: '二号 (22pt)', value: '22pt' },
  { label: '小二 (18pt)', value: '18pt' },
  { label: '三号 (16pt)', value: '16pt' },
  { label: '小三 (15pt)', value: '15pt' },
  { label: '四号 (14pt)', value: '14pt' },
  { label: '小四 (12pt)', value: '12pt' },
  { label: '五号 (10.5pt)', value: '10.5pt' },
  { label: '小五 (9pt)', value: '9pt' },
  { label: '六号 (7.5pt)', value: '7.5pt' },
];

export const SPACING_OPTIONS = [
  { label: '0行', value: '0行' },
  { label: '0.5行', value: '0.5行' },
  { label: '1行', value: '1行' },
  { label: '1.5行', value: '1.5行' },
  { label: '2行', value: '2行' },
  { label: '6磅', value: '6pt' },
  { label: '8磅', value: '8pt' },
  { label: '12磅', value: '12pt' },
];

export const TEXT_INDENT_OPTIONS = [
  { label: '无', value: '0' },
  { label: '2字符 (2em)', value: '2em' },
  { label: '4字符 (4em)', value: '4em' },
  { label: '28磅 (约1厘米)', value: '28pt' },
];

export const ALIGNMENT_OPTIONS = [
  { label: '两端对齐', value: 'justify' },
  { label: '左对齐', value: 'left' },
  { label: '居中对齐', value: 'center' },
  { label: '右对齐', value: 'right' },
];

export const FIGURE_NUMBERING_OPTIONS = [
  { label: '顺序编号 (图1, 图2)', value: 'sequential' },
  { label: '章节编号 (图1-1, 图2-1)', value: 'chapter-relative' },
];

export const TABLE_NUMBERING_OPTIONS = [
  { label: '顺序编号 (表1, 表2)', value: 'sequential' },
  { label: '章节编号 (表1-1, 表2-1)', value: 'chapter-relative' },
];

export const PRESETS: PresetConfig[] = [
  {
    id: DocPreset.ACADEMIC,
    title: "报告/论文",
    description: "标准学术规范。层级编号 (1. 1.1 1.1.1)，宋体与Times New Roman混排，图表规范，适合毕业论文、研究报告、项目标书。",
    color: "emerald",
    systemInstruction: "Format as an Academic Paper or Report.",
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path></svg>`,
    styleConfig: {
      fontFamily: '"SimSun", "Times New Roman", serif',
      headingFont: '"Microsoft YaHei", "Arial", sans-serif',
      baseSize: '12pt', // 小四
      h1Size: '15pt', // 小三
      h1Bold: true,
      h1Italic: false,
      h2Size: '14pt', // 四号
      h2Bold: true,
      h2Italic: false,
      h3Size: '12pt', // 小四
      h3Bold: true,
      h3Italic: false,
      h4Size: '12pt', // 小四
      h4Bold: true,
      h4Italic: false,
      h5Size: '12pt', // 小四
      h5Bold: true,
      h5Italic: false,
      h5Indent: '0',
      h6Size: '12pt', // 小四
      h6Bold: true,
      h6Italic: true,
      h6Indent: '0',

      lineHeight: '1.5',

      h1Align: 'justify',
      h2Align: 'left',
      bodyAlign: 'justify',

      spacingBefore: '0行',
      spacingAfter: '0行',
      textIndent: '2em',
      h1Indent: '0',
      h2Indent: '0',
      h3Indent: '0',
      h4Indent: '0',
      primaryColor: '#000000',
      headingNumbering: 'decimal-nested',

      figureNumbering: 'chapter-relative',
      figureFont: '"SimHei", sans-serif', // 黑体
      figureSize: '10.5pt', // 五号
      figureAlign: 'center',

      tableNumbering: 'chapter-relative',
      tableFont: '"SimSun", serif',
      tableSize: '10.5pt', // 五号
      tableCaptionAlign: 'center',
      tableCaptionFont: '"SimHei", sans-serif', // 黑体
      tableCaptionSize: '10.5pt', // 五号
      columns: 1,
      generateToc: true
    }
  },
  {
    id: DocPreset.ACADEMIC_JOURNAL,
    title: "学术期刊",
    description: "《计算机学报》风格。题目2号黑体，作者3号仿宋，摘要小5号宋体。正文5号宋体双栏排版。",
    color: "blue",
    systemInstruction: "Format as a rigorous Chinese Academic Journal (《计算机学报》style). Follow this exact output structure:\n1. Chinese title as <h1>\n2. English title as <h2>\n3. Authors as <p>\n4. Affiliations as <p>\n5. Chinese abstract as <p> (starting with 摘要)\n6. Chinese keywords as <p> (starting with 关键词)\n7. English abstract as <p> (starting with Abstract)\n8. English keywords as <p> (starting with KEY WORDS)\n9. THEN INSERT EXACTLY THIS TAG: <hr class=\"journal-split\">\n10. Body sections: each section heading as <h2>, content as <p>. Include 引言, methodology, experiments/results, discussion, conclusion, references.\nThe <hr class=\"journal-split\"> tag is MANDATORY and must appear between the keywords and the first body section. Do not omit it.",
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path><line x1="12" y1="6" x2="12" y2="16"></line><line x1="16" y1="6" x2="16" y2="10"></line><line x1="8" y1="6" x2="8" y2="10"></line></svg>`,
    styleConfig: {
      fontFamily: '"SimSun", "Times New Roman", serif', // 正文：宋体 (五号)
      headingFont: '"SimHei", sans-serif', // 标题：黑体 (默认)
      baseSize: '10.5pt', // 正文：五号

      h1Size: '14pt', // 一级标题：4号黑体
      h1Bold: true,
      h1Italic: false,
      h1Font: '"SimHei", sans-serif', // Explicitly set H1 to Hei

      h2Size: '10.5pt', // 二级标题：5号黑体
      h2Bold: true,
      h2Italic: false,
      h2Font: '"SimHei", sans-serif', // Explicitly set H2 to Hei

      h3Size: '10.5pt', // 三级标题：5号
      h3Bold: false, // 5号宋体 (Normal weight usually)
      h3Italic: false,
      h3Font: '"SimSun", "Songti SC", serif', // Explicitly set H3 to Song

      h4Size: '10.5pt', // 四级标题：5号
      h4Bold: false,
      h4Italic: false,

      h5Size: '10.5pt',
      h5Bold: false,
      h5Italic: true,
      h5Indent: '0',

      h6Size: '10.5pt',
      h6Bold: false,
      h6Italic: true,
      h6Indent: '0',

      lineHeight: '1.3', // 期刊正文行距约1.3倍

      h1Align: 'left',
      h2Align: 'left',
      bodyAlign: 'justify',

      spacingBefore: '0行', // 默认段前0磅
      spacingAfter: '0行',  // 默认段后0磅
      textIndent: '2em',
      h1Indent: '0',
      h2Indent: '0',
      h3Indent: '0',
      h4Indent: '0',
      primaryColor: '#000000',
      headingNumbering: 'decimal-nested', // 1. 1.1

      // Journal Specifics
      englishTitleSize: '14pt', // 英文标题：4号
      englishTitleFont: '"Times New Roman", serif', // Times New Roman 加粗

      authorFont: '"FangSong", "FangSong_GB2312", serif', // 作者：3号仿宋
      authorSize: '16pt', // 3号
      affiliationFont: '"SimSun", serif', // 单位：6号宋体
      affiliationSize: '7.5pt', // 6号

      abstractFont: '"SimSun", serif', // 中文摘要：小5号宋体
      abstractSize: '9pt', // 小5号

      englishAbstractFont: '"Times New Roman", serif', // 英文摘要：Times New Roman
      englishAbstractSize: '10.5pt', // 英文摘要：5号

      keywordsFont: '"SimSun", serif', // 关键词：小5号宋体
      keywordsSize: '9pt',            // 小5号

      figureNumbering: 'sequential',
      figureFont: '"SimSun", serif', // 图注：小5号 (9pt)
      figureSize: '9pt',
      figureAlign: 'center',

      tableNumbering: 'sequential',
      tableFont: '"SimSun", serif',
      tableSize: '9pt', // 表内：小5号
      tableCaptionAlign: 'center',
      generateToc: false, // 期刊不需要目录
      tableCaptionFont: '"SimHei", sans-serif', // 表题：黑体
      tableCaptionSize: '9pt', // 小5号

      columns: 2 // 双栏排版
    }
  },
  {
    id: DocPreset.CREATIVE,
    title: "出版物",
    description: "依据新闻出版行业惯例（32开文学类，参照人民文学出版社规范）。宋体五号正文，黑体章节标题，固定行距18磅，首行缩进2字符，适合小说、散文、人文社科类书籍。",
    color: "violet",
    systemInstruction: "Format as a published book following Chinese literary publishing standards (人民文学出版社 style, 32开). Use '第X章' chapter titles with Chinese numerals. Body text should be concise prose paragraphs.",
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path><path d="M2 2l7.586 7.586"></path><circle cx="11" cy="11" r="2"></circle></svg>`,
    styleConfig: {
      // 正文：宋体五号，行业标准出版物字体
      fontFamily: '"SimSun", "Songti SC", serif',
      // 标题：黑体，传统中文出版物标题字体
      headingFont: '"SimHei", "Heiti SC", sans-serif',

      baseSize: '10.5pt', // 五号：中文图书正文标准字号

      // 章标题（第X章）：黑体小一，居中
      h1Size: '24pt',   // 小一
      h1Bold: true,
      h1Italic: false,

      // 节标题：黑体四号，左对齐
      h2Size: '14pt',   // 四号
      h2Bold: true,
      h2Italic: false,

      // 小节标题：黑体小四
      h3Size: '12pt',   // 小四
      h3Bold: true,
      h3Italic: false,

      // 四级标题：黑体五号（与正文同号加粗）
      h4Size: '10.5pt', // 五号
      h4Bold: true,
      h4Italic: false,

      h5Size: '10.5pt',
      h5Bold: false,
      h5Italic: true,
      h5Indent: '0',

      h6Size: '10.5pt',
      h6Bold: false,
      h6Italic: true,
      h6Indent: '0',

      // 固定行距18磅：行业标准（约1.71倍字号），适合五号正文
      lineHeight: '18pt',

      h1Align: 'center',  // 章标题居中
      h2Align: 'left',
      bodyAlign: 'justify', // 正文两端对齐

      spacingBefore: '0行',
      spacingAfter: '0行',  // 固定行距已保证节奏，无需额外段间距
      textIndent: '2em',    // 首行缩进2字符（出版物标准）
      h1Indent: '0',
      h2Indent: '0',
      h3Indent: '0',
      h4Indent: '0',
      primaryColor: '#000000', // 出版物标题用黑色，不使用彩色

      headingNumbering: 'chapter', // 第一章 / 第二章（汉字章节编号）

      // 图注：宋体小五（9pt），居中，章节编号（图1-1）
      figureNumbering: 'chapter-relative',
      figureFont: '"SimSun", "Songti SC", serif',
      figureSize: '9pt',   // 小五
      figureAlign: 'center',

      // 表格：宋体五号，表题黑体小五，章节编号（表1-1）
      tableNumbering: 'chapter-relative',
      tableFont: '"SimSun", "Songti SC", serif',
      tableSize: '10.5pt', // 五号
      tableCaptionAlign: 'center',
      tableCaptionFont: '"SimHei", "Heiti SC", sans-serif',
      tableCaptionSize: '9pt', // 小五

      columns: 1,
      generateToc: true  // 书籍标准配有目录
    }
  },
  {
    id: DocPreset.CORPORATE,
    title: "商务公文",
    description: "严谨公文规范。遵循党政机关公文格式，仿宋/黑体搭配，特定层级编号 (一、(一) 1.)，首行缩进2字符，适合红头文件、通知公告。",
    color: "indigo",
    systemInstruction: "Format as a formal Corporate Document.",
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`,
    styleConfig: {
      fontFamily: '"FangSong", "FangSong_GB2312", serif',
      headingFont: '"SimHei", "Heiti SC", sans-serif',
      baseSize: '16pt', // 三号
      h1Size: '22pt', // 二号
      h1Bold: true,
      h1Italic: false,
      h2Size: '18pt', // 小二
      h2Bold: true,
      h2Italic: false,
      h3Size: '16pt', // 三号
      h3Bold: true,
      h3Italic: false,
      h4Size: '16pt', // 三号
      h4Bold: true,
      h4Italic: false,
      h5Size: '16pt',
      h5Bold: true,
      h5Italic: false,
      h5Indent: '0',
      h6Size: '16pt',
      h6Bold: true,
      h6Italic: false,
      h6Indent: '0',

      lineHeight: '28pt', // GB/T 9704-2012 固定行距28磅

      h1Align: 'justify',
      h2Align: 'left',
      bodyAlign: 'justify',

      spacingBefore: '0行',
      spacingAfter: '0行',
      textIndent: '2em',
      h1Indent: '0',
      h2Indent: '0',
      h3Indent: '0',
      h4Indent: '0',
      primaryColor: '#000000',
      headingNumbering: 'chinese-hierarchical',

      figureNumbering: 'sequential',
      figureFont: '"KaiTi", "KaiTi_GB2312", serif',
      figureSize: '12pt', // 小四
      figureAlign: 'center',

      tableNumbering: 'sequential',
      tableFont: '"FangSong", "FangSong_GB2312", serif',
      tableSize: '14pt', // 四号
      tableCaptionAlign: 'center',
      tableCaptionFont: '"SimHei", sans-serif',
      tableCaptionSize: '14pt', // 四号
      columns: 1,
      generateToc: false
    }
  },
  {
    id: DocPreset.MINIMALIST,
    title: "互联网文档",
    description: "参照 GitBook / 飞书文档规范。无首行缩进，段后12磅间距，H1-H3清晰层级，H4-H6递减强调，代码块等宽字体，适合产品手册、技术文档、Wiki、网络文章。",
    color: "zinc",
    systemInstruction: "Format as web technical documentation (GitBook / 飞书文档 style). Rules: no first-line indent; separate paragraphs with blank lines; use H1 for title, H2 for major sections, H3 for subsections, H4 only for minor items; use numbered lists for steps and bullet lists for features; wrap inline code with <code> tags and multi-line code with <pre><code> blocks; use plain tables for comparisons; avoid excessive nesting beyond 2 levels.",
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="10" x2="3" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="21" y1="18" x2="3" y2="18"></line></svg>`,
    styleConfig: {
      fontFamily: '"Microsoft YaHei", sans-serif',
      headingFont: '"Microsoft YaHei", sans-serif',
      baseSize: '12pt',
      h1Size: '22pt',
      h1Bold: true,
      h1Italic: false,
      h2Size: '16pt',
      h2Bold: true,
      h2Italic: false,
      h3Size: '14pt',
      h3Bold: true,
      h3Italic: false,
      // H4: 与正文同号但加粗+斜体，区别于纯正文
      h4Size: '12pt',
      h4Bold: true,
      h4Italic: true,
      // H5/H6: 弱化为斜体小字，表示极低层级标题（参照 GitBook 规范）
      h5Size: '10.5pt', // 小五，比正文小一档
      h5Bold: false,
      h5Italic: true,
      h5Indent: '0',
      h6Size: '10.5pt',
      h6Bold: false,
      h6Italic: true,
      h6Indent: '0',
      lineHeight: '1.6',

      h1Align: 'left',
      h2Align: 'left',
      bodyAlign: 'left',

      spacingBefore: '0行',
      spacingAfter: '12pt', // 12磅段后间距：无首行缩进时的主要段落分隔手段（参照 GitHub Docs）
      textIndent: '0',
      h1Indent: '0',
      h2Indent: '0',
      h3Indent: '0',
      h4Indent: '0',
      primaryColor: '#18181b',
      headingNumbering: 'decimal',

      figureNumbering: 'sequential',
      figureFont: '"Microsoft YaHei", sans-serif',
      figureSize: '10.5pt',
      figureAlign: 'left',

      tableNumbering: 'sequential',
      tableFont: '"Microsoft YaHei", sans-serif',
      tableSize: '10.5pt',
      tableCaptionAlign: 'left',
      tableCaptionFont: '"Microsoft YaHei", sans-serif',
      tableCaptionSize: '10.5pt',
      columns: 1,
      generateToc: true
    }
  }
];

export interface ModelOption {
  key: string;
  name: string;
  descKey: string;
}

export const MODEL_OPTIONS: readonly ModelOption[] = [
  { key: 'gemini-flash', name: 'Gemini Flash',    descKey: 'home.model_fast' },
  { key: 'gemini-pro',   name: 'Gemini 3 Pro',    descKey: 'home.model_quality' },
  { key: 'doubao',       name: '豆包 Doubao',      descKey: 'home.model_bytedance' },
  { key: 'deepseek',     name: 'DeepSeek V4 Pro', descKey: 'home.model_deepseek' },
  { key: 'qwen-max',     name: 'Qwen Max',        descKey: 'home.model_qwen' },
] as const;

export const DEFAULT_MODEL_KEY = 'gemini-pro';

const MODEL_KEY_SET = new Set(MODEL_OPTIONS.map((m) => m.key));

export const isSupportedModelKey = (key: string | null | undefined): boolean =>
  !!key && MODEL_KEY_SET.has(key);

export const readPersistedModel = (storage: Storage = localStorage): string => {
  try {
    const stored = storage.getItem('docuflow_selected_model');
    if (isSupportedModelKey(stored)) return stored as string;
  } catch { /* ignore localStorage access errors */ }
  return DEFAULT_MODEL_KEY;
};