
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
      baseSize: '10.5pt', // 五号
      h1Size: '15pt', // 小三
      h1Bold: true,
      h1Italic: false,
      h2Size: '14pt', // 四号
      h2Bold: true,
      h2Italic: false,
      h3Size: '12pt', // 小四
      h3Bold: true,
      h3Italic: false,
      h4Size: '10.5pt', // 五号
      h4Bold: true,
      h4Italic: false,
      h5Size: '10.5pt', // 五号
      h5Bold: true,
      h5Italic: false,
      h5Indent: '0',
      h6Size: '10.5pt', // 五号
      h6Bold: true,
      h6Italic: true,
      h6Indent: '0',
      
      lineHeight: '1.5',
      
      h1Align: 'justify',
      h2Align: 'left',
      bodyAlign: 'justify',

      spacingBefore: '0.5行',
      spacingAfter: '0.5行',
      textIndent: '2em',
      h1Indent: '0',
      h2Indent: '0',
      h3Indent: '0',
      h4Indent: '0',
      primaryColor: '#000000',
      headingNumbering: 'decimal-nested',

      figureNumbering: 'chapter-relative',
      figureFont: '"SimHei", sans-serif',
      figureSize: '9pt', // 小五
      figureAlign: 'center',

      tableNumbering: 'chapter-relative',
      tableFont: '"SimSun", serif',
      tableSize: '9pt', // 小五
      tableCaptionAlign: 'center',
      tableCaptionFont: '"SimHei", sans-serif',
      tableCaptionSize: '10.5pt', // 五号
      columns: 1
    }
  },
  {
    id: DocPreset.ACADEMIC_JOURNAL,
    title: "学术期刊",
    description: "《计算机学报》风格。题目2号黑体，作者3号仿宋，摘要小5号宋体。正文5号宋体双栏排版。",
    color: "blue",
    systemInstruction: "Format as a rigorous Academic Journal (e.g., Chinese Journal of Computers style).",
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
      
      lineHeight: '1', // 默认1倍行距
      
      h1Align: 'left',
      h2Align: 'left',
      bodyAlign: 'justify',

      spacingBefore: '8pt', // 默认段前8磅
      spacingAfter: '8pt',  // 默认段后8磅
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

      figureNumbering: 'sequential',
      figureFont: '"SimSun", serif', // 图注：小5号 (9pt)
      figureSize: '9pt',
      figureAlign: 'center',

      tableNumbering: 'sequential',
      tableFont: '"SimSun", serif', 
      tableSize: '9pt', // 表内：小5号
      tableCaptionAlign: 'center',
      tableCaptionFont: '"SimHei", sans-serif', // 表题：黑体
      tableCaptionSize: '9pt', // 小5号
      
      columns: 2 // Enable Two-Column layout
    }
  },
  {
    id: DocPreset.CREATIVE,
    title: "出版物/小说",
    description: "沉浸式阅读体验。章节式标题 (第一章)，宽松行距与段落缩进，使用衬线字体，适合小说、散文、电子书。",
    color: "violet",
    systemInstruction: "Format as Creative Writing.",
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path><path d="M2 2l7.586 7.586"></path><circle cx="11" cy="11" r="2"></circle></svg>`,
    styleConfig: {
      fontFamily: '"Georgia", "Source Han Serif SC", "SimSun", serif',
      headingFont: '"Source Han Serif SC", "SimSun", serif',
      baseSize: '12pt', // 小四
      h1Size: '24pt', // 小一
      h1Bold: true,
      h1Italic: false,
      h2Size: '18pt', // 小二
      h2Bold: true,
      h2Italic: true,
      h3Size: '15pt',
      h3Bold: true,
      h3Italic: true,
      h4Size: '14pt',
      h4Bold: true,
      h4Italic: true,
      h5Size: '12pt',
      h5Bold: true,
      h5Italic: true,
      h5Indent: '0',
      h6Size: '12pt',
      h6Bold: true,
      h6Italic: true,
      h6Indent: '0',
      lineHeight: '2',
      
      h1Align: 'center',
      h2Align: 'left',
      bodyAlign: 'justify',

      spacingBefore: '1行',
      spacingAfter: '1行',
      textIndent: '2em',
      h1Indent: '0',
      h2Indent: '0',
      h3Indent: '0',
      h4Indent: '0',
      primaryColor: '#2e1065',
      headingNumbering: 'chapter',

      figureNumbering: 'sequential',
      figureFont: '"KaiTi", serif',
      figureSize: '10.5pt',
      figureAlign: 'center',

      tableNumbering: 'sequential',
      tableFont: '"KaiTi", serif',
      tableSize: '10.5pt',
      tableCaptionAlign: 'center',
      tableCaptionFont: '"KaiTi", serif',
      tableCaptionSize: '10.5pt',
      columns: 1
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
      
      lineHeight: '1.8', 
      
      h1Align: 'justify', 
      h2Align: 'left',
      bodyAlign: 'justify',

      spacingBefore: '0行',
      spacingAfter: '0.5行',
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
      columns: 1
    }
  },
  {
    id: DocPreset.MINIMALIST,
    title: "互联网文档",
    description: "现代屏显风格。无首行缩进，段间距清晰，简洁数字编号，适合产品手册、Wiki、网络文章。",
    color: "zinc",
    systemInstruction: "Format as a Minimalist Memo.",
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="21" y1="10" x2="3" y2="10"></line><line x1="21" y1="6" x2="3" y2="6"></line><line x1="21" y1="14" x2="3" y2="14"></line><line x1="21" y1="18" x2="3" y2="18"></line></svg>`,
    styleConfig: {
      fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
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
      h4Size: '12pt',
      h4Bold: true,
      h4Italic: false,
      h5Size: '12pt',
      h5Bold: true,
      h5Italic: false,
      h5Indent: '0',
      h6Size: '12pt',
      h6Bold: true,
      h6Italic: false,
      h6Indent: '0',
      lineHeight: '1.6',

      h1Align: 'left',
      h2Align: 'left',
      bodyAlign: 'left',

      spacingBefore: '0行',
      spacingAfter: '1行',
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
      columns: 1
    }
  }
];