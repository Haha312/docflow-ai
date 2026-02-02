
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, LineRuleType, Table, TableRow, TableCell, BorderStyle, WidthType, SectionType, Footer, PageNumber, Math as DocxMath, MathRun, MathSuperScript, MathSubScript, MathFraction, MathRadical } from "docx";
import { StyleConfig, Alignment } from "../types";

// --- Helpers ---

const getPtSize = (str: string): number => {
  const match = str.match(/(\d+(\.\d+)?)/);
  return match ? parseFloat(match[0]) : 12;
}

const getHalfPtSize = (str: string): number => {
  return Math.round(getPtSize(str) * 2);
}

const getSpacingTwips = (str: string, fontSizePt: number): number => {
    if (!str) return 0;
    const val = parseFloat(str);
    if (isNaN(val)) return 0;
    
    if (str.includes("行")) {
        return Math.round(val * fontSizePt * 30);
    }
    
    if (str.includes("pt") || str.includes("磅")) {
        return Math.round(val * 20);
    }
    
    return Math.round(val * fontSizePt * 30);
}

const getLineHeightConfig = (str: string) => {
    const s = str.toLowerCase().trim();
    const val = parseFloat(s);
    if (isNaN(val)) return { line: 240, rule: LineRuleType.AUTO }; 

    if (s.includes("pt") || s.includes("磅")) {
        return { line: Math.round(val * 20), rule: LineRuleType.EXACT };
    }

    return { line: Math.round(val * 240), rule: LineRuleType.AUTO };
}

const cleanFontName = (fontStr: string): string => {
    if (!fontStr) return "Times New Roman";
    const match = fontStr.match(/["']([^"']+)["']/);
    if (match) return match[1];
    const first = fontStr.split(',')[0].trim();
    return first.replace(/['"]/g, ''); 
}

const cleanColor = (colorStr: string): string => {
    if (!colorStr) return "000000";
    return colorStr.startsWith('#') ? colorStr.substring(1) : colorStr;
}

const mapAlignment = (align: Alignment) => {
    switch (align) {
        case 'center': return AlignmentType.CENTER;
        case 'right': return AlignmentType.RIGHT;
        case 'justify': return AlignmentType.JUSTIFIED;
        case 'left': default: return AlignmentType.LEFT;
    }
}

const getIndentConfig = (indentStr: string, fontSizePt: number) => {
    if (!indentStr || indentStr === '0' || indentStr === '0px') {
        return undefined;
    }
    const emMatch = indentStr.match(/(\d+(\.\d+)?)em/);
    const ptMatch = indentStr.match(/(\d+(\.\d+)?)pt/);

    if (emMatch) {
        const val = parseFloat(emMatch[1]);
        return { 
            firstLine: Math.round(val * fontSizePt * 20),
            firstLineChars: Math.round(val * 100) 
        };
    } 
    
    if (ptMatch) {
        const val = parseFloat(ptMatch[1]);
        return { firstLine: Math.round(val * 20) };
    }

    if (indentStr.includes("字符")) {
         const val = parseFloat(indentStr) || 2; 
         return { 
            firstLine: Math.round(val * fontSizePt * 20),
            firstLineChars: Math.round(val * 100) 
         };
    }

    return { firstLine: 480, firstLineChars: 200 }; 
}

const isInlineNode = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) return true;
    if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = (node as HTMLElement).tagName.toUpperCase();
        return ['SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'SUP', 'SUB', 'CODE', 'A', 'BR', 'SMALL', 'BIG', 'STRIKE', 'S', 'DEL', 'INS', 'MARK', 'VAR', 'CITE', 'DFN', 'ABBR', 'TIME', 'DATA', 'LABEL', 'Q'].includes(tag);
    }
    return false;
};

// --- Advanced Math Parser ---

const findBalancedClosing = (str: string, startIndex: number, openToken: string, closeToken: string): number => {
    let balance = 1;
    let i = startIndex;
    while (i < str.length && balance > 0) {
        if (str.startsWith(openToken, i)) {
            balance++;
            i += openToken.length;
        } else if (str.startsWith(closeToken, i)) {
            balance--;
            if (balance === 0) return i; // Found it
            i += closeToken.length;
        } else {
            if (str[i] === '\\') i += 2;
            else i++;
        }
    }
    return -1;
};

const mapDelimiterChar = (char: string): string => {
    if (char === '{') return '{';
    if (char === '}') return '}';
    if (char === '[') return '[';
    if (char === ']') return ']';
    if (char === '(') return '(';
    if (char === ')') return ')';
    if (char === '|') return '|';
    if (char === '.') return ''; 
    if (!char) return '';
    if (char.length > 1 && char.startsWith('\\')) {
         const c = char.substring(1);
         if (c === '{') return '{';
         if (c === '}') return '}';
    }
    return char;
};

const parseLatexToMathNodes = (latex: string): any[] => {
    const children: any[] = [];
    
    // 1. Basic Cleanup & Normalization
    let cleanLatex = latex.replace(/^\$\$/, '').replace(/\$\$$/, '').trim();
    cleanLatex = cleanLatex
        .replace(/\\\\begin/g, '\\begin')
        .replace(/\\\\end/g, '\\end')
        .replace(/\\\\left/g, '\\left')
        .replace(/\\\\right/g, '\\right')
        .replace(/\\_/g, '_'); 

    let i = 0;

    const skipWhitespace = () => {
        while (i < cleanLatex.length && /\s/.test(cleanLatex[i])) i++;
    };

    const getGroupContent = (): string => {
        skipWhitespace();
        if (i >= cleanLatex.length) return "";
        if (cleanLatex[i] === '{') {
            const start = i + 1;
            const endIdx = findBalancedClosing(cleanLatex, start, '{', '}');
            if (endIdx !== -1) {
                i = endIdx + 1; 
                return cleanLatex.substring(start, endIdx);
            }
        } else if (cleanLatex[i] === '\\') {
            let start = i;
            i++;
            while (i < cleanLatex.length && /[a-zA-Z]/.test(cleanLatex[i])) i++;
            return cleanLatex.substring(start, i);
        } else {
            return cleanLatex[i++];
        }
        return "";
    };

    while (i < cleanLatex.length) {
        const char = cleanLatex[i];

        if (char === '\\') {
            if (i + 1 < cleanLatex.length && cleanLatex[i+1] === '\\') {
                 // Double backslash treated as separator/space
                 children.push(new MathRun("  "));
                 i += 2;
                 continue;
            }

            i++; // skip \
            
            if (i < cleanLatex.length && !/[a-zA-Z]/.test(cleanLatex[i])) {
                const sym = cleanLatex[i];
                if (sym === '{' || sym === '}') children.push(new MathRun(sym));
                else if (sym === ',') children.push(new MathRun(" "));
                else if (sym === ';') children.push(new MathRun("  "));
                else if (sym === ' ') children.push(new MathRun(" "));
                i++;
                continue;
            }

            let cmd = "";
            while (i < cleanLatex.length && /[a-zA-Z]/.test(cleanLatex[i])) {
                cmd += cleanLatex[i];
                i++;
            }

            if (cmd === 'left') {
                skipWhitespace();
                let delimChar = cleanLatex[i];
                let delimLen = 1;
                if (delimChar === '\\') {
                    delimChar += cleanLatex[i+1];
                    delimLen = 2;
                }
                i += delimLen;

                const startBody = i;
                const endBodyIdx = findBalancedClosing(cleanLatex, i, '\\left', '\\right');
                
                if (endBodyIdx !== -1) {
                    const body = cleanLatex.substring(startBody, endBodyIdx);
                    // Find right delimiter
                    let rightDelimStart = endBodyIdx + 6; 
                    while (rightDelimStart < cleanLatex.length && /\s/.test(cleanLatex[rightDelimStart])) rightDelimStart++;
                    
                    let endDelimChar = cleanLatex[rightDelimStart];
                    if (endDelimChar === '\\') {
                         endDelimChar += cleanLatex[rightDelimStart+1];
                         i = rightDelimStart + 2;
                    } else {
                         i = rightDelimStart + 1;
                    }

                    // Fallback: Use MathRun for delimiters since MathDelimiter is unavailable
                    children.push(new MathRun(mapDelimiterChar(delimChar)));
                    children.push(...parseLatexToMathNodes(body));
                    children.push(new MathRun(mapDelimiterChar(endDelimChar)));
                } 
            } else if (cmd === 'begin') {
                const env = getGroupContent();
                const startBody = i;
                const endTag = `\\end{${env}}`;
                
                const endBodyIdx = findBalancedClosing(cleanLatex, i, `\\begin{${env}}`, endTag);

                if (endBodyIdx !== -1) {
                    let body = cleanLatex.substring(startBody, endBodyIdx);
                    i = endBodyIdx + endTag.length;

                    // Fallback: Linearize matrix/environment content
                    // We treat & as space and \\ as space in general parsing loop or here?
                    // The recursive call will handle characters. We just wrap in brackets for clarity if needed.
                    if (env === 'pmatrix') children.push(new MathRun("("));
                    else if (env === 'bmatrix') children.push(new MathRun("["));
                    else if (env === 'vmatrix') children.push(new MathRun("|"));
                    else if (env === 'cases') children.push(new MathRun("{"));

                    children.push(...parseLatexToMathNodes(body));

                    if (env === 'pmatrix') children.push(new MathRun(")"));
                    else if (env === 'bmatrix') children.push(new MathRun("]"));
                    else if (env === 'vmatrix') children.push(new MathRun("|"));
                }
            } else if (cmd === 'frac') {
                const num = getGroupContent();
                const den = getGroupContent();
                children.push(new MathFraction({ 
                    numerator: parseLatexToMathNodes(num), 
                    denominator: parseLatexToMathNodes(den) 
                }));
            } else if (cmd === 'sqrt') {
                 skipWhitespace();
                 let degree = undefined;
                 if (cleanLatex[i] === '[') {
                     const startDeg = i + 1;
                     const endDeg = cleanLatex.indexOf(']', startDeg);
                     if (endDeg !== -1) {
                         degree = cleanLatex.substring(startDeg, endDeg);
                         i = endDeg + 1;
                     }
                 }
                 const radContent = getGroupContent();
                 children.push(new MathRadical({
                     degree: degree ? parseLatexToMathNodes(degree) : undefined,
                     children: parseLatexToMathNodes(radContent)
                 }));
            } else if (cmd === 'sum') {
                 // Fallback for MathNary
                 children.push(new MathRun("∑"));
            } else if (cmd === 'prod') {
                 children.push(new MathRun("∏"));
            } else if (cmd === 'int') {
                 children.push(new MathRun("∫"));
            } else if (['alpha','beta','gamma','delta','theta','lambda','mu','pi','sigma','phi','omega','rho','tau','epsilon','eta','zeta','xi','psi','chi','nu','kappa'].includes(cmd)) {
                 const greekMap: any = { alpha:'α', beta:'β', gamma:'γ', delta:'δ', theta:'θ', lambda:'λ', mu:'μ', pi:'π', sigma:'σ', phi:'φ', omega:'ω', rho:'ρ', tau:'τ', epsilon:'ε', eta:'η', zeta:'ζ', xi:'ξ', psi:'ψ', chi:'χ', nu:'ν', kappa:'κ' };
                 children.push(new MathRun(greekMap[cmd]));
            } else if (['Alpha','Beta','Gamma','Delta','Theta','Lambda','Pi','Sigma','Phi','Omega'].includes(cmd)) {
                 const greekMap: any = { Alpha:'Α', Beta:'Β', Gamma:'Γ', Delta:'Δ', Theta:'Θ', Lambda:'Λ', Pi:'Π', Sigma:'Σ', Phi:'Φ', Omega:'Ω' };
                 children.push(new MathRun(greekMap[cmd] || cmd));
            } else if (cmd === 'times') children.push(new MathRun("×"));
            else if (cmd === 'cdot') children.push(new MathRun("⋅"));
            else if (cmd === 'le' || cmd === 'leq') children.push(new MathRun("≤"));
            else if (cmd === 'ge' || cmd === 'geq') children.push(new MathRun("≥"));
            else if (cmd === 'ne' || cmd === 'neq') children.push(new MathRun("≠"));
            else if (cmd === 'approx') children.push(new MathRun("≈"));
            else if (cmd === 'sim') children.push(new MathRun("~"));
            else if (cmd === 'in') children.push(new MathRun("∈"));
            else if (cmd === 'infty') children.push(new MathRun("∞"));
            else if (cmd === 'pm') children.push(new MathRun("±"));
            else if (cmd === 'partial') children.push(new MathRun("∂"));
            else if (cmd === 'overline') {
                 // Fallback for MathBar
                 const content = getGroupContent();
                 children.push(...parseLatexToMathNodes(content));
            }
            else if (cmd === 'text' || cmd === 'mathrm' || cmd === 'mathbf') {
                const text = getGroupContent();
                children.push(new MathRun(text));
            }
            else {
                 // Unknown command
            }

        } else if (char === '^') {
            i++;
            const last = children.pop() || new MathRun("");
            const supStr = getGroupContent();
            children.push(new MathSuperScript({ children: [last], superScript: parseLatexToMathNodes(supStr) }));
        } else if (char === '_') {
            i++;
            const last = children.pop() || new MathRun("");
            const subStr = getGroupContent();
            children.push(new MathSubScript({ children: [last], subScript: parseLatexToMathNodes(subStr) }));
        } else if (char === '{' || char === '}') {
            i++; 
        } else if (/\s/.test(char)) {
            i++;
        } else if (char === '&') {
            children.push(new MathRun("  ")); // Space for alignment in matrices
            i++;
        } else {
            children.push(new MathRun(char));
            i++;
        }
    }
    return children;
};

// ... Rest of the file (generateDocx export) ...

export const generateDocx = async (htmlContent: string, styleConfig: StyleConfig): Promise<Blob> => {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(`<body>${htmlContent}</body>`, "text/html");
    
    // Style Helpers
    const bodyFont = cleanFontName(styleConfig.fontFamily);
    const headingFont = cleanFontName(styleConfig.headingFont);
    const figureFont = cleanFontName(styleConfig.figureFont);
    const tableFont = cleanFontName(styleConfig.tableFont);
    const tableCaptionFont = cleanFontName(styleConfig.tableCaptionFont);
    const primaryColor = cleanColor(styleConfig.primaryColor);
    
    const englishTitleFont = cleanFontName(styleConfig.englishTitleFont || "Times New Roman");
    const authorFont = cleanFontName(styleConfig.authorFont || styleConfig.fontFamily);
    const affiliationFont = cleanFontName(styleConfig.affiliationFont || styleConfig.fontFamily);
    
    const h1Font = styleConfig.h1Font ? cleanFontName(styleConfig.h1Font) : headingFont;
    const h2Font = styleConfig.h2Font ? cleanFontName(styleConfig.h2Font) : headingFont;
    const h3Font = styleConfig.h3Font ? cleanFontName(styleConfig.h3Font) : headingFont;
    const h4Font = styleConfig.h4Font ? cleanFontName(styleConfig.h4Font) : headingFont;
    const h5Font = styleConfig.h5Font ? cleanFontName(styleConfig.h5Font) : headingFont;
    const h6Font = styleConfig.h6Font ? cleanFontName(styleConfig.h6Font) : headingFont;

    const baseSizePt = getPtSize(styleConfig.baseSize);
    const spacingBeforeBody = getSpacingTwips(styleConfig.spacingBefore, baseSizePt);
    const spacingAfterBody = getSpacingTwips(styleConfig.spacingAfter, baseSizePt);
    const { line: lineValue, rule: lineRule } = getLineHeightConfig(styleConfig.lineHeight);
    const bodyIndent = getIndentConfig(styleConfig.textIndent, baseSizePt);

    const makeFont = (name: string) => {
        const chineseFonts = ['SimSun', 'FangSong', 'SimHei', 'KaiTi', 'Microsoft YaHei', 'PingFang SC', 'Heiti SC', 'Songti SC', 'DengXian', '等线', '宋体', '黑体', '楷体', '仿宋', '微软雅黑'];
        const cleanName = name.replace(/['"]/g, '');
        const isChineseFont = chineseFonts.some(f => cleanName.toLowerCase().includes(f.toLowerCase()));
        return { 
            name: name, 
            ascii: isChineseFont ? "Times New Roman" : name, 
            hAnsi: isChineseFont ? "Times New Roman" : name, 
            eastAsia: name, 
            cs: name 
        };
    };

    const getRichTextRuns = (node: Node, baseFont: any, baseSize: number, color: string = "000000"): (TextRun | DocxMath)[] => {
        const runs: (TextRun | DocxMath)[] = [];
        const traverse = (n: Node, style: { isBold: boolean, isItalic: boolean, isSup: boolean, isSub: boolean }) => {
            if (n.nodeType === Node.TEXT_NODE) {
                let t = n.textContent;
                if (t) {
                    t = t.replace(/[\n\r]+/g, ' '); 
                    const parts = t.split(/(\$\$[^$]+\$\$)/g);
                    parts.forEach(part => {
                        if (part.startsWith('$$') && part.endsWith('$$')) {
                            const latex = part.substring(2, part.length - 2);
                            const mathNodes = parseLatexToMathNodes(latex);
                            if (mathNodes.length > 0) runs.push(new DocxMath({ children: mathNodes }));
                        } else if (part.trim() !== "" || parts.length === 1) {
                            const hasMathChars = /[=+\-×÷<>\u2200-\u22FF\u0370-\u03FF]/.test(part); 
                            const runFont = hasMathChars ? { ...baseFont, ascii: "Times New Roman", hAnsi: "Times New Roman" } : baseFont;
                            runs.push(new TextRun({
                                text: part,
                                font: runFont,
                                size: baseSize,
                                color: color,
                                bold: style.isBold,
                                italics: style.isItalic,
                                superScript: style.isSup,
                                subScript: style.isSub
                            }));
                        }
                    });
                }
            } else if (n.nodeType === Node.ELEMENT_NODE) {
                const el = n as HTMLElement;
                const tag = el.tagName.toUpperCase();
                if (tag === 'BR') { runs.push(new TextRun({ break: 1 })); return; }
                const nextStyle = { ...style };
                if (tag === 'B' || tag === 'STRONG') nextStyle.isBold = true;
                if (tag === 'I' || tag === 'EM') nextStyle.isItalic = true;
                if (tag === 'SUP') nextStyle.isSup = true;
                if (tag === 'SUB') nextStyle.isSub = true;
                el.childNodes.forEach(c => traverse(c, nextStyle));
            }
        };
        traverse(node, { isBold: false, isItalic: false, isSup: false, isSub: false });
        return runs;
    }

    const createHeading = (text: string, level: number): Paragraph => {
        let size = getHalfPtSize(styleConfig.baseSize);
        let align = mapAlignment('left');
        let headingLevel: any = HeadingLevel.HEADING_1;
        let indent = undefined;
        let bold = true;
        let italics = false;
        let beforeTwips = 240; 
        let afterTwips = 240;
        let fontName = headingFont;

        if (level === 1) {
            size = getHalfPtSize(styleConfig.h1Size); align = mapAlignment(styleConfig.h1Align); headingLevel = HeadingLevel.HEADING_1; beforeTwips = getSpacingTwips("1行", getPtSize(styleConfig.h1Size)); afterTwips = getSpacingTwips("1行", getPtSize(styleConfig.h1Size)); indent = getIndentConfig(styleConfig.h1Indent, getPtSize(styleConfig.h1Size)); bold = styleConfig.h1Bold; italics = styleConfig.h1Italic; fontName = h1Font;
        } else if (level === 2) {
            size = getHalfPtSize(styleConfig.h2Size); align = mapAlignment(styleConfig.h2Align); headingLevel = HeadingLevel.HEADING_2; beforeTwips = getSpacingTwips("0.8行", getPtSize(styleConfig.h2Size)); afterTwips = getSpacingTwips("0.5行", getPtSize(styleConfig.h2Size)); indent = getIndentConfig(styleConfig.h2Indent, getPtSize(styleConfig.h2Size)); bold = styleConfig.h2Bold; italics = styleConfig.h2Italic; fontName = h2Font;
        } else if (level === 3) {
            size = getHalfPtSize(styleConfig.h3Size); headingLevel = HeadingLevel.HEADING_3; beforeTwips = 200; afterTwips = 100; indent = getIndentConfig(styleConfig.h3Indent, getPtSize(styleConfig.h3Size)); bold = styleConfig.h3Bold; italics = styleConfig.h3Italic; fontName = h3Font;
        } else {
             size = getHalfPtSize(styleConfig.h4Size); headingLevel = level === 4 ? HeadingLevel.HEADING_4 : level === 5 ? HeadingLevel.HEADING_5 : HeadingLevel.HEADING_6; beforeTwips = 150; afterTwips = 80; indent = getIndentConfig(styleConfig.h4Indent, getPtSize(styleConfig.h4Size)); bold = styleConfig.h4Bold; italics = styleConfig.h4Italic; fontName = h4Font;
        }
        return new Paragraph({ heading: headingLevel, alignment: align, spacing: { before: beforeTwips, after: afterTwips }, indent: indent, children: [ new TextRun({ text: text, font: makeFont(fontName), color: primaryColor, bold: bold, italics: italics, size: size }) ] });
    };

    interface TableContext { inTable: boolean; inHeader: boolean; }
    const createBodyParagraph = (contentNodes: Node[], context: TableContext): Paragraph => {
        let font = makeFont(bodyFont);
        let size = getHalfPtSize(styleConfig.baseSize);
        let bold = false;
        if (context.inTable) { font = makeFont(tableFont); size = getHalfPtSize(styleConfig.tableSize); if (context.inHeader) bold = true; }
        const tempContainer = document.createElement('div');
        contentNodes.forEach(n => tempContainer.appendChild(n.cloneNode(true)));
        const runs = getRichTextRuns(tempContainer, font, size, "000000");
        return new Paragraph({ alignment: mapAlignment(styleConfig.bodyAlign), spacing: context.inTable ? { before: 50, after: 50 } : { before: spacingBeforeBody, after: spacingAfterBody, line: lineValue, lineRule: lineRule }, indent: context.inTable ? { firstLine: 0 } : bodyIndent, children: runs });
    };
    
    const processNodes = (nodeList: NodeList, listContext?: { type: 'ul' | 'ol' }, tableContext: TableContext = { inTable: false, inHeader: false }): (Paragraph | Table)[] => {
        const elements: (Paragraph | Table)[] = [];
        let olCounter = 1;
        let inlineBuffer: Node[] = [];
        const flushInlineBuffer = () => {
            if (inlineBuffer.length > 0) {
                const hasContent = inlineBuffer.some(n => {
                    if (n.nodeType === Node.ELEMENT_NODE) return true;
                    if (n.nodeType === Node.TEXT_NODE) return n.textContent && n.textContent.trim().length > 0;
                    return false;
                });
                if (hasContent) {
                    let paragraph = createBodyParagraph(inlineBuffer, tableContext);
                    if (listContext) {
                        if (listContext.type === 'ol') {
                            const first = inlineBuffer[0];
                            if (first.nodeType === Node.TEXT_NODE && first.textContent && !/^(\d)/.test(first.textContent.trim())) {
                                first.textContent = `${olCounter}. ${first.textContent}`; olCounter++;
                            }
                        } else {
                             const first = inlineBuffer[0];
                             if (first.nodeType === Node.TEXT_NODE && first.textContent) { first.textContent = `• ${first.textContent}`; }
                        }
                        paragraph = createBodyParagraph(inlineBuffer, tableContext);
                    }
                    elements.push(paragraph);
                }
                inlineBuffer = [];
            }
        };

        nodeList.forEach((node) => {
            if (isInlineNode(node)) { inlineBuffer.push(node); return; }
            flushInlineBuffer();
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            const el = node as HTMLElement;
            const tagName = el.tagName.toUpperCase();
            const text = el.innerText || "";
            const className = el.className || "";

            if (tagName === 'TABLE') { 
                const rowsArr: TableRow[] = [];
                const trs = Array.from(el.querySelectorAll('tr'));
                const isNoBorder = el.classList.contains('no-border') || el.style.border === 'none';
                const borderConfig = isNoBorder ? { style: BorderStyle.NONE, size: 0, color: "auto" } : { style: BorderStyle.SINGLE, size: 1, color: "auto" };
                const margins = isNoBorder ? { top: 20, bottom: 20, left: 0, right: 0 } : { top: 100, bottom: 100, left: 100, right: 100 };
                
                trs.forEach(tr => {
                    const cells: TableCell[] = [];
                    tr.querySelectorAll('td, th').forEach(td => {
                        const cellChildren = processNodes(td.childNodes, undefined, { inTable: true, inHeader: td.tagName === 'TH' }) as (Paragraph | Table)[];
                        if (cellChildren.length === 0) cellChildren.push(createBodyParagraph([], { inTable: true, inHeader: td.tagName === 'TH' }));
                        const rowspan = parseInt(td.getAttribute('rowspan') || '1');
                        const colspan = parseInt(td.getAttribute('colspan') || '1');
                        cells.push(new TableCell({ children: cellChildren, columnSpan: colspan, rowSpan: rowspan, borders: { top: borderConfig, bottom: borderConfig, left: borderConfig, right: borderConfig }, margins: margins }));
                    });
                    rowsArr.push(new TableRow({ children: cells }));
                });
                elements.push(new Table({ rows: rowsArr, width: { size: 100, type: WidthType.PERCENTAGE }, borders: isNoBorder ? { top: borderConfig, bottom: borderConfig, left: borderConfig, right: borderConfig, insideHorizontal: borderConfig, insideVertical: borderConfig } : undefined }));
                return;
            }
            if (tagName === 'HR') return;

            if (text.includes("image-placeholder") || (text.startsWith("图") && text.length < 50 && !tagName.startsWith('H'))) {
                elements.push(new Paragraph({ alignment: mapAlignment(styleConfig.figureAlign), spacing: { before: 240, after: 240 }, children: [ new TextRun({ text: text, font: makeFont(figureFont), size: getHalfPtSize(styleConfig.figureSize), color: "000000" }) ] }));
                return;
            }
            if (className.includes('doc-title')) { elements.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { before: 240, after: 120 }, children: [ new TextRun({ text: text, font: makeFont(headingFont), color: primaryColor, bold: true, size: 44 }) ] })); return; }
            if (className.includes('doc-title-en')) { elements.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 240 }, children: [ new TextRun({ text: text, font: makeFont(englishTitleFont), color: primaryColor, bold: true, size: getHalfPtSize(styleConfig.englishTitleSize || '14pt') }) ] })); return; }
            if (className.includes('author-info')) { elements.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 100 }, children: [new TextRun({ text: text, font: makeFont(authorFont), size: getHalfPtSize(styleConfig.authorSize || '16pt'), color: "000000" })] })); return; }
            if (className.includes('affiliation')) { elements.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 50, after: 200 }, children: [new TextRun({ text: text, font: makeFont(affiliationFont), size: getHalfPtSize(styleConfig.affiliationSize || '9pt'), color: "000000" })] })); return; }
            if (className.includes('abstract-cn') || className.includes('abstract-en')) { elements.push(...processNodes(el.childNodes, undefined, tableContext)); return; }
            if (className.includes('table-caption') || tagName === 'CAPTION' || (tagName === 'P' && text.startsWith('表') && text.length < 40 && !tableContext.inTable)) { elements.push(new Paragraph({ alignment: mapAlignment(styleConfig.tableCaptionAlign), spacing: { before: 240, after: 120 }, keepNext: true, children: [ new TextRun({ text: text, font: makeFont(tableCaptionFont), size: getHalfPtSize(styleConfig.tableCaptionSize), bold: true, color: "000000" }) ] })); return; }

            if (tagName === 'H1') elements.push(createHeading(text, 1));
            else if (tagName === 'H2') elements.push(createHeading(text, 2));
            else if (tagName === 'H3') elements.push(createHeading(text, 3));
            else if (tagName === 'H4') elements.push(createHeading(text, 4));
            else if (tagName === 'H5') elements.push(createHeading(text, 5));
            else if (tagName === 'H6') elements.push(createHeading(text, 6));
            else if (tagName === 'P' || tagName === 'DIV' || tagName === 'BLOCKQUOTE') elements.push(...processNodes(el.childNodes, listContext, tableContext));
            else if (tagName === 'UL') elements.push(...processNodes(el.childNodes, { type: 'ul' }, tableContext));
            else if (tagName === 'OL') elements.push(...processNodes(el.childNodes, { type: 'ol' }, tableContext));
            else if (tagName === 'LI') elements.push(...processNodes(el.childNodes, listContext, tableContext));
            else if (['SECTION', 'ARTICLE', 'MAIN', 'TD', 'TH'].includes(tagName)) elements.push(...processNodes(el.childNodes, listContext, tableContext));
        });
        flushInlineBuffer();
        return elements;
    };

    const createFooter = (): Footer => new Footer({ children: [ new Paragraph({ alignment: AlignmentType.CENTER, children: [ new TextRun({ children: ["— ", PageNumber.CURRENT, " —"], font: makeFont(bodyFont), size: 21 }) ] }) ] });

    const allElements = processNodes(xmlDoc.body.childNodes);
    const isJournalLayout = styleConfig.columns && styleConfig.columns > 1;
    let sections = [];
    if (isJournalLayout) {
        const headerNodes: Node[] = []; const bodyNodes: Node[] = []; let inBody = false;
        xmlDoc.body.childNodes.forEach(node => {
            if (inBody) { bodyNodes.push(node); return; }
            if (node.nodeType === Node.ELEMENT_NODE) {
                const el = node as HTMLElement;
                if (el.tagName === 'H1' && !el.className.includes('doc-title')) { inBody = true; bodyNodes.push(node); return; }
            }
            headerNodes.push(node);
        });
        sections = [
            { properties: { column: { count: 1 }, type: SectionType.CONTINUOUS }, children: processNodes(headerNodes as unknown as NodeList), footers: { default: createFooter() } },
            { properties: { column: { count: styleConfig.columns, space: 425 }, type: SectionType.CONTINUOUS }, children: processNodes(bodyNodes as unknown as NodeList), footers: { default: createFooter() } }
        ];
    } else {
        sections = [{ properties: {}, children: allElements, footers: { default: createFooter() } }];
    }

    const doc = new Document({ sections: sections });
    return await Packer.toBlob(doc);
};
