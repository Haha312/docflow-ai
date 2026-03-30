
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, LineRuleType, Table, TableRow, TableCell, BorderStyle, WidthType, SectionType, Footer, PageNumber, Math as DocxMath, MathRun, MathSuperScript, MathSubScript, MathFraction, MathRadical, ImageRun, TableOfContents, PageBreak, NumberFormat } from "docx";
import { StyleConfig, Alignment } from "../types";
import i18n from '../i18n';

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

    if (str.includes(i18n.t('generator.lines', '行'))) {
        return Math.round(val * fontSizePt * 30);
    }

    if (str.includes("pt") || str.includes(i18n.t('generator.pt', '磅'))) {
        return Math.round(val * 20);
    }

    return Math.round(val * fontSizePt * 30);
}

const getLineHeightConfig = (str: string) => {
    const s = str.toLowerCase().trim();
    const val = parseFloat(s);
    if (isNaN(val)) return { line: 240, rule: LineRuleType.AUTO };

    if (s.includes("pt") || s.includes(i18n.t('generator.pt', '磅'))) {
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

    if (indentStr.includes(i18n.t('generator.chars', '字符')) || indentStr.includes('chars') || indentStr.includes('ch')) {
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
        return ['SPAN', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'SUP', 'SUB', 'A', 'CODE'].includes(tag);
    }
    return false;
};

// --- Image Processing ---

// Convert base64 data URL to Uint8Array for docx ImageRun
const base64ToUint8Array = (base64: string): Uint8Array => {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
};

// Parse image src and return image data
const parseImageSrc = (src: string): { data: Uint8Array; type: 'png' | 'jpeg' | 'gif' | 'bmp' } | null => {
    const match = src.match(/^data:image\/(png|jpeg|jpg|gif|bmp);base64,(.+)$/i);
    if (!match) return null;

    const typeRaw = match[1].toLowerCase();
    const base64Data = match[2];
    const type = typeRaw === 'jpg' ? 'jpeg' : typeRaw as 'png' | 'jpeg' | 'gif' | 'bmp';

    try {
        const data = base64ToUint8Array(base64Data);
        return { data, type };
    } catch {
        return null;
    }
};

// Get image dimensions from binary data
const getImageDimensions = (data: Uint8Array, type: 'png' | 'jpeg' | 'gif' | 'bmp'): { width: number; height: number } | null => {
    try {
        const view = new DataView(data.buffer);

        if (type === 'png') {
            // PNG: Width at 16, Height at 20 (Big Endian)
            if (data.length < 24) return null;
            const width = view.getUint32(16, false);
            const height = view.getUint32(20, false);
            return { width, height };
        }

        if (type === 'gif') {
            // GIF: Width at 6, Height at 8 (Little Endian)
            if (data.length < 10) return null;
            const width = view.getUint16(6, true);
            const height = view.getUint16(8, true);
            return { width, height };
        }

        if (type === 'bmp') {
            // BMP: Width at 18, Height at 22 (Little Endian)
            if (data.length < 26) return null;
            const width = view.getInt32(18, true);
            const height = view.getInt32(22, true);
            return { width: Math.abs(width), height: Math.abs(height) };
        }

        if (type === 'jpeg') {
            // JPEG: Scan for SOF markers
            let i = 2;
            while (i < data.length) {
                if (data[i] !== 0xFF) break; // Not a marker
                const marker = data[i + 1];
                const length = view.getUint16(i + 2, false);

                // SOF0 (Baseline) to SOF15 (Differential) excluding DHT/JPG/DAC
                // Common SOF markers: C0, C1, C2, C3, C5, C6, C7, C9, CA, CB, CD, CE, CF
                if ((marker >= 0xC0 && marker <= 0xCF) && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
                    const height = view.getUint16(i + 5, false);
                    const width = view.getUint16(i + 7, false);
                    return { width, height };
                }

                i += 2 + length;
            }
            return null;
        }

        return null;
    } catch (e) {
        console.warn("Failed to parse image dimensions", e);
        return null;
    }
}

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
            if (i + 1 < cleanLatex.length && cleanLatex[i + 1] === '\\') {
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
                    delimChar += cleanLatex[i + 1];
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
                        endDelimChar += cleanLatex[rightDelimStart + 1];
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
            } else if (['alpha', 'beta', 'gamma', 'delta', 'theta', 'lambda', 'mu', 'pi', 'sigma', 'phi', 'omega', 'rho', 'tau', 'epsilon', 'eta', 'zeta', 'xi', 'psi', 'chi', 'nu', 'kappa'].includes(cmd)) {
                const greekMap: any = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', phi: 'φ', omega: 'ω', rho: 'ρ', tau: 'τ', epsilon: 'ε', eta: 'η', zeta: 'ζ', xi: 'ξ', psi: 'ψ', chi: 'χ', nu: 'ν', kappa: 'κ' };
                children.push(new MathRun(greekMap[cmd]));
            } else if (['Alpha', 'Beta', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Pi', 'Sigma', 'Phi', 'Omega'].includes(cmd)) {
                const greekMap: any = { Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω' };
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
            else if (cmd === 'hat') {
                const content = getGroupContent();
                // MathAccent is complex, fallback to content for now or simple run
                // To properly support accents we need new MathAccent({ ... })
                // But for stability let's just output content
                children.push(...parseLatexToMathNodes(content));
            }
            else if (['min', 'max', 'log', 'ln', 'lim', 'det', 'sin', 'cos', 'tan'].includes(cmd)) {
                children.push(new MathRun(cmd));
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

    const getRichTextRuns = (node: Node, baseFont: any, baseSize: number, color: string = "000000"): (TextRun | DocxMath | ImageRun)[] => {
        const runs: (TextRun | DocxMath | ImageRun)[] = [];
        const traverse = (n: Node, style: { isBold: boolean, isItalic: boolean, isSup: boolean, isSub: boolean }) => {
            if (n.nodeType === Node.TEXT_NODE) {
                let t = n.textContent;
                if (t) {
                    t = t.replace(/[\n\r]+/g, ' ');
                    // Match both $$...$$ (Display Math) and $...$ (Inline Math)
                    // Be careful with $ currency: strict constraint that $ cannot be followed by space or number if simple check
                    // But for now, we assume AI generated content follows LaTeX rules.
                    const parts = t.split(/(\$\$[^$]+\$\$|\$[^$]+\$)/g);
                    parts.forEach(part => {
                        const isDisplayMath = part.startsWith('$$') && part.endsWith('$$');
                        const isInlineMath = part.startsWith('$') && part.endsWith('$');

                        if (isDisplayMath || isInlineMath) {
                            const latex = part.startsWith('$$')
                                ? part.substring(2, part.length - 2)
                                : part.substring(1, part.length - 1);

                            const mathNodes = parseLatexToMathNodes(latex);
                            if (mathNodes.length > 0) runs.push(new DocxMath({ children: mathNodes }));
                            else runs.push(new TextRun({ text: part })); // Fallback if parse fails
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

                // Handle IMG tags - convert base64 images to docx ImageRun
                if (tag === 'IMG') {
                    const src = el.getAttribute('src') || '';
                    console.log('Processing IMG tag, src length:', src.length, 'starts with:', src.substring(0, 50));

                    const imageData = parseImageSrc(src);
                    if (imageData) {
                        console.log('✅ Image parsed successfully, type:', imageData.type, 'data size:', imageData.data.length);

                        // Get image dimensions from attributes or use defaults
                        // 默认为 600px (接近 A4 打印宽度), 高度按 4:3 估算
                        const attrW = el.getAttribute('width');
                        const attrH = el.getAttribute('height');
                        let width = parseInt(attrW || '600', 10);
                        let height = parseInt(attrH || '450', 10);

                        // 如果没有提供宽高，尝试从 style 中解析
                        if (!attrW && el.style.width) width = parseInt(el.style.width, 10) || width;
                        if (!attrH && el.style.height) height = parseInt(el.style.height, 10) || height;

                        // 智能缩放逻辑:
                        // 1. "不要压缩": 尽量保持原图大小
                        // 2. "两端对齐": 意味着图片应该尽可能占满宽度 (最大不超过页边距)
                        // A4 纸通常可用宽度约 600-650px (EMU换算)
                        const MAX_PAGE_WIDTH = 650;

                        let finalWidth = width;
                        let finalHeight = height;

                        // 只有当图片宽度超过页面宽度时才缩小，否则保持原样 (即使它很小，也不要强行拉大，以免模糊)
                        if (width > MAX_PAGE_WIDTH) {
                            const ratio = height / width;
                            finalWidth = MAX_PAGE_WIDTH;
                            finalHeight = Math.round(finalWidth * ratio);
                        }

                        // 如果图片太小(比如 icon)，可能也不需要处理，但用户要求不压缩，所以原样输出即可
                        // 但为了美观，如果图片本身就没有尺寸属性，我们默认给它一个较大尺寸(上面的默认值)

                        try {
                            runs.push(new ImageRun({
                                data: imageData.data,
                                transformation: {
                                    width: finalWidth,
                                    height: finalHeight
                                }
                            }));
                            console.log('✅ ImageRun created successfully, dimensions:', finalWidth, 'x', finalHeight);
                        } catch (imgError) {
                            console.error('❌ Failed to create ImageRun:', imgError);
                            runs.push(new TextRun({ text: `[${i18n.t('generator.image', '图片')}]`, font: baseFont, size: baseSize }));
                        }
                    } else {
                        // Fallback for non-base64 images
                        console.warn('⚠️ Image not in base64 format, src:', src.substring(0, 100));
                        runs.push(new TextRun({ text: `[${i18n.t('generator.image', '图片')}]`, font: baseFont, size: baseSize }));
                    }
                    return;
                }

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
            size = getHalfPtSize(styleConfig.h1Size); align = mapAlignment(styleConfig.h1Align); headingLevel = HeadingLevel.HEADING_1; beforeTwips = getSpacingTwips(`1${i18n.t('generator.lines', '行')}`, getPtSize(styleConfig.h1Size)); afterTwips = getSpacingTwips(`1${i18n.t('generator.lines', '行')}`, getPtSize(styleConfig.h1Size)); indent = getIndentConfig(styleConfig.h1Indent, getPtSize(styleConfig.h1Size)); bold = styleConfig.h1Bold; italics = styleConfig.h1Italic; fontName = h1Font;
        } else if (level === 2) {
            size = getHalfPtSize(styleConfig.h2Size); align = mapAlignment(styleConfig.h2Align); headingLevel = HeadingLevel.HEADING_2; beforeTwips = getSpacingTwips(`0.8${i18n.t('generator.lines', '行')}`, getPtSize(styleConfig.h2Size)); afterTwips = getSpacingTwips(`0.5${i18n.t('generator.lines', '行')}`, getPtSize(styleConfig.h2Size)); indent = getIndentConfig(styleConfig.h2Indent, getPtSize(styleConfig.h2Size)); bold = styleConfig.h2Bold; italics = styleConfig.h2Italic; fontName = h2Font;
        } else if (level === 3) {
            size = getHalfPtSize(styleConfig.h3Size); headingLevel = HeadingLevel.HEADING_3; beforeTwips = 200; afterTwips = 100; indent = getIndentConfig(styleConfig.h3Indent, getPtSize(styleConfig.h3Size)); bold = styleConfig.h3Bold; italics = styleConfig.h3Italic; fontName = h3Font;
        } else {
            size = getHalfPtSize(styleConfig.h4Size); headingLevel = level === 4 ? HeadingLevel.HEADING_4 : level === 5 ? HeadingLevel.HEADING_5 : HeadingLevel.HEADING_6; beforeTwips = 150; afterTwips = 80; indent = getIndentConfig(styleConfig.h4Indent, getPtSize(styleConfig.h4Size)); bold = styleConfig.h4Bold; italics = styleConfig.h4Italic; fontName = h4Font;
        }
        return new Paragraph({ heading: headingLevel, alignment: align, spacing: { before: beforeTwips, after: afterTwips }, indent: indent, children: [new TextRun({ text: text, font: makeFont(fontName), color: primaryColor, bold: bold, italics: italics, size: size })] });
    };

    interface TableContext { inTable: boolean; inHeader: boolean; }
    const createBodyParagraph = (contentNodes: Node[], context: TableContext, customAlign?: string): Paragraph => {
        let font = makeFont(bodyFont);
        let size = getHalfPtSize(styleConfig.baseSize);
        let bold = false;
        if (context.inTable) { font = makeFont(tableFont); size = getHalfPtSize(styleConfig.tableSize); if (context.inHeader) bold = true; }
        const tempContainer = document.createElement('div');
        contentNodes.forEach(n => tempContainer.appendChild(n.cloneNode(true)));
        const runs = getRichTextRuns(tempContainer, font, size, "000000");

        let alignVal = mapAlignment(styleConfig.bodyAlign);
        if (customAlign === 'center') alignVal = AlignmentType.CENTER;
        else if (customAlign === 'right') alignVal = AlignmentType.RIGHT;
        else if (customAlign === 'left') alignVal = AlignmentType.LEFT;
        else if (customAlign === 'justify') alignVal = AlignmentType.JUSTIFIED;

        return new Paragraph({
            alignment: alignVal,
            spacing: context.inTable ? { before: 50, after: 50 } : { before: spacingBeforeBody, after: spacingAfterBody, line: lineValue, lineRule: lineRule },
            indent: context.inTable ? { firstLine: 0, left: 0, hanging: 0 } : bodyIndent,
            children: runs
        });
    };

    const processNodes = (nodeList: NodeList, listContext?: { type: 'ul' | 'ol', counter?: { value: number } }, tableContext: TableContext = { inTable: false, inHeader: false }, blockAlign?: string): (Paragraph | Table)[] => {
        const elements: (Paragraph | Table)[] = [];
        let inlineBuffer: Node[] = [];
        const flushInlineBuffer = () => {
            if (inlineBuffer.length > 0) {
                const hasContent = inlineBuffer.some(n => {
                    if (n.nodeType === Node.ELEMENT_NODE) return true;
                    if (n.nodeType === Node.TEXT_NODE) return n.textContent && n.textContent.trim().length > 0;
                    return false;
                });
                if (hasContent) {
                    let paragraph = createBodyParagraph(inlineBuffer, tableContext, blockAlign);
                    if (listContext) {
                        if (listContext.type === 'ol') {
                            const first = inlineBuffer[0];
                            if (first.nodeType === Node.TEXT_NODE && first.textContent && !/^(\d+|[a-zA-Z])[\.\u3001]/.test(first.textContent.trim())) {
                                first.textContent = `${listContext.counter?.value || 1}. ${first.textContent}`; 
                            }
                            if (listContext.counter) listContext.counter.value++;
                        } else {
                            const first = inlineBuffer[0];
                            if (first.nodeType === Node.TEXT_NODE && first.textContent) { first.textContent = `• ${first.textContent}`; }
                        }
                        paragraph = createBodyParagraph(inlineBuffer, tableContext, blockAlign);
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

            let currentAlign = blockAlign;
            if (el.style && el.style.textAlign) {
                currentAlign = el.style.textAlign;
            } else if (el.getAttribute('align')) {
                currentAlign = el.getAttribute('align') || undefined;
            }

            if (tagName === 'TABLE') {
                const rowsArr: TableRow[] = [];
                const trs = Array.from(el.querySelectorAll('tr'));
                const isNoBorder = el.classList.contains('no-border') || el.style.border === 'none';
                const borderConfig = isNoBorder ? { style: BorderStyle.NONE, size: 0, color: "auto" } : { style: BorderStyle.SINGLE, size: 1, color: "auto" };
                const margins = isNoBorder ? { top: 20, bottom: 20, left: 0, right: 0 } : { top: 100, bottom: 100, left: 100, right: 100 };

                trs.forEach(tr => {
                    const cells: TableCell[] = [];
                    tr.querySelectorAll('td, th').forEach(td => {
                        const cellChildren = processNodes(td.childNodes, undefined, { inTable: true, inHeader: td.tagName === 'TH' }, currentAlign) as (Paragraph | Table)[];
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

            // ===== 图片处理 =====
            if (tagName === 'IMG') {
                const src = el.getAttribute('src') || '';
                console.log('📸 Processing standalone IMG tag in processNodes, src length:', src.length);

                const imageData = parseImageSrc(src);
                if (imageData) {
                    console.log('✅ Image parsed, creating image paragraph');

                    // Try to detect dimensions from binary data
                    const detected = getImageDimensions(imageData.data, imageData.type);

                    const attrW = el.getAttribute('width');
                    const attrH = el.getAttribute('height');

                    let width = 600; // Default fallback
                    let height = 450; // Default fallback

                    if (detected) {
                        width = detected.width;
                        height = detected.height;
                        console.log(`📏 Detected image detected dimensions: ${width}x${height}`);
                    } else {
                        // Fallback to attributes if detection fails
                        if (attrW) width = parseInt(attrW, 10);
                        if (attrH) height = parseInt(attrH, 10);
                        if (!attrW && !attrH && el.style.width) width = parseInt(el.style.width, 10) || 600;
                        // If we have width but no height (and detection failed), we assume 4:3 or keep default
                    }

                    const MAX_PAGE_WIDTH = 650; // Printable area width
                    let finalWidth = width;
                    let finalHeight = height;

                    // Scale down if too wide
                    if (width > MAX_PAGE_WIDTH) {
                        const ratio = height / width;
                        finalWidth = MAX_PAGE_WIDTH;
                        finalHeight = Math.round(finalWidth * ratio);
                    } else if (detected) {
                        // If detected and small enough, keep original size
                        // Or if undefined attributes, we might want to scale up slightly if very small?
                        // For now, respect original or max width.
                    }

                    // If we didn't detect dimensions and didn't have attributes, 
                    // we risk stretching if we force 600x450 on a non-4:3 image.
                    // But without headers, we can't know. 
                    // The detected block above covers most cases (png/jpeg/gif).

                    try {
                        const imgRun = new ImageRun({
                            data: imageData.data,
                            transformation: {
                                width: finalWidth,
                                height: finalHeight
                            }
                        });

                        elements.push(new Paragraph({
                            alignment: mapAlignment(styleConfig.figureAlign || 'center'),
                            spacing: { before: 240, after: 240 },
                            indent: { firstLine: 0, left: 0 },
                            children: [imgRun]
                        }));
                        console.log('✅ Image paragraph created successfully');
                    } catch (imgError) {
                        console.error('❌ Failed to create image:', imgError);
                        elements.push(new Paragraph({
                            alignment: AlignmentType.CENTER,
                            children: [new TextRun({ text: `[${i18n.t('generator.image', '图片')}]`, font: makeFont(bodyFont), size: getHalfPtSize(styleConfig.baseSize) })]
                        }));
                    }
                } else {
                    console.warn('⚠️ Image not in base64 format');
                    elements.push(new Paragraph({
                        alignment: AlignmentType.CENTER,
                        children: [new TextRun({ text: `[${i18n.t('generator.image', '图片')}]`, font: makeFont(bodyFont), size: getHalfPtSize(styleConfig.baseSize) })]
                    }));
                }
                return;
            }

            if (tagName === 'HR') return;

            if (text.includes("image-placeholder") || (text.startsWith(i18n.t('generator.figure', '图')) && text.length < 50 && !tagName.startsWith('H'))) {
                elements.push(new Paragraph({ alignment: mapAlignment(styleConfig.figureAlign), spacing: { before: 240, after: 240 }, children: [new TextRun({ text: text, font: makeFont(figureFont), size: getHalfPtSize(styleConfig.figureSize), color: "000000" })] }));
                return;
            }

            // ===== 封面处理 =====
            // 封面由section生成逻辑处理,这里只处理内容不添加分页
            if (className.includes('cover-page')) {
                elements.push(...processNodes(el.childNodes, undefined, tableContext, currentAlign));
                return;
            }

            // ===== 目录处理 =====
            // 目录由section生成逻辑处理,这里跳过
            if (className.includes('toc-placeholder') || text.includes('TOC_PLACEHOLDER') || (text === i18n.t('generator.toc', '目录') && tagName === 'H1')) {
                // 跳过,不在这里生成目录,由section逻辑统一生成
                return;
            }

            if (className.includes('doc-title')) { elements.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: text, font: makeFont(headingFont), color: primaryColor, bold: true, size: 44 })] })); return; }
            if (className.includes('doc-title-en')) { elements.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 240 }, children: [new TextRun({ text: text, font: makeFont(englishTitleFont), color: primaryColor, bold: true, size: getHalfPtSize(styleConfig.englishTitleSize || '14pt') })] })); return; }
            if (className.includes('author-info')) { elements.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 100 }, children: [new TextRun({ text: text, font: makeFont(authorFont), size: getHalfPtSize(styleConfig.authorSize || '16pt'), color: "000000" })] })); return; }
            if (className.includes('affiliation')) { elements.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 50, after: 200 }, children: [new TextRun({ text: text, font: makeFont(affiliationFont), size: getHalfPtSize(styleConfig.affiliationSize || '9pt'), color: "000000" })] })); return; }
            if (className.includes('abstract-cn') || className.includes('abstract-en')) { elements.push(...processNodes(el.childNodes, undefined, tableContext, currentAlign)); return; }
            if (className.includes('table-caption') || tagName === 'CAPTION' || (tagName === 'P' && text.startsWith(i18n.t('generator.table', '表')) && text.length < 40 && !tableContext.inTable)) { elements.push(new Paragraph({ alignment: mapAlignment(styleConfig.tableCaptionAlign), spacing: { before: 240, after: 120 }, keepNext: true, children: [new TextRun({ text: text, font: makeFont(tableCaptionFont), size: getHalfPtSize(styleConfig.tableCaptionSize), bold: true, color: "000000" })] })); return; }

            if (tagName === 'H1') elements.push(createHeading(text, 1));
            else if (tagName === 'H2') elements.push(createHeading(text, 2));
            else if (tagName === 'H3') elements.push(createHeading(text, 3));
            else if (tagName === 'H4') elements.push(createHeading(text, 4));
            else if (tagName === 'H5') elements.push(createHeading(text, 5));
            else if (tagName === 'H6') elements.push(createHeading(text, 6));
            else if (tagName === 'P' || tagName === 'DIV' || tagName === 'BLOCKQUOTE') elements.push(...processNodes(el.childNodes, listContext, tableContext, currentAlign));
            else if (tagName === 'UL') elements.push(...processNodes(el.childNodes, { type: 'ul' }, tableContext, currentAlign));
            else if (tagName === 'OL') elements.push(...processNodes(el.childNodes, { type: 'ol', counter: { value: 1 } }, tableContext, currentAlign));
            else if (tagName === 'LI') elements.push(...processNodes(el.childNodes, listContext, tableContext, currentAlign));
            else if (['SECTION', 'ARTICLE', 'MAIN', 'TD', 'TH'].includes(tagName)) elements.push(...processNodes(el.childNodes, listContext, tableContext, currentAlign));
        });
        flushInlineBuffer();
        return elements;
    };

    // ===== 页码配置 =====
    // 封面页脚:无页码
    const createCoverFooter = (): Footer => new Footer({
        children: [new Paragraph({ children: [] })]
    });

    // 目录页脚:罗马数字页码
    const createTocFooter = (): Footer => new Footer({
        children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ children: ["— ", PageNumber.CURRENT, " —"], font: makeFont(bodyFont), size: 21 })]
        })]
    });

    // 正文页脚:阿拉伯数字页码
    const createBodyFooter = (): Footer => new Footer({
        children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [new TextRun({ children: ["— ", PageNumber.CURRENT, " —"], font: makeFont(bodyFont), size: 21 })]
        })]
    });

    // ===== 分析文档结构,识别封面、目录、正文 =====
    const coverNodes: Node[] = [];
    const tocNodes: Node[] = [];
    const bodyNodes: Node[] = [];

    let currentSection: 'cover' | 'toc' | 'body' = 'body'; // 默认直接是正文
    let hasCover = false;
    let hasToc = false;

    xmlDoc.body.childNodes.forEach(node => {
        if (node.nodeType === Node.ELEMENT_NODE) {
            const el = node as HTMLElement;
            const className = el.className || '';
            const text = el.innerText || '';

            // 检测封面
            if (className.includes('cover-page')) {
                hasCover = true;
                currentSection = 'cover';
                coverNodes.push(node);
                return;
            }

            // 检测目录
            if (className.includes('toc-placeholder') || text.includes('TOC_PLACEHOLDER') || (text === i18n.t('generator.toc', '目录') && el.tagName === 'H1')) {
                hasToc = true;
                currentSection = 'toc';
                tocNodes.push(node);
                return;
            }

            // 检测正文开始 (第一个非封面非目录的H1)
            if (currentSection !== 'body' && el.tagName === 'H1' && !className.includes('doc-title') && !className.includes('toc-placeholder')) {
                currentSection = 'body';
            }
        }

        // 根据当前节添加到对应数组
        if (currentSection === 'cover') {
            coverNodes.push(node);
        } else if (currentSection === 'toc') {
            tocNodes.push(node);
        } else {
            bodyNodes.push(node);
        }
    });

    // ===== 构建多节文档 =====
    let sections = [];
    const isJournalLayout = styleConfig.columns && styleConfig.columns > 1;

    if (hasCover || hasToc) {
        // 有封面或目录时,构建多节文档

        // 封面节:无页码
        if (hasCover && coverNodes.length > 0) {
            sections.push({
                properties: {
                    type: SectionType.NEXT_PAGE
                },
                children: processNodes(coverNodes as unknown as NodeList),
                footers: { default: createCoverFooter() }
            });
        }

        // 目录节:罗马数字页码
        if (hasToc) {
            const tocElements: (Paragraph | Table)[] = [];
            // 添加目录标题
            tocElements.push(new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 480, after: 480 },
                children: [new TextRun({ text: i18n.t('generator.toc_title', "目  录"), font: makeFont(headingFont), bold: true, size: 44 })]
            }));
            // 添加 Word 原生目录
            tocElements.push(new TableOfContents(i18n.t('generator.toc', "目录"), {
                hyperlink: true,
                headingStyleRange: "1-3",
                stylesWithLevels: [
                    { styleName: "Heading 1", level: 1 },
                    { styleName: "Heading 2", level: 2 },
                    { styleName: "Heading 3", level: 3 },
                ]
            }));

            sections.push({
                properties: {
                    type: SectionType.NEXT_PAGE,
                    pageNumberFormatType: NumberFormat.UPPER_ROMAN,
                    pageNumberStart: 1
                },
                children: tocElements,
                footers: { default: createTocFooter() }
            });
        }

        // 正文节:阿拉伯数字页码
        if (bodyNodes.length > 0) {
            const bodyElements = processNodes(bodyNodes as unknown as NodeList);

            if (isJournalLayout) {
                // 期刊多栏布局
                const headerNodesBody: Node[] = [];
                const contentNodesBody: Node[] = [];
                let inContent = false;

                bodyNodes.forEach(node => {
                    if (inContent) { contentNodesBody.push(node); return; }
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        const el = node as HTMLElement;
                        if (el.tagName === 'H1' && !el.className.includes('doc-title')) {
                            inContent = true;
                            contentNodesBody.push(node);
                            return;
                        }
                    }
                    headerNodesBody.push(node);
                });

                sections.push({
                    properties: {
                        type: SectionType.NEXT_PAGE,
                        column: { count: 1 },
                        pageNumberFormatType: NumberFormat.DECIMAL,
                        pageNumberStart: 1
                    },
                    children: processNodes(headerNodesBody as unknown as NodeList),
                    footers: { default: createBodyFooter() }
                });
                sections.push({
                    properties: {
                        type: SectionType.CONTINUOUS,
                        column: { count: styleConfig.columns, space: 425 }
                    },
                    children: processNodes(contentNodesBody as unknown as NodeList),
                    footers: { default: createBodyFooter() }
                });
            } else {
                sections.push({
                    properties: {
                        type: SectionType.NEXT_PAGE,
                        pageNumberFormatType: NumberFormat.DECIMAL,
                        pageNumberStart: 1
                    },
                    children: bodyElements,
                    footers: { default: createBodyFooter() }
                });
            }
        }
    } else {
        // 无封面无目录,使用原有逻辑
        const allElements = processNodes(xmlDoc.body.childNodes);

        if (isJournalLayout) {
            const headerNodes: Node[] = [];
            const contentNodes: Node[] = [];
            let inBody = false;

            xmlDoc.body.childNodes.forEach(node => {
                if (inBody) { contentNodes.push(node); return; }
                if (node.nodeType === Node.ELEMENT_NODE) {
                    const el = node as HTMLElement;
                    if (el.tagName === 'H1' && !el.className.includes('doc-title')) {
                        inBody = true;
                        contentNodes.push(node);
                        return;
                    }
                }
                headerNodes.push(node);
            });

            sections = [
                { properties: { column: { count: 1 }, type: SectionType.CONTINUOUS }, children: processNodes(headerNodes as unknown as NodeList), footers: { default: createBodyFooter() } },
                { properties: { column: { count: styleConfig.columns, space: 425 }, type: SectionType.CONTINUOUS }, children: processNodes(contentNodes as unknown as NodeList), footers: { default: createBodyFooter() } }
            ];
        } else {
            sections = [{
                properties: {
                    pageNumberFormatType: NumberFormat.DECIMAL,
                    pageNumberStart: 1
                },
                children: allElements,
                footers: { default: createBodyFooter() }
            }];
        }
    }

    const doc = new Document({
        styles: {
            paragraphStyles: [
                {
                    id: "TOC1",
                    name: "TOC 1",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    run: {
                        font: {
                            ascii: "SimSun",
                            eastAsia: "SimSun",
                            hAnsi: "SimSun"
                        },
                        size: 24, // 小四 (12pt)
                    },
                    paragraph: {
                        spacing: {
                            line: 300, // 1.25 lines (240 * 1.25)
                            lineRule: LineRuleType.AUTO
                        },
                        indent: {
                            left: 0
                        }
                    }
                },
                {
                    id: "TOC2",
                    name: "TOC 2",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    run: {
                        font: {
                            ascii: "SimSun",
                            eastAsia: "SimSun",
                            hAnsi: "SimSun"
                        },
                        size: 24, // 小四
                    },
                    paragraph: {
                        spacing: {
                            line: 300,
                            lineRule: LineRuleType.AUTO
                        },
                        indent: {
                            left: 240 // 缩进
                        }
                    }
                },
                {
                    id: "TOC3",
                    name: "TOC 3",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    run: {
                        font: {
                            ascii: "SimSun",
                            eastAsia: "SimSun",
                            hAnsi: "SimSun"
                        },
                        size: 24, // 小四
                    },
                    paragraph: {
                        spacing: {
                            line: 300,
                            lineRule: LineRuleType.AUTO
                        },
                        indent: {
                            left: 480 // 缩进
                        }
                    }
                }
            ]
        },
        sections: sections
    });
    return await Packer.toBlob(doc);
};
