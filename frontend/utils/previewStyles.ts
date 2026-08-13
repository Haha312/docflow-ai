/**
 * 预览样式生成:由 styleConfig 推出 #preview-content 的整套 CSS。
 *
 * 原先内联在 Home.tsx 组件里,只有跑起整个 App 才能得到。抽成纯函数后,
 * 排版预设的效果可以被脚本/测试直接复现 —— 宣传材料里的「几种格式」样张
 * 就是用这个函数渲染的,和用户在产品里看到的是同一份 CSS,不是另写的近似版。
 */
import type { StyleConfig } from '../types';
import { marginsPxOf } from './pageMetrics';

const getPreviewFontStack = (fontVal: string) => {
  if ((fontVal.includes("SimSun") || fontVal.includes("Songti") || fontVal.includes("Heiti") || fontVal.includes("KaiTi")) && !fontVal.toLowerCase().startsWith('"times')) {
    const clean = fontVal.replace(/"Times New Roman",/g, '').replace(/Times New Roman,/g, '');
    return `"Times New Roman", ${clean}`;
  }
  return fontVal;
};

const toCssVal = (val: string) => {
  if (!val) return '0';
  if (val.includes('行')) {
    return `calc(${parseFloat(val)} * 1.5em)`;
  }
  return val;
};


/**
 * Word 的「倍数行距」乘的是字体自身的行高(ascent+descent+行隙),不是字号;
 * 而 CSS 的 line-height:1.5 是死死等于 1.5×字号。两者差一个字体固有比值 ——
 * 期刊预设写 1.0(单倍行距),预览就比导出的 Word 挤了 14%,字几乎贴在一起,
 * 而且每页比 Word 多塞几行、页数对不上。这里按实测比值把倍数换算成 CSS 值。
 * 实测(Chromium,line-height:normal / 字号):
 *   SimSun / FangSong / SimHei / KaiTi = 1.14   微软雅黑 = 1.32
 */
const fontLineRatio = (fontFamily: string): number =>
  /YaHei|Heiti\s*SC/i.test(fontFamily || '') ? 1.32 : 1.14;

/** 倍数行距 → CSS 行高;带单位的(如 28pt 固定行距)原样返回 */
const toCssLineHeight = (lineHeight: string, fontFamily: string): string => {
  const v = (lineHeight || '').trim();
  if (!v || /[a-z%]/i.test(v)) return v || 'normal';
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return v;
  return (n * fontLineRatio(fontFamily)).toFixed(3);
};

/** paginated:真分页预览(纸张内分栏);false 表示编辑/对比态(扁平 DOM) */
export const generatePreviewStyles = (activeStyle: StyleConfig, paginated: boolean): string => {
    const s = activeStyle;
    // 真分页(预览态、非编辑)时,#preview-content 的直接子元素是一张张 .a4-page 纸,
    // 双栏 CSS 必须作用在「纸张内部」——否则加在 #preview-content 上会把「纸张本身」劈成两栏
    // (纸1 在左栏、纸2 在右栏,内容不够时右栏还会空出一块,长得像多出一页空白)。
    // 非分页(编辑/对比态,内容是扁平 DOM、没有 .a4-page 包裹)时才需要加在 #preview-content 本身上。
    const columnRule = s.columns && s.columns > 1 ? `column-count: ${s.columns}; column-gap: ${s.columnGap || '2em'};` : '';
    // 纸张内边距 = 预设页边距(与 .docx 导出同源、与分页测量同源)
    const mg = marginsPxOf(s.pageMargins);
    // 纸张尺寸跟随 pageSize —— 原来写死 794×1123(A4),选 A3/Letter 时预览与导出完全对不上
    const PAGE_PX: Record<string, { w: number; h: number }> = {
        A4: { w: 794, h: 1123 }, A3: { w: 1123, h: 1587 }, Letter: { w: 816, h: 1056 },
    };
    const page = PAGE_PX[s.pageSize ?? 'A4'] ?? PAGE_PX.A4;
    // 标题主色:导出侧一直在用,预览侧此前不读 —— 预览黑字、导出彩字
    const primary = s.primaryColor ? `color: ${s.primaryColor};` : '';
    // 栏间距:原来硬编码 2em,期刊预设的 columnGap 被忽略
    const colGap = s.columnGap || '2em';
    return `
      @keyframes fadeInUp {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes shimmer {
        0%   { transform: translateX(-100%); }
        100% { transform: translateX(200%); }
      }
      #preview-content {
        animation: fadeInUp 0.35s ease;
        font-family: ${getPreviewFontStack(s.fontFamily)};
        font-size: ${s.baseSize};
        line-height: ${toCssLineHeight(s.lineHeight, s.fontFamily)};
        color: #1a1a1a;
        text-align: ${s.bodyAlign};
        ${paginated ? '' : columnRule}
      }
      #preview-content p, #preview-content div:not(.katex-display):not(.math-display):not(.figure-caption):not(.table-caption):not(.doc-title):not(.doc-title-en):not(.author-info):not(.affiliation):not(.abstract-cn):not(.abstract-en):not(.cover-page):not(.doc-issuer):not(.doc-attachment) { margin-top: ${toCssVal(s.spacingBefore)}; margin-bottom: ${toCssVal(s.spacingAfter)}; text-indent: ${s.textIndent}; }
      /* 公文要素：强制无缩进 */
      #preview-content .doc-classification, #preview-content .doc-urgency, #preview-content .doc-ref-number, #preview-content .doc-addressee, #preview-content .doc-signature, #preview-content .doc-date, #preview-content .doc-seal, #preview-content .doc-note, #preview-content .doc-intro { text-indent: 0 !important; }
      /* 表格内部的 div/p 不要缩进 */
      #preview-content td div, #preview-content th div, #preview-content td p, #preview-content th p { text-indent: 0 !important; margin: 0; }
      /* 会议纪要:期次居中;基本信息块(会议主题/时间/地点/主持人/参会人员等)左对齐无缩进、行距收紧,
         跟正文段落区分开,不然预览里看着跟普通段落一样、没有"信息栏"的规范感(与 docx 导出保持一致)。 */
      #preview-content .meeting-issue { text-indent: 0 !important; text-align: center; margin: 0.3em 0 0.6em; color: #444; }
      #preview-content .meeting-meta { margin: 0.6em 0 1em; }
      #preview-content .meeting-meta p { text-indent: 0 !important; margin: 0.15em 0 !important; }

      /* Format Defenses: Protect alignments and lists from global text-indent / margin logic */
      #preview-content [style*="text-align: center"], #preview-content [style*="text-align: right"], #preview-content [align="center"], #preview-content [align="right"], #preview-content center { text-indent: 0 !important; }
      #preview-content [style*="text-align: justify"], #preview-content [align="justify"] { text-align: justify !important; }
      #preview-content ul { list-style-type: disc; list-style-position: inside; padding-left: 2em; margin-top: ${toCssVal(s.spacingBefore)}; margin-bottom: ${toCssVal(s.spacingAfter)}; }
      #preview-content ol { list-style-type: decimal; list-style-position: inside; padding-left: 2em; margin-top: ${toCssVal(s.spacingBefore)}; margin-bottom: ${toCssVal(s.spacingAfter)}; }
      #preview-content li { margin-bottom: 0.5em; text-indent: 0; }
      #preview-content li p, #preview-content li div { margin: 0; text-indent: 0 !important; }
      #preview-content b, #preview-content strong { font-weight: bold; }
      #preview-content i, #preview-content em { font-style: italic; }
      #preview-content h1 { font-family: ${getPreviewFontStack(s.h1Font || s.headingFont)}; font-size: ${s.h1Size}; font-weight: ${s.h1Bold ? 'bold' : 'normal'}; text-align: ${s.h1Align}; margin-top: 1em; margin-bottom: 0.5em; text-indent: ${s.h1Indent}; column-span: all; }
      /* Safety: if AI incorrectly uses <h1> for chapter headings instead of <h2>, render them as h2 style */
      #preview-content h1:not(.doc-title) { font-family: ${getPreviewFontStack(s.h2Font || s.headingFont)}; font-size: ${s.h2Size}; font-weight: ${s.h2Bold ? 'bold' : 'normal'}; text-align: ${s.h2Align}; margin-top: ${toCssVal(s.h2SpacingBefore) !== '0' ? toCssVal(s.h2SpacingBefore) : '0.85em'}; margin-bottom: 0.4em; text-indent: ${s.h2Indent}; column-span: unset; }
      #preview-content h2, #preview-content h3, #preview-content h4 { line-height: 1.35; }
      #preview-content h2 { ${primary} font-family: ${getPreviewFontStack(s.h2Font || s.headingFont)}; font-size: ${s.h2Size}; font-weight: ${s.h2Bold ? 'bold' : 'normal'}; font-style: ${s.h2Italic ? 'italic' : 'normal'}; text-align: ${s.h2Align}; margin-top: 0.85em; margin-bottom: 0.4em; text-indent: ${s.h2Indent}; }
      #preview-content h3 { ${primary} font-family: ${getPreviewFontStack(s.h3Font || s.headingFont)}; font-size: ${s.h3Size}; font-weight: ${s.h3Bold ? 'bold' : 'normal'}; font-style: ${s.h3Italic ? 'italic' : 'normal'}; margin-top: ${toCssVal(s.h3SpacingBefore) !== '0' ? toCssVal(s.h3SpacingBefore) : '0.7em'}; margin-bottom: 0.3em; text-indent: ${s.h3Indent}; }
      #preview-content h4 { ${primary} font-family: ${getPreviewFontStack(s.h4Font || s.headingFont)}; font-size: ${s.h4Size}; font-weight: ${s.h4Bold ? 'bold' : 'normal'}; font-style: ${s.h4Italic ? 'italic' : 'normal'}; margin-top: ${toCssVal(s.h4SpacingBefore) !== '0' ? toCssVal(s.h4SpacingBefore) : '0.5em'}; margin-bottom: 0.25em; text-indent: ${s.h4Indent}; }
      ${s.headingNumbering === 'chinese-hierarchical' ? `
      /* GB/T 9704-2012: 一级条目（一、）段前1行(28pt)，段后0；二三级无额外间距 */
      #preview-content h2 { margin-top: 28pt !important; margin-bottom: 0 !important; }
      #preview-content h3 { margin-top: 0 !important; margin-bottom: 0 !important; }
      #preview-content h4, #preview-content h5, #preview-content h6 { margin-top: 0 !important; margin-bottom: 0 !important; }
      ` : ''}
      /* 文档大标题必须自带行距:正文行距可能是「固定磅值」(出版物 18pt、公文 28pt),
         26~30pt 的标题继承下来会把两行字压在一起(出版物预设标题换行时实测重叠)。
         导出的 .docx 里 .doc-title 本就没套固定行距,这里补上才是真的所见即所得。 */
      #preview-content .doc-title { ${primary} text-indent: 0; font-size: 26pt; line-height: 1.3; font-style: ${s.h1Italic ? 'italic' : 'normal'}; ${s.h1SpacingBefore ? `margin-top: ${toCssVal(s.h1SpacingBefore)};` : ''} text-align: center; margin-bottom: 1em; column-span: all; }
      /* 封面页(报告/论文、出版物):整页居中 */
      #preview-content .cover-page { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; min-height: 900px; padding: 120px 24px; page-break-after: always; column-span: all; }
      #preview-content .cover-page .doc-title { font-size: 30pt; margin-bottom: 1.4em; }
      #preview-content .cover-meta { text-indent: 0 !important; text-align: center; font-size: 15pt; line-height: 2; margin: 0.4em 0; color: #222; }
      /* 真·分页:只读视图下每页是一张独立 A4 白纸(在灰桌面上浮动,纸间留白) */
      #preview-content .a4-page { position: relative; box-sizing: border-box; width: ${page.w}px; min-height: ${page.h}px; margin: 0 auto 24px; padding: ${mg.top}px ${mg.right}px ${mg.bottom}px ${mg.left}px; background: #fff; border: 1px solid #e5e7eb; box-shadow: 0 1px 8px rgba(0,0,0,0.10); ${paginated ? columnRule : ''} }
      #preview-content .a4-page:last-child { margin-bottom: 8px; }
      /* 分页排版惯例 + 高度自洽:页内首块的上外边距、末块的下外边距都归零。
         平铺测量时这两处外边距会与相邻块折叠(只算一次),落到纸内却各自顶到纸边,
         纸张因此被撑高(实测 A4 1123px 被顶到 1183px)。归零后测量与渲染一致。 */
      #preview-content .a4-page > *:first-child { margin-top: 0 !important; }
      #preview-content .a4-page > *:last-child:not(.a4-page-footer) { margin-bottom: 0 !important; }
      #preview-content .a4-page-footer { position: absolute; left: ${mg.left}px; right: ${mg.right}px; bottom: ${Math.max(12, Math.round(mg.bottom / 2.5))}px; text-align: center; font-size: 10px; color: #c7c7c7; user-select: none; }
      /* 封面在所属纸张内填满整页、垂直居中 */
      #preview-content .a4-page > .cover-page { min-height: ${1123 - mg.top - mg.bottom - 24}px; padding: 0; }
      /* 学术期刊专用元素样式 */
      #preview-content .doc-title-en { text-indent: 0; font-size: ${s.englishTitleSize || '14pt'}; font-family: ${getPreviewFontStack(s.englishTitleFont || '"Times New Roman", serif')}; font-weight: ${s.englishTitleBold === false ? 'normal' : 'bold'}; text-align: center; margin-top: 0.3em; margin-bottom: 0.5em; column-span: all; }
      #preview-content .author-info { text-indent: 0; font-size: ${s.authorSize || '10.5pt'}; font-family: ${getPreviewFontStack(s.authorFont || '"FangSong", serif')}; text-align: center; margin: 0.3em 0; column-span: all; }
      #preview-content .affiliation { text-indent: 0; font-size: ${s.affiliationSize || '9pt'}; font-family: ${getPreviewFontStack(s.affiliationFont || '"SimSun", serif')}; text-align: center; color: #444; margin: 0.2em 0 0.6em; column-span: all; }
      #preview-content .abstract-cn { text-indent: 0; line-height: ${s.abstractLineHeight || 'inherit'}; font-size: ${s.abstractSize || '9pt'}; font-family: ${getPreviewFontStack(s.abstractFont || '"SimSun", serif')}; margin: 0.5em 0; padding: 0 1em; column-span: all; }
      #preview-content .abstract-en { text-indent: 0; line-height: ${s.englishAbstractLineHeight || s.abstractLineHeight || 'inherit'}; font-size: ${s.englishAbstractSize || s.abstractSize || '10.5pt'}; font-family: ${getPreviewFontStack(s.englishAbstractFont || '"Times New Roman", serif')}; margin: 0.5em 0; padding: 0 1em; column-span: all; }
      #preview-content .abstract-cn p, #preview-content .abstract-en p { text-indent: ${s.abstractIndentChars != null ? s.abstractIndentChars + 'em' : '2em'}; margin: 0; }
      #preview-content .keywords { text-indent: 0; line-height: ${s.keywordsLineHeight || s.abstractLineHeight || 'inherit'}; font-size: ${s.keywordsSize || s.abstractSize || '9pt'}; font-family: ${getPreviewFontStack(s.keywordsFont || s.abstractFont || '"SimSun", serif')}; margin-bottom: 1em; padding: 0 1em; column-span: all; }
      #preview-content .doc-doi { text-indent: 0; font-size: ${s.abstractSize || '9pt'}; font-family: ${getPreviewFontStack(s.abstractFont || '"SimSun", serif')}; color: #444; margin-bottom: 1em; padding: 0 1em; column-span: all; }
      ${s.columns && s.columns > 1 ? `
      /* 期刊 doc-title 使用标准二号 (22pt)，而非公文的 26pt */
      #preview-content .doc-title { font-size: 22pt !important; font-family: ${getPreviewFontStack(s.h1Font || s.headingFont)}; }
      ` : ''}
      /* 商务公文专用要素样式 */
      #preview-content .doc-issuer { text-align: center; font-family: "SimHei", sans-serif; font-size: 22pt; font-weight: bold; color: #cc0000; letter-spacing: 0.2em; margin: 0.5em 0 0.3em; text-indent: 0; }
      #preview-content .doc-issuer-name { display: block; }
      #preview-content .doc-ref-number { text-align: center; font-size: 14pt; color: #555; margin: 0.2em 0 0.5em; text-indent: 0; }
      #preview-content .doc-classification { text-align: left; font-size: 14pt; font-weight: bold; color: #cc0000; text-indent: 0; }
      #preview-content .doc-urgency { text-align: left; font-size: 14pt; font-weight: bold; color: #cc0000; text-indent: 0; }
      #preview-content .doc-addressee { font-size: ${s.baseSize}; font-weight: bold; text-indent: 0; margin-top: 1em; margin-bottom: 0.5em; }
      #preview-content .doc-intro { text-indent: 2em; }
      #preview-content .doc-attachment { margin-top: 1.5em; border-left: 3px solid #ccc; padding-left: 1em; font-size: ${s.baseSize}; }
      #preview-content .doc-attachment p { text-indent: 0; }
      #preview-content .doc-signature { text-align: right; font-size: ${s.baseSize}; font-weight: bold; margin-top: 2em; text-indent: 0; }
      #preview-content .doc-date { text-align: right; font-size: ${s.baseSize}; margin-top: 0.3em; text-indent: 0; }
      #preview-content .doc-seal { text-align: right; font-size: ${s.baseSize}; color: #cc0000; text-indent: 0; }
      #preview-content .doc-note { font-size: 12pt; color: #666; margin-top: 1em; text-indent: 0; }
      #preview-content hr.doc-divider { border: none; border-bottom: 3px solid #cc0000; margin: 0.4em 0 0.6em; }
      /* 工作方案/工作汇报:副标题/单位·汇报人·日期等篇首信息,跟导出 docx 的居中效果对齐 */
      #preview-content .doc-subtitle { text-indent: 0 !important; text-align: center; font-weight: bold; font-size: 16pt; margin: 0.3em 0; }
      #preview-content .doc-meta { text-indent: 0 !important; text-align: center; font-size: 16pt; margin: 0.15em 0; }
      /* 学术期刊:篇首信息与正文之间的分隔线 */
      /* 参考文献(GB/T 7714):六号宋体、固定 12pt 行距、0.63cm 悬挂缩进 —— 第二行起缩进,
         条目序号顶格。悬挂靠 padding-left + 负 text-indent 实现,与导出侧 hanging 对齐。 */
      #preview-content .references { text-indent: 0; font-family: ${getPreviewFontStack(s.referencesFont || s.fontFamily)}; font-size: ${s.referencesSize || s.baseSize}; ${s.referencesLineHeight ? `line-height: ${toCssLineHeight(s.referencesLineHeight, s.referencesFont || s.fontFamily)};` : ''} margin: 0.2em 0; }
      #preview-content ol.references, #preview-content ul.references { padding-left: ${s.referencesHangingIndent || '0.63cm'}; list-style-position: outside; }
      #preview-content p.references { padding-left: ${s.referencesHangingIndent || '0.63cm'}; text-indent: -${s.referencesHangingIndent || '0.63cm'}; }
      /* DOI 行有独立字体字号(期刊多为小五 Times New Roman 加黑),此前借用关键词的配置 */
      #preview-content .doc-doi { text-indent: 0; font-family: ${getPreviewFontStack(s.doiFont || s.keywordsFont || s.fontFamily)}; font-size: ${s.doiSize || s.keywordsSize || s.baseSize}; font-weight: ${s.doiBold ? 'bold' : 'normal'}; }
      /* 通栏图:双栏排版下跨两栏显示 */
      #preview-content .full-width { column-span: all; text-indent: 0; }
      #preview-content .full-width img { max-width: ${s.figureWidthFull || '100%'}; margin: 8px auto; }
      #preview-content .keywords.keywords-en { font-family: ${getPreviewFontStack(s.englishKeywordsFont || s.englishAbstractFont || '"Times New Roman", serif')}; }
      #preview-content .figure-caption { font-weight: ${s.figureCaptionBold === false ? 'normal' : 'bold'}; }
      #preview-content .table-caption { font-weight: ${s.tableCaptionBold === false ? 'normal' : 'bold'}; }
      ${s.frontMatterLineHeight ? `
      /* 篇首(英文题名/作者/单位)整体行距 */
      #preview-content .doc-title-en, #preview-content .author-info, #preview-content .affiliation { line-height: ${s.frontMatterLineHeight}; }` : ''}
      ${s.bodyFontEn ? `#preview-content { font-family: ${s.bodyFontEn}, ${getPreviewFontStack(s.fontFamily)}; }` : ''}
      ${s.headingFontEn ? `#preview-content h2, #preview-content h3, #preview-content h4 { font-family: ${s.headingFontEn}, ${getPreviewFontStack(s.headingFont)}; }` : ''}
      #preview-content hr.journal-split { border: none; border-top: 1px solid #ccc; margin: 1em 0; }
      #preview-content table { width: 100%; border-collapse: collapse; margin: 1em 0; font-family: ${getPreviewFontStack(s.tableFont)}; font-size: ${s.tableSize}; }
      #preview-content th, #preview-content td { border: 1px solid #444; padding: 8px 12px; text-align: left; text-indent: 0; }
      ${s.tableStyle === 'three-line' ? `
      /* 三线表(期刊规范):只留顶线、表头下线、底线;没有竖线,数据行之间也没有横线。
         之前所有预设共用全网格样式,期刊那份画成了网格表 —— 投稿会被退。 */
      #preview-content table { border-top: ${s.tableOuterBorderPt ?? 0.75}pt solid #000; border-bottom: ${s.tableOuterBorderPt ?? 0.75}pt solid #000; }
      #preview-content th, #preview-content td { border: none; padding: 6px 10px; }
      #preview-content thead th, #preview-content tr:first-child th, #preview-content tr:first-child td { border-bottom: ${s.tableInnerBorderPt ?? 0.5}pt solid #000; }
      #preview-content th { background: transparent; }
      ` : ''}
      #preview-content td p, #preview-content th p { text-indent: 0; margin: 0; }
      #preview-content td li, #preview-content th li { text-indent: 0; }
      #preview-content th { background-color: #f9fafb; font-weight: 600; }
      #preview-content .table-caption, #preview-content caption { text-align: ${s.tableCaptionAlign}; font-family: ${getPreviewFontStack(s.tableCaptionFont)}; font-size: ${s.tableCaptionSize}; font-weight: 600; margin-bottom: 8px; display: block; }
      #preview-content .figure-caption { text-align: ${s.figureAlign || 'center'}; font-family: ${getPreviewFontStack(s.figureFont || s.fontFamily)}; font-size: ${s.figureSize || '9pt'}; font-weight: 600; margin-top: 12px; margin-bottom: 24px; }
      #preview-content img { max-width: 100%; height: auto; display: block; margin: 8px auto; text-indent: 0; }
      /* 公文内超链接不显示为蓝色，继承父元素颜色 */
      #preview-content .doc-issuer a, #preview-content .doc-ref-number a, #preview-content .doc-classification a, #preview-content .doc-urgency a, #preview-content .doc-addressee a, #preview-content .doc-signature a, #preview-content .doc-date a, #preview-content .doc-seal a, #preview-content .doc-note a { color: inherit !important; text-decoration: none !important; }
      
      /* Formula & Pre Overflow handling */
      #preview-content .katex-display, #preview-content .math-display { max-width: 100%; overflow-x: auto; overflow-y: hidden; text-indent: 0; }
      #preview-content pre { max-width: 100%; overflow-x: auto; }
      
      /* Hide scrollbar visually but keep scrollable to maintain the cleanest A4 look */
      #preview-content .katex-display::-webkit-scrollbar, #preview-content .math-display::-webkit-scrollbar, #preview-content pre::-webkit-scrollbar { display: none; }
      
      .katex { font-size: 1.1em; }
      @keyframes tocFadeIn {
        from { opacity: 0; transform: translateX(-6px); }
        to   { opacity: 1; transform: translateX(0); }
      }
    `;
};
