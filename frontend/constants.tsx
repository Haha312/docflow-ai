
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
    title: "工作报告",
    description: "标准学术规范。层级编号 (1. 1.1 1.1.1)，宋体与Times New Roman混排，图表规范，适合毕业论文、研究报告、项目标书。",
    color: "emerald",
    systemInstruction: "Format as an Academic Paper or Report.",
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 10v6M2 10l10-5 10 5-10 5z"></path><path d="M6 12v5c3 3 9 3 12 0v-5"></path></svg>`,
    styleConfig: {
      fontFamily: '"SimSun", "Times New Roman", serif',
      headingFont: '"Microsoft YaHei", "Arial", sans-serif',
      baseSize: '12pt', // 小四
      h1Size: '22pt', // 文档标题：二号
      h1Bold: true,
      h1Italic: false,
      h2Size: '15pt', // 一级标题：小三
      h2Bold: true,
      h2Italic: false,
      h3Size: '14pt', // 二级标题：四号
      h3Bold: true,
      h3Italic: false,
      h4Size: '12pt', // 三级标题：小四
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
      pageMargins: { top: '2.54cm', bottom: '2.54cm', left: '3.18cm', right: '3.18cm' },
      pageSize: 'A4',
      columns: 1,
      generateToc: true
    }
  },
  {
    id: DocPreset.ACADEMIC_JOURNAL,
    title: "学术期刊",
    description: "《电力系统技术》/《电网技术》(PST)风格。题目二号黑体，作者四号仿宋，摘要小五号宋体。正文五号宋体双栏排版，页边距上2.5/下1.7/左右2.0cm。",
    color: "blue",
    systemInstruction: "Format as a rigorous Chinese academic journal article. Use the exact semantic HTML classes below:\n1. Chinese title: <h1 class=\"doc-title\">标题</h1>\n2. English title, if present: <h2 class=\"doc-title-en\">English Title</h2>\n3. Authors: <div class=\"author-info\">张三，李四</div>\n4. Affiliations: <div class=\"affiliation\">单位、城市、邮编</div>\n5. Chinese abstract: <div class=\"abstract-cn\"><p>摘要：...</p></div>\n6. English abstract, if present: <div class=\"abstract-en\"><p>Abstract: ...</p></div>\n7. Keywords: <p class=\"keywords\">关键词：...</p> and <p class=\"keywords keywords-en\">KEY WORDS: ...</p> when English keywords exist.\n8. Insert <hr class=\"journal-split\"> between the front matter and the first body section.\n9. Body sections must start at <h2>, then <h3>, <h4>; never use plain <h1> for body sections.\n10. Preserve every sentence, image placeholder, table row, formula, caption, reference, and appendix item. Do not invent missing metadata; if an item is absent, omit that block.",
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path><line x1="12" y1="6" x2="12" y2="16"></line><line x1="16" y1="6" x2="16" y2="10"></line><line x1="8" y1="6" x2="8" y2="10"></line></svg>`,
    styleConfig: {
      fontFamily: '"SimSun", "Times New Roman", serif', // 正文：宋体 (五号)
      headingFont: '"SimHei", sans-serif', // 标题：黑体 (默认)
      baseSize: '10.5pt', // 正文：五号

      h1Size: '22pt', // 文档标题：二号黑体(PST)
      h1Bold: true,
      h1Italic: false,
      h1Font: '"SimHei", sans-serif', // 标题黑体(EN 应 Arial — 待中英分字体)

      h2Size: '12pt', // 二级/章标题：小四号黑体(PST)
      h2Bold: true,
      h2Italic: false,
      h2Font: '"SimHei", sans-serif', // 黑体(EN 应 Arial)

      h3Size: '10.5pt', // 三级标题：五号黑体加粗(PST)
      h3Bold: true, // PST: 三级标题黑体加粗
      h3Italic: false,
      h3Font: '"SimHei", sans-serif', // PST: 三级标题黑体(EN/数字应 Arial)

      h4Size: '10.5pt', // 四级标题：五号宋体(PST)
      h4Bold: false,
      h4Italic: false,
      h4Font: '"SimSun", "Songti SC", serif', // PST: 四级标题宋体(否则回退黑体)

      h5Size: '10.5pt',
      h5Bold: false,
      h5Italic: true,
      h5Indent: '0',

      h6Size: '10.5pt',
      h6Bold: false,
      h6Italic: true,
      h6Indent: '0',

      lineHeight: '1.0', // PST: 正文单倍行距(篇首1.25倍为分区行距,待引擎)

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
      englishTitleSize: '12pt', // 英文标题：小四号 Times New Roman 加黑(PST)
      englishTitleFont: '"Times New Roman", serif', // Times New Roman 加粗

      authorFont: '"FangSong", "FangSong_GB2312", serif', // 作者：四号仿宋(PST)
      authorSize: '14pt', // 四号
      affiliationFont: '"KaiTi", "KaiTi_GB2312", "STKaiti", serif', // 单位/地址：五号楷体(PST)
      affiliationSize: '10.5pt', // 五号

      abstractFont: '"SimSun", serif', // 中文摘要：小5号宋体
      abstractSize: '9pt', // 小5号

      englishAbstractFont: '"Times New Roman", serif', // 英文摘要：Times New Roman
      englishAbstractSize: '9pt', // 英文摘要：小五号(PST)

      keywordsFont: '"SimSun", serif', // 关键词：小5号宋体
      keywordsSize: '9pt',            // 小5号

      figureNumbering: 'sequential',
      figureFont: '"SimHei", sans-serif', // 图题：小五号黑体(PST,加黑待字段)
      figureSize: '9pt', // 小五号
      figureAlign: 'center',

      tableNumbering: 'sequential',
      tableFont: '"SimSun", serif',
      tableSize: '7.5pt', // 表内：六号宋体(PST)
      tableCaptionAlign: 'center',
      generateToc: false, // 期刊不需要目录
      tableCaptionFont: '"SimHei", sans-serif', // 表题：黑体
      tableCaptionSize: '9pt', // 小5号

      pageMargins: { top: '2.5cm', bottom: '1.7cm', left: '2.0cm', right: '2.0cm', header: '1.8cm', footer: '0cm' }, // PST 页边距+页眉1.8/页脚0
      pageSize: 'A4',
      columns: 2, // 双栏排版
      columnGap: '0.78cm', // PST 栏间距

      // ── PST 精细排版 ──
      bodyFontEn: '"Times New Roman", serif',   // 正文英文/数字
      headingFontEn: '"Arial", sans-serif',     // 标题英文/数字
      h1SpacingBefore: '12pt',                  // 标题段前12pt
      h2SpacingBefore: '6pt', h2SpacingAfter: '6pt', // 二级/章 段前后6pt
      h3SpacingBefore: '0pt', h3SpacingAfter: '0pt', // 三级 不空
      h4SpacingBefore: '0pt', h4SpacingAfter: '0pt', // 四级 不空
      frontMatterLineHeight: '1.25',            // 篇首通栏 1.25 倍行距
      englishTitleBold: true,
      tableCaptionBold: true,                   // 表题加黑
      figureCaptionBold: true,                  // 图题加黑
      abstractLineHeight: '14pt',
      englishAbstractLineHeight: '14pt',
      keywordsLineHeight: '14pt',
      doiFont: '"Times New Roman", serif', doiSize: '9pt', doiBold: true, // DOI 小五 TNR 加黑
      englishKeywordsFont: '"Times New Roman", serif', englishKeywordsSize: '9pt',
      inFigureFont: '"SimSun", serif', inFigureSize: '7.5pt', // 图内文字六号宋体
      figureWidthHalf: '6.5cm', figureWidthFull: '14cm',
      referencesFont: '"SimSun", serif', referencesSize: '7.5pt', // 参考文献六号宋体
      referencesLineHeight: '12pt', referencesHangingIndent: '0.63cm',
      tableInnerBorderPt: 0.5, tableOuterBorderPt: 0.75, // 三线表内0.5/外0.75pt
      linesPerPage: 45, charsPerLine: 45 // 行×字网格
    }
  },
  {
    id: DocPreset.CREATIVE,
    title: "出版物",
    description: "依据新闻出版行业惯例（32开文学类，参照人民文学出版社规范）。宋体五号正文，黑体章节标题，固定行距18磅，首行缩进2字符，适合小说、散文、人文社科类书籍。",
    color: "violet",
    systemInstruction: "Format as a published Chinese book. Use <h1 class=\"doc-title\"> only for the book title/cover title. Body chapters must start at <h2>, sections at <h3>, and sub-sections at <h4>. Preserve all text, images, tables, captions, formulas, notes, and appendices without summarizing.",
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path><path d="M2 2l7.586 7.586"></path><circle cx="11" cy="11" r="2"></circle></svg>`,
    styleConfig: {
      // 正文：宋体五号，行业标准出版物字体
      fontFamily: '"SimSun", "Songti SC", serif',
      // 标题：黑体，传统中文出版物标题字体
      headingFont: '"SimHei", "Heiti SC", sans-serif',

      baseSize: '10.5pt', // 五号：中文图书正文标准字号

      // 书名/封面标题：黑体小一，居中
      h1Size: '24pt',   // 小一
      h1Bold: true,
      h1Italic: false,

      // 正文章标题（<h2>，第一章）：黑体小一，居中
      h2Size: '24pt',   // 小一
      h2Bold: true,
      h2Italic: false,

      // 节标题（<h3>，第一节）：黑体四号，左对齐
      h3Size: '14pt',   // 四号
      h3Bold: true,
      h3Italic: false,

      // 小节标题：黑体小四
      h4Size: '12pt',   // 小四
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

      h1Align: 'center',
      h2Align: 'center',  // 章标题居中
      bodyAlign: 'justify', // 正文两端对齐

      spacingBefore: '0行',
      spacingAfter: '0行',  // 固定行距已保证节奏，无需额外段间距
      textIndent: '2em',    // 首行缩进2字符（出版物标准）
      h1Indent: '0',
      h2Indent: '0',
      h3Indent: '0',
      h4Indent: '0',
      h2SpacingBefore: '48pt',
      h2SpacingAfter: '24pt',
      h3SpacingBefore: '12pt',
      h3SpacingAfter: '6pt',
      h4SpacingBefore: '6pt',
      h4SpacingAfter: '3pt',
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

      pageMargins: { top: '2.54cm', bottom: '2.54cm', left: '3.18cm', right: '3.18cm' },
      pageSize: 'A4',
      columns: 1,
      generateToc: true  // 书籍标准配有目录
    }
  },
  {
    id: DocPreset.CORPORATE,
    title: "机关公文",
    description: "遵循 GB/T 9704-2012 党政机关公文格式。含发文机关标志、红色分隔线、发文字号、主送机关、附件、署名日期等要素，正文三号仿宋、固定28磅行距。",
    color: "indigo",
    systemInstruction: "Format as a formal Chinese government document according to GB/T 9704-2012.",
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`,
    styleConfig: {
      fontFamily: '"FangSong", "FangSong_GB2312", serif',
      headingFont: '"SimHei", "Heiti SC", sans-serif',
      baseSize: '16pt', // 三号
      h1Size: '22pt', // 二号
      h1Bold: true,
      h1Italic: false,
      h1Font: '"SimSun", "FZXiaoBiaoSong-B05S", serif',
      h2Size: '16pt', // 三号
      h2Bold: true,
      h2Italic: false,
      h2Font: '"SimHei", "Heiti SC", sans-serif', // 一级标题：黑体
      h3Size: '16pt', // 三号
      h3Bold: false,
      h3Italic: false,
      h3Font: '"KaiTi", "KaiTi_GB2312", serif', // 二级标题：楷体
      h4Size: '16pt', // 三号
      h4Bold: true,
      h4Italic: false,
      h4Font: '"FangSong", "FangSong_GB2312", serif', // 三级标题：仿宋加粗
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
      pageMargins: { top: '3.7cm', bottom: '3.5cm', left: '2.8cm', right: '2.6cm' }, // GB/T 9704-2012
      pageSize: 'A4',
      columns: 1,
      generateToc: false
    }
  },
  {
    id: DocPreset.WORK_REPORT,
    title: "工作方案",
    description: "适合工作汇报、实施方案、调研报告、项目方案。标题二号黑体居中，正文三号仿宋、固定28磅行距，一级黑体、二级楷体、三级仿宋加粗，自动生成目录。",
    color: "sky",
    systemInstruction: "Format as a Chinese work report or implementation plan.",
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16v16H4z"></path><path d="M8 8h8"></path><path d="M8 12h8"></path><path d="M8 16h5"></path></svg>`,
    styleConfig: {
      fontFamily: '"FangSong", "FangSong_GB2312", serif',
      headingFont: '"SimHei", "Heiti SC", sans-serif',
      baseSize: '16pt',
      h1Size: '22pt',
      h1Bold: true,
      h1Italic: false,
      h1Font: '"SimHei", "Heiti SC", sans-serif',
      h2Size: '16pt',
      h2Bold: true,
      h2Italic: false,
      h2Font: '"SimHei", "Heiti SC", sans-serif',
      h3Size: '16pt',
      h3Bold: false,
      h3Italic: false,
      h3Font: '"KaiTi", "KaiTi_GB2312", serif',
      h4Size: '16pt',
      h4Bold: true,
      h4Italic: false,
      h4Font: '"FangSong", "FangSong_GB2312", serif',
      h5Size: '16pt',
      h5Bold: false,
      h5Italic: false,
      h5Indent: '0',
      h6Size: '16pt',
      h6Bold: false,
      h6Italic: false,
      h6Indent: '0',
      lineHeight: '28pt',
      h1Align: 'center',
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
      figureSize: '12pt',
      figureAlign: 'center',
      tableNumbering: 'sequential',
      tableFont: '"FangSong", "FangSong_GB2312", serif',
      tableSize: '14pt',
      tableCaptionAlign: 'center',
      tableCaptionFont: '"SimHei", sans-serif',
      tableCaptionSize: '14pt',
      pageMargins: { top: '3.0cm', bottom: '2.8cm', left: '2.8cm', right: '2.6cm' },
      pageSize: 'A4',
      columns: 1,
      generateToc: true
    }
  },
  {
    id: DocPreset.MEETING_MINUTES,
    title: "会议纪要",
    description: "适合会议纪要、专题会纪要、办公会纪要。自动识别会议时间、地点、主持人、参会人员、议题与议定事项，正文三号仿宋、固定28磅行距，不生成目录。",
    color: "amber",
    systemInstruction: "Format as formal Chinese meeting minutes.",
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"></rect><path d="M8 2v4"></path><path d="M16 2v4"></path><path d="M3 10h18"></path><path d="M8 14h8"></path><path d="M8 18h5"></path></svg>`,
    styleConfig: {
      fontFamily: '"FangSong", "FangSong_GB2312", serif',
      headingFont: '"SimHei", "Heiti SC", sans-serif',
      baseSize: '16pt',
      h1Size: '22pt',
      h1Bold: true,
      h1Italic: false,
      h1Font: '"SimHei", "Heiti SC", sans-serif',
      h2Size: '16pt',
      h2Bold: true,
      h2Italic: false,
      h2Font: '"SimHei", "Heiti SC", sans-serif',
      h3Size: '16pt',
      h3Bold: false,
      h3Italic: false,
      h3Font: '"KaiTi", "KaiTi_GB2312", serif',
      h4Size: '16pt',
      h4Bold: true,
      h4Italic: false,
      h4Font: '"FangSong", "FangSong_GB2312", serif',
      h5Size: '16pt',
      h5Bold: false,
      h5Italic: false,
      h5Indent: '0',
      h6Size: '16pt',
      h6Bold: false,
      h6Italic: false,
      h6Indent: '0',
      lineHeight: '28pt',
      h1Align: 'center',
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
      figureSize: '12pt',
      figureAlign: 'center',
      tableNumbering: 'sequential',
      tableFont: '"FangSong", "FangSong_GB2312", serif',
      tableSize: '14pt',
      tableCaptionAlign: 'center',
      tableCaptionFont: '"SimHei", sans-serif',
      tableCaptionSize: '14pt',
      pageMargins: { top: '3.0cm', bottom: '2.8cm', left: '2.8cm', right: '2.6cm' },
      pageSize: 'A4',
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
      pageMargins: { top: '2.54cm', bottom: '2.54cm', left: '3.18cm', right: '3.18cm' },
      pageSize: 'A4',
      columns: 1,
      generateToc: true
    }
  }
];

export const VISIBLE_PRESETS: PresetConfig[] = PRESETS.filter(
  (preset) => ![DocPreset.CREATIVE, DocPreset.MINIMALIST].includes(preset.id),
);
