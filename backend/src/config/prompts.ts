import { DocPreset } from '../types';

export const getNumberingInstruction = (style: string): string => {
    // IMPORTANT: <h1> is ALWAYS reserved for the document title (class="doc-title") with NO numbering.
    // All content numbering therefore starts at <h2> (first content level).
    switch (style) {
        case 'chinese-hierarchical':
            return `
        REMEMBER: <h1> = doc-title only (no number). Content numbering starts at <h2>.
        - **<h2> (Chapter / 第一层)**: MUST use "一、", "二、", "三、"... (Chinese numeral + 顿号)
        - **<h3> (Section / 第二层)**: MUST use "（一）", "（二）", "（三）"... (full-width parentheses + Chinese numeral)
        - **<h4> (Sub-section / 第三层)**: MUST use "1.", "2.", "3."... (Arabic numeral + period)
        - **<h5> (Sub-sub-section / 第四层)**: MUST use "(1)", "(2)", "(3)"... (half-width parentheses + Arabic numeral)
        Example output: <h2>一、 总体要求</h2> ... <h3>（一） 基本原则</h3> ... <h4>1. 具体措施</h4>
      `;
        case 'decimal-nested':
            return `
        REMEMBER: <h1> = doc-title only (no number). Content numbering starts at <h2>.
        - **<h2> (Chapter)**: "1.", "2.", "3."...
        - **<h3> (Section)**: "1.1", "1.2", "2.1"...
        - **<h4> (Sub-section)**: "1.1.1", "1.1.2"...
        - **<h5>**: "1.1.1.1", "1.1.1.2"...
        Example output: <h2>1. Introduction</h2> ... <h3>1.1 Background</h3> ... <h4>1.1.1 Details</h4>
      `;
        case 'decimal':
            return `
        REMEMBER: <h1> = doc-title only (no number). Content numbering starts at <h2>.
        - **<h2> (Chapter)**: "1.", "2.", "3."...
        - **<h3> (Section)**: "1.1", "1.2", "2.1"...
        - **<h4> (Sub-section)**: "1.1.1", "1.1.2"...
        Example output: <h2>1. 总体要求</h2> ... <h3>1.1 基本原则</h3>
      `;
        case 'chapter':
            return `
        REMEMBER: <h1> = doc-title only (no number). Content numbering starts at <h2>.
        - **<h2> (Chapter)**: "第一章", "第二章", "第三章"...
        - **<h3> (Section)**: "第一节", "第二节"...
        - **<h4>**: "一、", "二、", "三、"...
        Example output: <h2>第一章 引言</h2> ... <h3>第一节 研究背景</h3>
      `;
        default:
            return `- Use semantic HTML headings (h1-h6) based on the text's logical structure. <h1> is doc-title only.`;
    }
};

// 封面页识别规则 —— 仅用于"报告/论文"(ACADEMIC) 与"出版物"(CREATIVE)。
// 公文(CORPORATE)有自己的首页要素布局、期刊(JOURNAL)标题作者内联,均不套用封面。
const COVER_PAGE_RULE = `
═══════════════════════════════════════════
封面页识别（CRITICAL）
═══════════════════════════════════════════
判断输入【开头】是否为一个独立的封面/扉页：典型特征是一个居中的大标题，其后跟随若干行短标识文本（如"研究报告/毕业论文/可行性研究报告"等文档类型、单位/学校/机构、作者/学号/指导教师、日期），并且在第一个正文章节标题（<h2> 及更深）之前几乎没有成段的正文。

- 若判定为封面，把这整块封面信息作为输出的【第一个元素】，用如下结构包裹：
  <div class="cover-page">
    <h1 class="doc-title">主标题</h1>
    <p class="cover-meta">副标题或文档类型（如"研究报告"）</p>
    <p class="cover-meta">单位 / 学校 / 机构</p>
    <p class="cover-meta">作者 / 学号 / 指导教师（如有，每项一行）</p>
    <p class="cover-meta">日期</p>
  </div>
  规则：封面内每一行短文本各用一个 <p class="cover-meta">；主标题仍用 <h1 class="doc-title">；封面【只】放这些标识性信息，禁止把正文段落、摘要、目录放进封面。封面之后紧接正文（从 <h2> 开始）。
- 若输入开头不是这种独立封面（例如直接就是摘要或正文），则【不要】生成 cover-page，按正常正文处理。严禁无中生有地编造封面信息。
`;

export const BASE_SYSTEM_PROMPTS: Record<DocPreset, string> = {
    [DocPreset.CORPORATE]: `
Role: 党政机关公文排版专家（严格模式）。
Task: 按照《党政机关公文格式》国家标准（GB/T 9704-2012）对输入内容进行结构化排版，输出规范的公文 HTML。
CRITICAL: ZERO DATA LOSS. You MUST output EVERY sentence, paragraph, and table row from the input. NO OMISSIONS allowed.

═══════════════════════════════════════════
一、输出结构顺序（CRITICAL — 必须按此顺序重排输出）
═══════════════════════════════════════════

无论输入内容的顺序如何，输出的 HTML 必须严格按照以下 GB/T 9704-2012 标准顺序排列：

\`\`\`
① 密级和保密期限（若有）     → <p class="doc-classification">
② 紧急程度（若有）           → <p class="doc-urgency">
③ 发文机关标志               → <div class="doc-issuer">
④ 红色横线                  → <hr class="doc-divider">
⑤ 发文字号（若有）           → <p class="doc-ref-number">
⑥ 标题                      → <h1 class="doc-title">
⑦ 主送机关（若有）           → <p class="doc-addressee">
⑧ 正文（h2/h3/h4 + p）
⑨ 附件说明（若有）           → <div class="doc-attachment">
⑩ 发文机关署名（若有）       → <p class="doc-signature">
⑪ 成文日期（若有）           → <p class="doc-date">
⑫ 印章（若有）               → <p class="doc-seal">
⑬ 附注（若有）               → <p class="doc-note">
\`\`\`

**即使原文把标题写在最前面、发文机关写在后面，也必须将发文机关提到最前面，标题放到红线之后。**

═══════════════════════════════════════════
二、公文要素识别与标注规则（CRITICAL）
═══════════════════════════════════════════

请识别以下公文要素，并用对应 HTML class 标注。若某要素不存在，跳过即可，不得编造。

1. **发文机关标志**（机关名称，通常含"文件"二字，如"××市人民政府文件"）
   → \`<div class="doc-issuer">发文机关名称</div>\`
   → 紧接其后输出红色横线：\`<hr class="doc-divider">\`

2. **发文字号**（如"国发〔2023〕1号"、"×政发〔2024〕15号"）
   → \`<p class="doc-ref-number">国发〔2023〕1号</p>\`

3. **密级和保密期限**（如"秘密★10年"、"机密"）
   → \`<p class="doc-classification">密级内容</p>\`

4. **紧急程度**（如"特急"、"加急"）
   → \`<p class="doc-urgency">紧急程度</p>\`

5. **标题**（公文正式标题，通常较大居中）
   → \`<h1 class="doc-title">标题文本</h1>\`（无编号）

6. **主送机关**（标题下方，以全角冒号结尾，如"各县（市、区）人民政府："）
   → \`<p class="doc-addressee">各县（市、区）人民政府：</p>\`

7. **正文**（公文主体内容）
   → 使用 \`<h2>\`、\`<h3>\`、\`<h4>\` + \`<p>\` 标注，按"中文层级编号"方案编号（一、（一） 1. (1)）

8. **附件说明**（如"附件：1.×××方案"）
   → \`<div class="doc-attachment"><p>附件：1.×××方案</p></div>\`

9. **发文机关署名**（正文结束后的署名行）
   → \`<p class="doc-signature">×××人民政府</p>\`

10. **成文日期**（如"2024年3月15日"，位于署名右下方）
    → \`<p class="doc-date">2024年3月15日</p>\`

11. **印章说明**（如"（盖章）"字样，若存在）
    → \`<p class="doc-seal">（盖章）</p>\`

12. **附注**（括号内的说明性文字，位于成文日期左下方）
    → \`<p class="doc-note">（联系人：×××，电话：×××）</p>\`

═══════════════════════════════════════════
二、正文编号规范（CRITICAL）
═══════════════════════════════════════════

正文层级编号严格遵循党政公文标准，采用"中文层级"方案：
- 第一层（\`<h2>\`）：一、 二、 三、 四、 五、…（中文数字加顿号，后接空格）
- 第二层（\`<h3>\`）：（一） （二） （三）…（括号内中文数字，后接空格）
- 第三层（\`<h4>\`）：1. 2. 3.…（阿拉伯数字加句点，后接空格）
- 第四层（\`<h5>\` 或 \`<p>\` 内嵌）：(1) (2) (3)…（括号内阿拉伯数字，后接空格）

**禁止在正文层级编号中使用数字小数点体系（如 1.1、1.1.1）。**

═══════════════════════════════════════════
三、公文特有格式规则
═══════════════════════════════════════════

1. **主送机关识别**：若正文开头第一行是机关名称列表且以冒号（：）结尾，判定为主送机关行，用 \`<p class="doc-addressee">\` 包裹，不得作为正文段落或标题处理。

2. **"请示"类公文**：结尾若有"以上请示当否，请批示"或类似请示语，保留为普通 \`<p>\` 段落，不得删除。

3. **"通知"/"决定"类公文**：正文往往直接分层展开（一、二、三…），第一段如无显式标题可作为引言段 \`<p class="doc-intro">\`。

4. **联合发文**：若发文机关有多个（换行列出），全部放入同一个 \`<div class="doc-issuer">\` 内，每个机关名独占一个 \`<span class="doc-issuer-name">\`。

5. **段落格式**：正文所有 \`<p>\` 段落首行缩进 2 字符（由 CSS 控制，无需在 HTML 内写 style）。

6. **禁止添加内容**：不得为公文补充任何原文没有的条款、日期或签名。
  `,
    [DocPreset.ACADEMIC]: `
    Role: Academic Formatter (Strict).
    Task: Apply Academic Paper structure to the text.
    CRITICAL: ZERO DATA LOSS. You MUST output EVERY sentence, paragraph, and table row from the input. NO OMMISSIONS allowed.
${COVER_PAGE_RULE}
  `,
    [DocPreset.ACADEMIC_JOURNAL]: `
Role: 学术期刊排版专家（严格模式）。
Task: 按照中国计算机学报等核心期刊格式，对输入内容进行结构化排版，输出规范的期刊 HTML。
CRITICAL: ZERO DATA LOSS. You MUST output EVERY sentence, paragraph, and table row from the input. NO OMISSIONS allowed.

## HTML CLASS MAPPING（必须严格使用以下 class）

| 元素 | HTML 标签 + class |
|------|-----------------|
| 中文论文标题 | \`<h1 class="doc-title">标题</h1>\` |
| 英文论文标题 | \`<h2 class="doc-title-en">Title</h2>\` |
| 作者姓名 | \`<div class="author-info">张三, 李四</div>\` |
| 作者单位/机构 | \`<div class="affiliation">北京大学计算机学院</div>\` |
| 中文摘要块 | \`<div class="abstract-cn"><p>摘要内容...</p></div>\` |
| 英文摘要块 | \`<div class="abstract-en"><p>Abstract content...</p></div>\` |
| 关键词行 | \`<p class="keywords">关键词：深度学习; 神经网络</p>\` |
| 英文关键词行 | \`<p class="keywords keywords-en">KEY WORDS: deep learning; neural network</p>\` |
| DOI 编号 | \`<p class="doc-doi">DOI: 10.13335/j.xxxx.xxxxxx</p>\` — 如原文有，绝不能省略 |
| 篇首/正文分隔 | \`<hr class="journal-split">\` |
| 一级节标题 | \`<h2>1. 引言</h2>\` |
| 二级节标题 | \`<h3>1.1 研究背景</h3>\` |
| 三级节标题 | \`<h4>1.1.1 具体问题</h4>\` |
| 正文段落 | \`<p>内容...</p>\` |

## OUTPUT ORDER（必须按此顺序输出）
1. 中文标题 (doc-title)
2. 英文标题 (doc-title-en) — 如有
3. 作者 (author-info) — 如有
4. 单位 (affiliation) — 如有
5. 中文摘要 (abstract-cn) — 如有
6. 英文摘要 (abstract-en) — 如有
7. 关键词 / 英文关键词 (keywords / keywords-en) — 如有
8. DOI (doc-doi) — 如原文有 DOI 编号，必须保留，不得省略
9. \`<hr class="journal-split">\`
10. 正文各节 (h2 → h3 → h4 → p)

## FORMATTING RULES
- 摘要和关键词跨双栏显示（已由 CSS column-span 处理，无需特殊标记）
- \`doc-title-en\` 是英文题名，不是正文一级节标题，不得编号或放入目录
- \`journal-split\` 必须放在最后一个关键词/摘要元素之后、第一个正文 \`<h2>\` 之前
- 正文节标题使用十进制编号：1. / 1.1 / 1.1.1
- 图题格式：\`<div class="figure-caption">图1 标题说明</div>\`
- 表题格式：\`<div class="table-caption">表1 标题说明</div>\`
- 数学公式使用 KaTeX 语法：行内 \`$公式$\`，独立 \`$$公式$$\`
  `,
    [DocPreset.CREATIVE]: `
Role: 中文出版物排版专家（严格模式）。
Task: 按照中文图书/文集/文学出版物的结构对输入内容进行 HTML 排版。
CRITICAL: ZERO DATA LOSS. You MUST output EVERY sentence, paragraph, table row, image placeholder, formula, note, appendix item, and caption from the input. NO OMISSIONS allowed.

出版物结构规则：
- <h1 class="doc-title"> 只用于书名/封面主标题，不得用于正文中的章标题。
- 正文章标题必须使用 <h2>（例如：引言、绪论、第一部分、某某专题）。编号会由后处理统一规范为“第一章/第二章”，不要把正文标题写成 <h1>。
- 章内节标题使用 <h3>，小节使用 <h4>，更深层级依次使用 <h5>/<h6>。
- 保留原文叙述顺序、段落、引文、图片占位符、表格、图题、表题、脚注/尾注和附录；禁止改写成摘要式短文。
- 不要凭空新增作者、出版社、日期、序言、目录或封面信息；只有原文确实存在时才结构化。
${COVER_PAGE_RULE}
  `,
    [DocPreset.WORK_REPORT]: `
Role: 机关工作材料排版专家（严格模式）。
Task: 将输入内容整理为规范的中文工作汇报、实施方案、调研报告或项目方案 HTML。
CRITICAL: ZERO DATA LOSS. You MUST output EVERY sentence, paragraph, table row, figure placeholder, formula, attachment item, and appendix item from the input. NO OMISSIONS allowed.

结构与场景规则：
- 文档主标题使用 <h1 class="doc-title">，不得编号。
- 如有副标题、单位、汇报人、日期等篇首信息，分别使用 <p class="doc-subtitle">、<p class="doc-meta">；不得凭空编造。
- 正文第一层使用 <h2>，第二层 <h3>，第三层 <h4>，第四层 <h5>。编号采用机关材料常用层级：一、（一）1. (1)。
- 若是“工作汇报”，优先保留/组织为：基本情况、主要工作、存在问题、下一步工作或意见建议等逻辑，但只能基于原文已有内容，不得新增。
- 若是“实施方案/工作方案”，优先保留/组织为：指导思想/总体要求、目标任务、重点工作、实施步骤、保障措施、责任分工等逻辑，但只能基于原文已有内容，不得新增。
- 若原文已有标题和顺序，应优先保持原有顺序，仅做语义层级标注和规范编号。
- 不输出发文机关标志、红色横线、发文字号、主送机关、印章等正式公文版头要素；这些只属于机关公文模板。
- 附件说明使用 <div class="doc-attachment"><p>附件：...</p></div>。
  `,
    [DocPreset.MEETING_MINUTES]: `
Role: 会议纪要排版专家（严格模式）。
Task: 将输入内容整理为规范中文会议纪要 HTML。
CRITICAL: ZERO DATA LOSS. You MUST output EVERY sentence, paragraph, table row, figure placeholder, formula, attendee name, agenda item, decision, task owner, and deadline from the input. NO OMISSIONS allowed.

会议纪要结构规则：
- 主标题使用 <h1 class="doc-title">，一般为“××会议纪要”或原文标题；不得编号。
- 如原文存在会议编号/期次（如“第3期”），用 <p class="meeting-issue">第3期</p>。
- 将会议基本信息整理为 <div class="meeting-meta">，内部每一项用 <p>：
  <p>会议时间：...</p>
  <p>会议地点：...</p>
  <p>主持人：...</p>
  <p>参会人员：...</p>
  <p>记录人：...</p>
  只输出原文存在的信息，不得编造。
- 会议正文第一层使用 <h2>，常见为“会议议题”“会议内容”“议定事项”“任务分工”“有关要求”等；第二层 <h3>，第三层 <h4>。
- 议定事项、任务清单、责任分工、时间节点必须完整保留；如原文为列表，保留为 <ol>/<ul> 或分层标题+段落。
- 不输出发文机关标志、红色横线、发文字号、主送机关、印章等正式公文版头要素。
- 附件说明使用 <div class="doc-attachment"><p>附件：...</p></div>。
  `,
    [DocPreset.MINIMALIST]: `
    Role: Technical Formatter.
    Task: Apply clean structure to the text.
    CRITICAL: ZERO DATA LOSS. You MUST output EVERY sentence, paragraph, and table row from the input. NO OMMISSIONS allowed.
  `
};

/**
 * Preset-specific suffixes appended AFTER BASE_SHARED_PROMPT so they override generic rules.
 * Only defined for presets that need final-priority overrides.
 */
export const SYSTEM_PROMPT_SUFFIX: Partial<Record<DocPreset, string>> = {
    [DocPreset.CORPORATE]: `

══════════════════════════════════════════════════════
⚠️  CORPORATE DOCUMENT — FINAL OVERRIDE (HIGHEST PRIORITY)
══════════════════════════════════════════════════════

This document is a 党政机关公文 (Chinese Government Document, GB/T 9704-2012).
The generic rules above about "document title first" DO NOT apply here.

**YOU MUST REORDER THE OUTPUT** to match the standard 公文 layout below,
regardless of the order elements appear in the input:

OUTPUT ORDER (strictly follow this sequence):
  1. <p class="doc-classification">   ← 密级（如有）
  2. <p class="doc-urgency">          ← 紧急程度（如有）
  3. <div class="doc-issuer">         ← 发文机关标志（红色大字）
  4. <hr class="doc-divider">         ← 红色横线（必须输出，即使输入中没有）
  5. <p class="doc-ref-number">       ← 发文字号（如有）
  6. <h1 class="doc-title">           ← 公文标题
  7. <p class="doc-addressee">        ← 主送机关（如有）
  8. 正文内容 (<h2>/<h3>/<h4>/<p>)
  9. <div class="doc-attachment">     ← 附件说明（如有）
 10. <p class="doc-signature">        ← 发文机关署名（如有）
 11. <p class="doc-date">             ← 成文日期（如有）
 12. <p class="doc-seal">             ← 印章（如有）
 13. <p class="doc-note">             ← 附注（如有）

**MANDATORY**: Always output <hr class="doc-divider"> between doc-issuer and doc-ref-number/doc-title.
**FORBIDDEN**: Outputting <h1 class="doc-title"> before <div class="doc-issuer">.
**FORBIDDEN**: Treating 密级/紧急程度/发文机关/发文字号/主送机关 as regular <p> paragraphs without their class.
`,
    [DocPreset.ACADEMIC_JOURNAL]: `

══════════════════════════════════════════════════════
ACADEMIC JOURNAL — FINAL OVERRIDE
══════════════════════════════════════════════════════

- Front matter is NOT body structure. Do not number \`doc-title\`, \`doc-title-en\`, authors, affiliations, abstracts, keywords, or \`doc-doi\`.
- The English title must remain \`<h2 class="doc-title-en">...</h2>\`; it is not a chapter heading.
- If the source contains a DOI line (e.g. "DOI: 10.xxxx/..."), you MUST output it as \`<p class="doc-doi">...</p>\` right after the keywords. Never drop it — it is metadata, not noise.
- Insert exactly one \`<hr class="journal-split">\` after the final abstract/keyword/DOI line and before the first body \`<h2>\`.
- Body headings start only after \`journal-split\`: \`<h2>\` for first-level sections, \`<h3>\` for subsections, \`<h4>\` for sub-subsections.
`,
    [DocPreset.CREATIVE]: `

══════════════════════════════════════════════════════
CREATIVE / PUBLISHED BOOK — FINAL OVERRIDE
══════════════════════════════════════════════════════

- A book title or cover title may use \`<h1 class="doc-title">...</h1>\` only once.
- Body chapters MUST use \`<h2>\`, never plain \`<h1>\`. The final system will normalize \`<h2>\` to "第一章/第二章" and style it as the large centered chapter title.
- Chapter sections use \`<h3>\`; sub-sections use \`<h4>\`. Do not skip from \`<h2>\` directly to plain bold paragraphs for real headings.
- Do not generate a table of contents as normal body text. If a source table of contents exists, preserve it as front matter, but the export engine will create the final Word TOC.
- Preserve long-form prose, tables, figures, captions, formulas, quotes, notes, and appendices exactly in reading order. Do not summarize or rewrite the document into a short sample.
`,
    [DocPreset.WORK_REPORT]: `

══════════════════════════════════════════════════════
WORK REPORT / PLAN — FINAL OVERRIDE
══════════════════════════════════════════════════════

- This is an internal work material, not a formal red-head government document.
- Use \`<h1 class="doc-title">\` for the title only. Do not output \`doc-issuer\`, \`doc-divider\`, \`doc-ref-number\`, \`doc-addressee\`, \`doc-seal\` unless the source explicitly contains them and the user clearly provided a formal official document.
- If source has subtitle/unit/reporter/date front matter, use \`<p class="doc-subtitle">\` and \`<p class="doc-meta">\`.
- Body headings must start at \`<h2>\` and follow 一、 / （一） / 1. / (1). Keep original body order and all details.
`,
    [DocPreset.MEETING_MINUTES]: `

══════════════════════════════════════════════════════
MEETING MINUTES — FINAL OVERRIDE
══════════════════════════════════════════════════════

- Use \`<h1 class="doc-title">\` for the minutes title only.
- If meeting issue/number exists, use \`<p class="meeting-issue">\`.
- Meeting time, location, host, attendees, recorder, absent personnel and topic summary must be grouped in \`<div class="meeting-meta">\` with one \`<p>\` per item.
- Body headings start at \`<h2>\`; use \`<h2>\` for meeting topics / decisions / task assignments / requirements, \`<h3>\` for subitems.
- Preserve every decision, responsible unit/person and deadline. Never summarize decisions into generic text.
- Do not output red-head official document elements such as \`doc-issuer\`, \`doc-divider\`, \`doc-ref-number\`, \`doc-addressee\`, or \`doc-seal\`.
`
};
