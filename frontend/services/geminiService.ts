
import { GoogleGenAI } from "@google/genai";
import { DocPreset, StyleConfig } from "../types";
import i18n from '../i18n';

// Helper to generate instructions based on the numbering style
const getNumberingInstruction = (style: string): string => {
  switch (style) {
    case 'chinese-hierarchical':
      return `
        - **H1 (Section Level 1)**: MUST use Chinese numbers "一、", "二、", "三、"...
        - **H2 (Section Level 2)**: MUST use parenthesized Chinese numbers "（一）", "（二）"...
        - **H3 (Section Level 3)**: MUST use Arabic numbers "1.", "2."...
        - **H4 (Section Level 4)**: MUST use parenthesized Arabic numbers "（1）", "（2）"...
        - **H5/H6**: Use simple Arabic numbers or bullets if further nesting is required.
        - **Rule**: If the original text uses a different scheme, convert it to this scheme. Ensure hierarchy is logical.
      `;
    case 'decimal-nested':
      return `
        - **H1**: "1.", "2."...
        - **H2**: "1.1", "1.2"...
        - **H3**: "1.1.1", "1.1.2"...
        - **H4**: "1.1.1.1"...
        - **H5**: "1.1.1.1.1"... (and so on)
      `;
    case 'decimal':
      return `
        - **H1**: "1.", "2."...
        - **H2**: "2.1", "2.2"...
        - **H3**: Use simple bold text or bullets if deep nesting is needed.
      `;
    case 'chapter':
      return `
        - **H1**: "第一章", "第二章"...
        - **H2**: "第一节", "第二节"...
        - **H3**: "一、", "二、"...
        - **H4**: "1.", "2."...
      `;
    default:
      return `- Use semantic HTML headings (h1-h6) based on the text's logical structure. Do not force specific numbering unless present in source.`;
  }
};

const BASE_SYSTEM_PROMPTS: Record<DocPreset, string> = {
  [DocPreset.CORPORATE]: `
    Role: Document Formatter (Strict).
    Task: Apply formal Chinese Corporate Document structure (headings, numbering) to the text.
    CRITICAL: ZERO DATA LOSS. You MUST output EVERY sentence, paragraph, and table row from the input. NO OMMISSIONS allowed.
  `,
  [DocPreset.ACADEMIC]: `
    Role: Academic Formatter (Strict).
    Task: Apply Academic Paper structure to the text.
    CRITICAL: ZERO DATA LOSS. You MUST output EVERY sentence, paragraph, and table row from the input. NO OMMISSIONS allowed.
  `,
  [DocPreset.ACADEMIC_JOURNAL]: `
    Role: Journal Typesetter (Strict).
    Task: Apply rigorous "Chinese Journal of Computers" (计算机学报) style.
    Structure requirement:
    1. Title (Chinese) (H1, class='doc-title')
    2. Title (English, if present) (P, class='doc-title-en')
    3. Authors (P, class='author-info')
    4. Affiliations (P, class='affiliation')
    5. Abstract (Chinese) & Keywords: 
       - Wrapped in <div class="abstract-cn">...</div>
       - MUST format as: <p><b>摘要：</b>Content...</p> <p><b>关键词：</b>Content...</p>
    6. Abstract (English) & Keywords:
       - Wrapped in <div class="abstract-en">...</div>
       - MUST format as: <p><b>Abstract:</b> Content...</p> <p><b>Keywords:</b> Content...</p>
    7. Main Body (Standard H1, H2, H3, P for two-column layout)
    CRITICAL: ZERO DATA LOSS. Output EVERY sentence.
  `,
  [DocPreset.CREATIVE]: `
    Role: Book Typesetter.
    Task: Apply Narrative structure to the text.
    CRITICAL: ZERO DATA LOSS. You MUST output EVERY sentence, paragraph, and table row from the input. NO OMMISSIONS allowed.
  `,
  [DocPreset.WORK_REPORT]: `
    Role: Chinese Work Report / Plan Formatter.
    Task: Apply formal work-report or implementation-plan structure with Chinese hierarchical numbering.
    CRITICAL: ZERO DATA LOSS. You MUST output EVERY sentence, paragraph, and table row from the input. NO OMMISSIONS allowed.
  `,
  [DocPreset.MEETING_MINUTES]: `
    Role: Chinese Meeting Minutes Formatter.
    Task: Apply formal meeting-minutes structure with meeting metadata, topics, decisions, responsibilities, and deadlines.
    CRITICAL: ZERO DATA LOSS. You MUST output EVERY sentence, paragraph, attendee, decision, task owner, deadline, and table row from the input. NO OMMISSIONS allowed.
  `,
  [DocPreset.MINIMALIST]: `
    Role: Technical Formatter.
    Task: Apply clean structure to the text.
    CRITICAL: ZERO DATA LOSS. You MUST output EVERY sentence, paragraph, and table row from the input. NO OMMISSIONS allowed.
  `
};

// Helper to clean Markdown code blocks from the output
const cleanOutput = (text: string): string => {
  return text.replace(/```html/g, '').replace(/```/g, '').trim();
};

// Helper to convert HTML string with base64 images into Gemini Parts (Multimodal)
const htmlToParts = (html: string): any[] => {
  const parts: any[] = [];
  // Regex to capture the full img tag containing base64 data
  const imgRegex = /(<img\s+[^>]*src="data:image\/([^;]+);base64,([^"]+)"[^>]*>)/g;

  let lastIndex = 0;
  let match;

  while ((match = imgRegex.exec(html)) !== null) {
    const mimeType = match[2];
    const base64Data = match[3];

    // Text/HTML before the image
    const preText = html.substring(lastIndex, match.index);
    if (preText) parts.push({ text: preText });

    // The Image Part (Gemini Vision)
    parts.push({
      inlineData: {
        mimeType: `image/${mimeType}`,
        data: base64Data
      }
    });

    // Hint for the model to treat the previous image part as context
    parts.push({ text: "\n[The image above is likely a formula or figure. If it's a formula, transcribe it to LaTeX wrapped in $$. If it's a diagram, describe it.]\n" });

    lastIndex = imgRegex.lastIndex;
  }

  // Remaining HTML
  const remaining = html.substring(lastIndex);
  if (remaining) parts.push({ text: remaining });

  // Default fallback if no images found
  return parts.length > 0 ? parts : [{ text: html }];
};

export const restructureDocument = async (
  content: string,
  preset: DocPreset,
  fileName: string,
  styleConfig?: StyleConfig,
  onStreamUpdate?: (partialText: string) => void,
  signal?: AbortSignal
): Promise<string> => {
  if (!process.env.API_KEY) {
    throw new Error("API Key is missing.");
  }

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

  // Build dynamic system instruction
  let systemInstruction = BASE_SYSTEM_PROMPTS[preset];

  if (styleConfig) {
    const numberingRules = getNumberingInstruction(styleConfig.headingNumbering);

    // Determine figure numbering logic
    let figureInstruction = "";
    if (styleConfig.figureNumbering === 'chapter-relative') {
      figureInstruction = `If the text describes an image/chart that is NOT a formula, insert a placeholder: <div class="image-placeholder">图[Chapter]-[Sequence]：[Description]</div>.`;
    } else {
      figureInstruction = `If the text describes an image/chart that is NOT a formula, insert a placeholder: <div class="image-placeholder">图[Sequence] [Description]</div>.`;
    }

    // Determine table numbering logic
    let tableInstruction = "";
    if (styleConfig.tableNumbering === 'chapter-relative') {
      tableInstruction = `Identify tables in the content. Insert a caption paragraph BEFORE each table formatted strictly as: <p class="table-caption">表[Chapter]-[Sequence] [Title derived from context]</p>. (e.g., 表1-1 数据统计). Reset sequence at new H1.`;
    } else {
      tableInstruction = `Identify tables in the content. Insert a caption paragraph BEFORE each table formatted strictly as: <p class="table-caption">表[Sequence] [Title derived from context]</p>. (e.g., 表1 数据统计). Continuous numbering.`;
    }

    systemInstruction += `
      \nFormatting & Structural Analysis Rules:
      1. **DOCUMENT TITLE vs HEADINGS (CRITICAL)**:
         - Identify the **Document Title**. Wrap it in \`<h1 class="doc-title">\`. NO numbering.
         - Start numbering (H1: "1.", H2: "1.1") from the **first content section**.

      2. **IDENTIFY SECTIONS**: 
         - Analyze semantic structure. Tag <h1>, <h2>... <h6>.
      
      3. **APPLY NUMBERING SCHEME**: 
         - ${numberingRules}
         
      4. **SPECIAL JOURNAL RULES** (Only if preset is ACADEMIC_JOURNAL):
         - Detect Authors/Affiliations. Wrap in class 'author-info' / 'affiliation'.
         - Detect Abstract/Keywords (CN/EN). Wrap in 'abstract-cn' / 'abstract-en'.
         - EN title in class 'doc-title-en'.

      5. **Content Integrity (STRICT)**: 
         - **ZERO DATA LOSS**. Output every sentence, row, and list item.
         - **VERBATIM BODY TEXT**. Do not summarize.

      6. **Images & Figures**: 
         - The input contains embedded images. 
         - **IF IMAGE IS A FORMULA**: You MUST Transcribe it into **LaTeX format wrapped in $$**. (e.g., $$ E = mc^2 $$). Do NOT output image tags for formulas.
         - **IF IMAGE IS A CHART/DIAGRAM**: ${figureInstruction}
      
      7. **Tables**: ${tableInstruction}. Keep structure. Use rowspan/colspan.

      8. **MATH & FORMULAS (HIGHEST PRIORITY)**:
         - **Format**: All mathematical formulas, equations, and variables MUST be output as **LaTeX wrapped in double dollar signs** ($$ ... $$).
         - **Examples**:
            - Inline: "...where $$ x $$ is the variable..."
            - Block: "...as shown below: $$ \\sum_{i=1}^{n} x_i $$"
            - Matrices: "$$ A^T A $$", "$$ \\hat{X} $$"
         - **DO NOT** use HTML <sub>, <sup>, or &sum; entities for math. Use LaTeX.
         - **DO NOT** use Markdown code blocks for math. Just inline $$ ... $$ in the HTML.
         - **Systems of Equations**: Use LaTeX array environment inside $$ $$.
         - **Context**: Check the "Raw Context" provided at the end of input for original formula data.

      9. **Output**: Return ONLY raw semantic HTML body content. Do NOT output the "raw-context" div in the final result.
    `;
  }

  // Parse HTML content into text and image parts for Multimodal input
  const contentParts = htmlToParts(content);

  try {
    const responseStream = await ai.models.generateContentStream({
      model: 'gemini-3-pro-preview',
      contents: [
        {
          role: 'user',
          parts: [
            { text: `Filename: ${fileName}\n\nContent to reformat (may contain images of formulas):\n` },
            ...contentParts
          ]
        }
      ],
      config: {
        systemInstruction: systemInstruction,
        temperature: 0.1,
      }
    });

    let fullText = '';

    for await (const chunk of responseStream) {
      if (signal?.aborted) {
        throw new Error("ABORT_ERR");
      }

      const chunkText = chunk.text;
      if (chunkText) {
        fullText += chunkText;
        if (onStreamUpdate) {
          onStreamUpdate(cleanOutput(fullText));
        }
      }
    }

    if (!fullText) throw new Error("No content generated.");

    return cleanOutput(fullText);

  } catch (error: any) {
    if (error.message === "ABORT_ERR") {
      throw error;
    }

    console.error("Gemini API Error:", error);
    if (error.message && (error.message.includes("token count") || error.message.includes("400"))) {
      throw new Error(i18n.t('errors.doc_too_long', "文档内容过长或图片过多（超过AI处理上限），请尝试删除文档中的大型装饰性图片。"));
    }

    throw error;
  }
};
