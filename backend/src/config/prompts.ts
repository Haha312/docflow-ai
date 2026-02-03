import { DocPreset } from '../types';

export const getNumberingInstruction = (style: string): string => {
    switch (style) {
        case 'chinese-hierarchical':
            return `
        - **H1 (Section Level 1)**: MUST use Chinese numbers "一、", "二、", "三、"...
        - **H2 (Section Level 2)**: MUST use parenthesized Chinese numbers "(一)", "(二)"...
        - **H3 (Section Level 3)**: MUST use Arabic numbers "1.", "2."...
        - **H4 (Section Level 4)**: MUST use parenthesized Arabic numbers "(1)", "(2)"...
      `;
        case 'decimal-nested':
            return `
        - **H1**: "1.", "2."...
        - **H2**: "1.1", "1.2"...
        - **H3**: "1.1.1", "1.1.2"...
        - **H4**: "1.1.1.1", "1.1.1.2"...
      `;
        case 'decimal':
            return `
        - **H1**: "1.", "2."...
        - **H2**: "2.1", "2.2"...
        - **H3**: "2.1.1", "2.1.2"...
      `;
        case 'chapter':
            return `
        - **H1**: "第一章", "第二章"...
        - **H2**: "第一节", "第二节"...
        - **H3**: "一、", "二、"...
      `;
        default:
            return `- Use semantic HTML headings (h1-h6) based on the text's logical structure.`;
    }
};

export const BASE_SYSTEM_PROMPTS: Record<DocPreset, string> = {
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
    Task: Apply rigorous "Chinese Journal of Computers" style.
    CRITICAL: ZERO DATA LOSS. Output EVERY sentence.
  `,
    [DocPreset.CREATIVE]: `
    Role: Book Typesetter.
    Task: Apply Narrative structure to the text.
    CRITICAL: ZERO DATA LOSS. You MUST output EVERY sentence, paragraph, and table row from the input. NO OMMISSIONS allowed.
  `,
    [DocPreset.MINIMALIST]: `
    Role: Technical Formatter.
    Task: Apply clean structure to the text.
    CRITICAL: ZERO DATA LOSS. You MUST output EVERY sentence, paragraph, and table row from the input. NO OMMISSIONS allowed.
  `
};
