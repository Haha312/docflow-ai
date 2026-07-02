
import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, LineRuleType, Table, TableRow, TableCell, BorderStyle, WidthType, SectionType, Footer, PageNumber, Math as DocxMath, MathRun, MathSuperScript, MathSubScript, MathFraction, MathRadical, ImageRun, TableOfContents, PageBreak, NumberFormat, XmlComponent, PageOrientation, convertMillimetersToTwip } from "docx";
import { StyleConfig, Alignment } from "../types";
import i18n from '../i18n';
import JSZip from 'jszip';

// --- Custom OMML Elements ---
class GenericXmlComponent extends XmlComponent {
    constructor(rootKey: string) {
        super(rootKey);
    }
    public addRawAttr(val: string) {
        // @ts-ignore: Access protected root
        this.root.push({ _attr: { "m:val": val } });
        return this;
    }
}

class CustomMathDelimiter extends XmlComponent {
    constructor(innerChildren: any[], leftChar = "(", rightChar = ")") {
        super("m:d");
        const dPr = new GenericXmlComponent("m:dPr");
        if (leftChar) dPr.addChildElement(new GenericXmlComponent("m:begChr").addRawAttr(leftChar));
        else dPr.addChildElement(new GenericXmlComponent("m:begChr").addRawAttr(""));
        if (rightChar) dPr.addChildElement(new GenericXmlComponent("m:endChr").addRawAttr(rightChar));
        else dPr.addChildElement(new GenericXmlComponent("m:endChr").addRawAttr(""));
        
        dPr.addChildElement(new GenericXmlComponent("m:grow").addRawAttr("1"));
        this.addChildElement(dPr);

        const eOuter = new GenericXmlComponent("m:e");
        innerChildren.forEach(c => eOuter.addChildElement(c));
        this.addChildElement(eOuter);
    }
}

class CustomMathEqArr extends XmlComponent {
    constructor(rowsConfig: any[][]) {
        super("m:eqArr");
        rowsConfig.forEach(rowChildren => {
            const eRow = new GenericXmlComponent("m:e");
            rowChildren.forEach(child => eRow.addChildElement(child));
            this.addChildElement(eRow);
        });
    }
}

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

const hasElementClass = (el: HTMLElement, className: string): boolean =>
    Array.from(el.classList || []).some((x) => x.toLowerCase() === className.toLowerCase());

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
            firstLineChars: Math.round(val * 100),
            left: 0,
            right: 0
        };
    }

    if (ptMatch) {
        const val = parseFloat(ptMatch[1]);
        return { firstLine: Math.round(val * 20), left: 0, right: 0 };
    }

    if (indentStr.includes(i18n.t('generator.chars', '字符')) || indentStr.includes('chars') || indentStr.includes('ch')) {
        const val = parseFloat(indentStr) || 2;
        return {
            firstLine: Math.round(val * fontSizePt * 20),
            firstLineChars: Math.round(val * 100),
            left: 0,
            right: 0
        };
    }

    return { firstLine: 480, firstLineChars: 200, left: 0, right: 0 };
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

const normalizeImageDimensions = (dimensions: { width: number; height: number } | null): { width: number; height: number } | null => {
    if (!dimensions) return null;
    const { width, height } = dimensions;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
    if (width > 12000 || height > 12000) return null;
    const ratio = width / height;
    if (ratio < 0.05 || ratio > 20) return null;
    return { width: Math.round(width), height: Math.round(height) };
};

// Get image dimensions from binary data
const getImageDimensions = (data: Uint8Array, type: 'png' | 'jpeg' | 'gif' | 'bmp'): { width: number; height: number } | null => {
    try {
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

        if (type === 'png') {
            // PNG: Width at 16, Height at 20 (Big Endian)
            if (data.length < 24) return null;
            const width = view.getUint32(16, false);
            const height = view.getUint32(20, false);
            return normalizeImageDimensions({ width, height });
        }

        if (type === 'gif') {
            // GIF: Width at 6, Height at 8 (Little Endian)
            if (data.length < 10) return null;
            const width = view.getUint16(6, true);
            const height = view.getUint16(8, true);
            return normalizeImageDimensions({ width, height });
        }

        if (type === 'bmp') {
            // BMP: Width at 18, Height at 22 (Little Endian)
            if (data.length < 26) return null;
            const width = view.getInt32(18, true);
            const height = view.getInt32(22, true);
            return normalizeImageDimensions({ width: Math.abs(width), height: Math.abs(height) });
        }

        if (type === 'jpeg') {
            // JPEG: Scan for SOF markers
            if (data.length < 4 || data[0] !== 0xFF || data[1] !== 0xD8) return null;
            let i = 2;
            while (i + 3 < data.length) {
                while (i < data.length && data[i] === 0xFF) i++;
                if (i >= data.length) break;
                const marker = data[i];
                i += 1;

                if (marker === 0xD9 || marker === 0xDA) break;
                if (marker >= 0xD0 && marker <= 0xD7) continue;

                if (i + 1 >= data.length) break;
                const length = view.getUint16(i, false);
                if (length < 2 || i + length > data.length) break;

                // SOF0 (Baseline) to SOF15 (Differential) excluding DHT/JPG/DAC
                // Common SOF markers: C0, C1, C2, C3, C5, C6, C7, C9, CA, CB, CD, CE, CF
                if ((marker >= 0xC0 && marker <= 0xCF) && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
                    const height = view.getUint16(i + 3, false);
                    const width = view.getUint16(i + 5, false);
                    return normalizeImageDimensions({ width, height });
                }

                i += length;
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

                    // Use native OMML delimiter instead of fallback linear MathRuns
                    children.push(new CustomMathDelimiter(parseLatexToMathNodes(body), mapDelimiterChar(delimChar), mapDelimiterChar(endDelimChar)));
                }
            } else if (cmd === 'begin') {
                const env = getGroupContent();
                const startBody = i;
                const endTag = `\\end{${env}}`;

                const endBodyIdx = findBalancedClosing(cleanLatex, i, `\\begin{${env}}`, endTag);

                if (endBodyIdx !== -1) {
                    let body = cleanLatex.substring(startBody, endBodyIdx);
                    i = endBodyIdx + endTag.length;

                    const isArrayEnv = ['cases', 'matrix', 'pmatrix', 'bmatrix', 'vmatrix', 'array', 'aligned', 'align'].includes(env);

                    if (isArrayEnv) {
                        const rowStrings = body.split(/\\\\/g);
                        const rows = rowStrings.map(r => parseLatexToMathNodes(r));
                        const eqArr = new CustomMathEqArr(rows);

                        if (env === 'pmatrix') children.push(new CustomMathDelimiter([eqArr], "(", ")"));
                        else if (env === 'bmatrix') children.push(new CustomMathDelimiter([eqArr], "[", "]"));
                        else if (env === 'vmatrix') children.push(new CustomMathDelimiter([eqArr], "|", "|"));
                        else if (env === 'cases') children.push(new CustomMathDelimiter([eqArr], "{", ""));
                        else children.push(eqArr); // align, aligned, array, matrix
                    } else {
                        children.push(...parseLatexToMathNodes(body));
                    }
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
    const abstractCnFont = cleanFontName(styleConfig.abstractFont || styleConfig.fontFamily);
    const abstractEnFont = cleanFontName(styleConfig.englishAbstractFont || "Times New Roman");
    const abstractCnSize = getHalfPtSize(styleConfig.abstractSize || styleConfig.baseSize);
    const keywordsFont = cleanFontName(styleConfig.keywordsFont || styleConfig.abstractFont || styleConfig.fontFamily);
    const abstractEnSize = getHalfPtSize(styleConfig.englishAbstractSize || styleConfig.abstractSize || styleConfig.baseSize);

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
        const traverse = (n: Node, style: { isBold: boolean, isItalic: boolean, isSup: boolean, isSub: boolean, isUnderline: boolean }) => {
            if (n.nodeType === Node.TEXT_NODE) {
                let t = n.textContent;
                if (t) {
                    // 全面将任意多个可见或不可见空白、全角空格、\xa0 (\xA0 是 &nbsp;) 和制表符转换为一个空格
                    t = t.replace(/[\n\r\t\v\f \xA0\u3000]+/g, ' ');
                    
                    // 彻底清除“中文/全角标点”与“文字(特别是英文、数字)”之间的独立空格
                    t = t.replace(/([\u4e00-\u9fa5\u3000-\u303F\uFF00-\uFFEF])\s+(?=[^\s])/g, '$1');
                    t = t.replace(/(?<=[^\s])\s+([\u4e00-\u9fa5\u3000-\u303F\uFF00-\uFFEF])/g, '$1');
                    
                    // 彻底清除孤立数学符号及括号周围的生硬排版空格 (避免被Word两端对齐强行拉爆宽度)
                    t = t.replace(/\s*([=+\-×÷<>\(\)\[\]\{\}])\s*/g, '$1');

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
                                subScript: style.isSub,
                                underline: style.isUnderline ? { type: 'single' } : undefined
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
                        // 双栏时限制在单栏宽度，单栏时用完整可打印宽度
                        const MAX_PAGE_WIDTH = (styleConfig.columns && styleConfig.columns > 1) ? 288 : 600;

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
                if (tag === 'U') nextStyle.isUnderline = true;
                if (tag === 'SUP') nextStyle.isSup = true;
                if (tag === 'SUB') nextStyle.isSub = true;
                // <code> 内联代码：切换为等宽字体，其他样式继承
                if (tag === 'CODE') {
                    const codeFont = { ascii: 'Courier New', hAnsi: 'Courier New', eastAsia: 'Courier New', cs: 'Courier New' };
                    const codeSize = Math.round(baseSize * 0.9); // 代码字号略小一档
                    el.childNodes.forEach(c => {
                        if (c.nodeType === Node.TEXT_NODE && c.textContent) {
                            runs.push(new TextRun({ text: c.textContent, font: codeFont, size: codeSize, bold: nextStyle.isBold, italics: nextStyle.isItalic, color: '1a1a1a' }));
                        }
                    });
                    return;
                }
                el.childNodes.forEach(c => traverse(c, nextStyle));
            }
        };
        traverse(node, { isBold: false, isItalic: false, isSup: false, isSub: false, isUnderline: false });
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

        // GB/T 9704-2012 公文格式：通过标题编号风格识别（公文独有 chinese-hierarchical）
        // 不能用 lineHeight.includes('pt') 检测，否则出版物使用固定磅值行距时会误判
        const isCorporate = styleConfig.headingNumbering === 'chinese-hierarchical';
        const corporateLine28 = 560; // 28pt × 20 = 560 twips (EXACT, GB/T 9704-2012)
        // 出版物：章节式标题需要更大留白，让章节换感更明显
        const isChapterStyle = styleConfig.headingNumbering === 'chapter';
        const linesUnit = i18n.t('generator.lines', '行');
        // HTML <h1> is reserved for .doc-title and is handled before this function.
        // Any plain <h1> that reaches here is treated defensively as the first body heading.
        const semanticLevel = level === 1 ? 2 : level;
        const wordHeadingLevel =
            semanticLevel === 2 ? HeadingLevel.HEADING_1 :
                semanticLevel === 3 ? HeadingLevel.HEADING_2 :
                    semanticLevel === 4 ? HeadingLevel.HEADING_3 :
                        semanticLevel === 5 ? HeadingLevel.HEADING_4 :
                            HeadingLevel.HEADING_5;

        if (semanticLevel === 2) {
            size = getHalfPtSize(styleConfig.h2Size); align = mapAlignment(styleConfig.h2Align); headingLevel = wordHeadingLevel;
            beforeTwips = isCorporate ? corporateLine28 : isChapterStyle ? getSpacingTwips(`2${linesUnit}`, getPtSize(styleConfig.h2Size)) : getSpacingTwips(`0.8${linesUnit}`, getPtSize(styleConfig.h2Size));
            afterTwips = isCorporate ? 0 : isChapterStyle ? getSpacingTwips(`1${linesUnit}`, getPtSize(styleConfig.h2Size)) : getSpacingTwips(`0.5${linesUnit}`, getPtSize(styleConfig.h2Size));
            indent = getIndentConfig(styleConfig.h2Indent, getPtSize(styleConfig.h2Size)); bold = styleConfig.h2Bold; italics = styleConfig.h2Italic; fontName = h2Font;
        } else if (semanticLevel === 3) {
            size = getHalfPtSize(styleConfig.h3Size); headingLevel = wordHeadingLevel;
            // H3 改为相对字号的比例间距，避免在大字号下留白过小
            beforeTwips = isCorporate ? 0 : getSpacingTwips(`0.5${linesUnit}`, getPtSize(styleConfig.h3Size));
            afterTwips = isCorporate ? 0 : getSpacingTwips(`0.3${linesUnit}`, getPtSize(styleConfig.h3Size));
            indent = getIndentConfig(styleConfig.h3Indent, getPtSize(styleConfig.h3Size)); bold = styleConfig.h3Bold; italics = styleConfig.h3Italic; fontName = h3Font;
        } else if (semanticLevel === 4) {
            size = getHalfPtSize(styleConfig.h4Size); headingLevel = wordHeadingLevel;
            beforeTwips = isCorporate ? 0 : getSpacingTwips(`0.4${linesUnit}`, getPtSize(styleConfig.h4Size));
            afterTwips = isCorporate ? 0 : getSpacingTwips(`0.2${linesUnit}`, getPtSize(styleConfig.h4Size));
            indent = getIndentConfig(styleConfig.h4Indent, getPtSize(styleConfig.h4Size)); bold = styleConfig.h4Bold; italics = styleConfig.h4Italic; fontName = h4Font;
        } else if (semanticLevel === 5) {
            size = getHalfPtSize(styleConfig.h5Size); headingLevel = wordHeadingLevel;
            beforeTwips = isCorporate ? 0 : getSpacingTwips(`0.3${linesUnit}`, getPtSize(styleConfig.h5Size));
            afterTwips = isCorporate ? 0 : getSpacingTwips(`0.15${linesUnit}`, getPtSize(styleConfig.h5Size));
            indent = getIndentConfig(styleConfig.h5Indent, getPtSize(styleConfig.h5Size)); bold = styleConfig.h5Bold; italics = styleConfig.h5Italic; fontName = h5Font;
        } else {
            size = getHalfPtSize(styleConfig.h6Size); headingLevel = wordHeadingLevel;
            beforeTwips = isCorporate ? 0 : getSpacingTwips(`0.2${linesUnit}`, getPtSize(styleConfig.h6Size));
            afterTwips = isCorporate ? 0 : getSpacingTwips(`0.1${linesUnit}`, getPtSize(styleConfig.h6Size));
            indent = getIndentConfig(styleConfig.h6Indent, getPtSize(styleConfig.h6Size)); bold = styleConfig.h6Bold; italics = styleConfig.h6Italic; fontName = h6Font;
        }
        // 期刊等:若为该级标题配置了固定 pt 段前/段后(如 PST: H1段前12pt、章段前后6pt、三/四级0),
        // 覆盖上面按"行比例"算出的默认值(缺省字段则保持原行为,不影响其他预设)。
        const ptToTwips = (v?: string): number | undefined => {
            const m = (v || '').match(/([\d.]+)\s*pt/i);
            return m ? Math.round(parseFloat(m[1]) * 20) : undefined;
        };
        const ovBefore = ptToTwips(semanticLevel === 2 ? styleConfig.h2SpacingBefore : semanticLevel === 3 ? styleConfig.h3SpacingBefore : semanticLevel === 4 ? styleConfig.h4SpacingBefore : undefined);
        const ovAfter = ptToTwips(semanticLevel === 2 ? styleConfig.h2SpacingAfter : semanticLevel === 3 ? styleConfig.h3SpacingAfter : semanticLevel === 4 ? styleConfig.h4SpacingAfter : undefined);
        if (ovBefore !== undefined) beforeTwips = ovBefore;
        if (ovAfter !== undefined) afterTwips = ovAfter;
        // For CORPORATE, apply fixed 28pt line height to headings too
        const headingLine = isCorporate ? { line: corporateLine28, lineRule: LineRuleType.EXACT } : {};
        return new Paragraph({ heading: headingLevel, alignment: align, spacing: { before: beforeTwips, after: afterTwips, ...headingLine }, indent: indent, children: [new TextRun({ text: text, font: makeFont(fontName), color: primaryColor, bold: bold, italics: italics, size: size })] });
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
                    const firstNode = inlineBuffer[0];
                    if (firstNode && firstNode.nodeType === Node.TEXT_NODE && firstNode.textContent) {
                        firstNode.textContent = firstNode.textContent.replace(/^\s+/, '');
                    }

                    let paragraph = createBodyParagraph(inlineBuffer, tableContext, blockAlign);
                    if (listContext) {
                        const listFontSizePt = getPtSize(styleConfig.baseSize);
                        // hanging indent：bullet/数字占 1 字符宽，正文从第 2 字符开始
                        const hangingTwips = Math.round(listFontSizePt * 20); // 1 字符 ≈ 1em = 1×字号
                        const leftTwips = hangingTwips * 2; // 整体缩进 2 字符，首行回退 1 字符
                        if (listContext.type === 'ol') {
                            const first = inlineBuffer[0];
                            if (first.nodeType === Node.TEXT_NODE && first.textContent && !/^(\d+|[a-zA-Z])[\.\u3001]/.test(first.textContent.trim())) {
                                first.textContent = `${listContext.counter?.value || 1}. ${first.textContent.trimStart()}`;
                            }
                            if (listContext.counter) listContext.counter.value++;
                        } else {
                            const first = inlineBuffer[0];
                            if (first.nodeType === Node.TEXT_NODE && first.textContent) { first.textContent = `• ${first.textContent.trimStart()}`; }
                        }
                        // 重新生成带 hanging indent 的段落
                        const tempContainer2 = document.createElement('div');
                        inlineBuffer.forEach(n => tempContainer2.appendChild(n.cloneNode(true)));
                        const listFont = makeFont(bodyFont);
                        const listSize = getHalfPtSize(styleConfig.baseSize);
                        const listRuns = getRichTextRuns(tempContainer2, listFont, listSize, '000000');
                        paragraph = new Paragraph({
                            alignment: mapAlignment(styleConfig.bodyAlign),
                            spacing: { before: 0, after: Math.round(getSpacingTwips(styleConfig.spacingAfter, listFontSizePt) * 0.5), line: lineValue, lineRule: lineRule },
                            indent: { left: leftTwips, hanging: hangingTwips },
                            children: listRuns
                        });
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
            const text = (el.textContent || (el as any).innerText || "").trim();
            const className = el.className || "";

            let currentAlign = blockAlign;
            if (el.style && el.style.textAlign) {
                currentAlign = el.style.textAlign;
            } else if (el.getAttribute('align')) {
                currentAlign = el.getAttribute('align') || undefined;
            }

            // <pre> 代码块：等宽字体 + 浅灰背景 + 保留换行（每行一个 Paragraph）
            if (tagName === 'PRE') {
                const codeFont = { ascii: 'Courier New', hAnsi: 'Courier New', eastAsia: 'Courier New', cs: 'Courier New' };
                const codeSizeHp = Math.round(getHalfPtSize(styleConfig.baseSize) * 0.9); // 略小一档
                const rawText = el.innerText || el.textContent || '';
                // 去掉首尾空行，按换行分割
                const lines = rawText.replace(/^\n/, '').replace(/\n$/, '').split('\n');
                lines.forEach((line, idx) => {
                    elements.push(new Paragraph({
                        spacing: { before: idx === 0 ? 200 : 0, after: idx === lines.length - 1 ? 200 : 0 },
                        indent: { left: 240, right: 240 }, // 左右留出缩进模拟内边距
                        shading: { fill: 'F3F4F6', color: 'auto' } as any,
                        children: [new TextRun({ text: line || ' ', font: codeFont, size: codeSizeHp, color: '1f2937' })]
                    }));
                });
                return;
            }

            if (tagName === 'TABLE') {
                const rowsArr: TableRow[] = [];
                const trs = Array.from(el.querySelectorAll('tr'));
                const isNoBorder = el.classList.contains('no-border') || el.style.border === 'none';
                // 线宽:docx 的 size 单位是 1/8 pt。期刊(PST)要求 内线0.5pt / 外框0.75pt;
                // 缺省时回退 size:1(≈0.125pt,旧行为),不影响其他预设。
                const innerSz = styleConfig.tableInnerBorderPt ? Math.max(1, Math.round(styleConfig.tableInnerBorderPt * 8)) : 1;
                const outerSz = styleConfig.tableOuterBorderPt ? Math.max(1, Math.round(styleConfig.tableOuterBorderPt * 8)) : innerSz;
                const innerBorder = isNoBorder ? { style: BorderStyle.NONE, size: 0, color: "auto" } : { style: BorderStyle.SINGLE, size: innerSz, color: "auto" };
                const outerBorder = isNoBorder ? { style: BorderStyle.NONE, size: 0, color: "auto" } : { style: BorderStyle.SINGLE, size: outerSz, color: "auto" };
                const margins = isNoBorder ? { top: 20, bottom: 20, left: 0, right: 0 } : { top: 100, bottom: 100, left: 100, right: 100 };

                trs.forEach(tr => {
                    const cells: TableCell[] = [];
                    tr.querySelectorAll('td, th').forEach(td => {
                        const cellChildren = processNodes(td.childNodes, undefined, { inTable: true, inHeader: td.tagName === 'TH' }, currentAlign) as (Paragraph | Table)[];
                        if (cellChildren.length === 0) cellChildren.push(createBodyParagraph([], { inTable: true, inHeader: td.tagName === 'TH' }));
                        const rowspan = parseInt(td.getAttribute('rowspan') || '1');
                        const colspan = parseInt(td.getAttribute('colspan') || '1');
                        // 单元格边框用内线宽;外框由 Table 级 top/bottom/left/right 提供
                        cells.push(new TableCell({ children: cellChildren, columnSpan: colspan, rowSpan: rowspan, borders: { top: innerBorder, bottom: innerBorder, left: innerBorder, right: innerBorder }, margins: margins }));
                    });
                    rowsArr.push(new TableRow({ children: cells }));
                });
                elements.push(new Table({ rows: rowsArr, width: { size: 100, type: WidthType.PERCENTAGE }, borders: { top: outerBorder, bottom: outerBorder, left: outerBorder, right: outerBorder, insideHorizontal: innerBorder, insideVertical: innerBorder } }));
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

                    // 双栏时图片限制在单栏宽度（约 288px），单栏时用完整可打印宽度（约 600px）
                    const MAX_PAGE_WIDTH = (styleConfig.columns && styleConfig.columns > 1) ? 288 : 600;
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
                    // 图片非 base64（AI 生成的占位图），渲染为带边框的占位段落
                    const altText = el.getAttribute('alt') || i18n.t('generator.image', '图片');
                    const boxWidth = (styleConfig.columns && styleConfig.columns > 1) ? 220 : 460;
                    elements.push(new Paragraph({
                        alignment: AlignmentType.CENTER,
                        spacing: { before: 120, after: 60 },
                        border: {
                            top: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA', space: 4 },
                            bottom: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA', space: 4 },
                            left: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA', space: 4 },
                            right: { style: BorderStyle.SINGLE, size: 4, color: 'AAAAAA', space: 4 },
                        },
                        children: [new TextRun({
                            text: `[ ${altText} ]`,
                            font: makeFont(bodyFont),
                            size: getHalfPtSize(styleConfig.baseSize),
                            color: '888888',
                            italics: true
                        })]
                    }));
                }
                return;
            }

            if (tagName === 'HR') {
                // doc-divider: render as a thick red bottom-border paragraph (公文红色横线)
                if (el.classList.contains('doc-divider')) {
                    elements.push(new Paragraph({
                        border: { bottom: { style: BorderStyle.SINGLE, size: 18, color: "CC0000", space: 4 } },
                        spacing: { before: 120, after: 120 },
                        children: []
                    }));
                }
                return;
            }

            if (className.includes('figure-caption') || text.includes("image-placeholder")) {
                elements.push(new Paragraph({ alignment: mapAlignment(styleConfig.figureAlign), spacing: { before: 240, after: 240 }, keepNext: true, children: [new TextRun({ text: text, font: makeFont(figureFont), size: getHalfPtSize(styleConfig.figureSize), bold: !!styleConfig.figureCaptionBold, color: "000000" })] }));
                return;
            }

            // ===== 封面处理 =====
            // 封面由section生成逻辑处理,这里只处理内容不添加分页
            if (className.includes('cover-page')) {
                elements.push(...processNodes(el.childNodes, undefined, tableContext, currentAlign));
                return;
            }

            // 封面内的标识行(副标题/单位/作者/日期):居中
            if (className.includes('cover-meta')) {
                elements.push(new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 140, after: 140 },
                    children: [new TextRun({ text: text, font: makeFont(styleConfig.fontFamily), size: getHalfPtSize('14pt'), color: "000000" })]
                }));
                return;
            }

            // ===== 目录处理 =====
            // 目录由section生成逻辑处理,这里跳过
            if (className.includes('toc-placeholder') || text.includes('TOC_PLACEHOLDER') || (text === i18n.t('generator.toc', '目录') && tagName === 'H1')) {
                // 跳过,不在这里生成目录,由section逻辑统一生成
                return;
            }

            if (className.includes('doc-issuer')) { elements.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: text, font: makeFont('"SimHei", sans-serif'), color: "CC0000", bold: true, size: 52 })] })); return; }
            if (className.includes('doc-ref-number')) { elements.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 80 }, children: [new TextRun({ text: text, font: makeFont(styleConfig.fontFamily), size: getHalfPtSize(styleConfig.baseSize), color: "000000" })] })); return; }
            if (className.includes('doc-classification')) { elements.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { before: 60, after: 60 }, children: [new TextRun({ text: text, font: makeFont(styleConfig.fontFamily), size: getHalfPtSize(styleConfig.baseSize), bold: true, color: "CC0000" })] })); return; }
            if (className.includes('doc-urgency')) { elements.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { before: 60, after: 60 }, children: [new TextRun({ text: text, font: makeFont(styleConfig.fontFamily), size: getHalfPtSize(styleConfig.baseSize), bold: true, color: "CC0000" })] })); return; }
            if (className.includes('doc-addressee')) { elements.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: text, font: makeFont(styleConfig.fontFamily), size: getHalfPtSize(styleConfig.baseSize), bold: true, color: "000000" })] })); return; }
            if (className.includes('doc-signature')) { elements.push(new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 480, after: 80 }, children: [new TextRun({ text: text, font: makeFont(styleConfig.fontFamily), size: getHalfPtSize(styleConfig.baseSize), bold: true, color: "000000" })] })); return; }
            if (className.includes('doc-date')) { elements.push(new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 80, after: 80 }, children: [new TextRun({ text: text, font: makeFont(styleConfig.fontFamily), size: getHalfPtSize(styleConfig.baseSize), color: "000000" })] })); return; }
            if (className.includes('doc-seal')) { elements.push(new Paragraph({ alignment: AlignmentType.RIGHT, spacing: { before: 60, after: 60 }, children: [new TextRun({ text: text, font: makeFont(styleConfig.fontFamily), size: getHalfPtSize(styleConfig.baseSize), color: "CC0000" })] })); return; }
            if (className.includes('doc-note')) { elements.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: { before: 240, after: 60 }, children: [new TextRun({ text: text, font: makeFont(styleConfig.fontFamily), size: getHalfPtSize('12pt'), color: "666666" })] })); return; }
            if (className.includes('doc-attachment')) { elements.push(...processNodes(el.childNodes, undefined, tableContext, AlignmentType.LEFT)); return; }
            if (className.includes('doc-subtitle')) { elements.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 80, line: lineValue, lineRule }, children: [new TextRun({ text, font: makeFont(styleConfig.fontFamily), size: getHalfPtSize('16pt'), bold: true, color: "000000" })] })); return; }
            if (className.includes('doc-meta')) { elements.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40, after: 40, line: lineValue, lineRule }, children: [new TextRun({ text, font: makeFont(styleConfig.fontFamily), size: getHalfPtSize('16pt'), color: "000000" })] })); return; }
            if (className.includes('meeting-issue')) { elements.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 120 }, children: [new TextRun({ text, font: makeFont(styleConfig.fontFamily), size: getHalfPtSize('16pt'), color: "000000" })] })); return; }
            if (className.includes('meeting-meta')) {
                Array.from(el.childNodes).forEach((child) => {
                    const childText = (child.textContent || '').trim();
                    if (!childText) return;
                    elements.push(new Paragraph({
                        alignment: AlignmentType.LEFT,
                        spacing: { before: 0, after: 0, line: lineValue, lineRule },
                        indent: { firstLine: 0, left: 0 },
                        children: [new TextRun({ text: childText, font: makeFont(styleConfig.fontFamily), size: getHalfPtSize(styleConfig.baseSize), color: "000000" })],
                    }));
                });
                return;
            }
            if (hasElementClass(el, 'doc-title-en')) { elements.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 0, after: 120 }, children: [new TextRun({ text: text, font: makeFont(englishTitleFont), color: primaryColor, bold: !!styleConfig.englishTitleBold, size: getHalfPtSize(styleConfig.englishTitleSize || '12pt') })] })); return; }
            if (hasElementClass(el, 'doc-title')) { elements.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: text, font: makeFont(h1Font), color: primaryColor, bold: styleConfig.h1Bold, size: getHalfPtSize(styleConfig.h1Size || '22pt') })] })); return; }
            if (hasElementClass(el, 'author-info')) { elements.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 120, after: 80 }, children: [new TextRun({ text: text, font: makeFont(authorFont), size: getHalfPtSize(styleConfig.authorSize || '14pt'), color: "000000" })] })); return; }
            if (hasElementClass(el, 'affiliation')) { elements.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 40, after: 160 }, children: [new TextRun({ text: text, font: makeFont(affiliationFont), size: getHalfPtSize(styleConfig.affiliationSize || '10.5pt'), color: "000000" })] })); return; }
            if (hasElementClass(el, 'abstract-cn') || hasElementClass(el, 'abstract-en')) {
                const isEnAbs = hasElementClass(el, 'abstract-en');
                const absFont = isEnAbs ? abstractEnFont : abstractCnFont;
                const absSz = isEnAbs ? abstractEnSize : abstractCnSize;
                // 摘要固定行距(PST: 14pt);缺省时不强制行距
                const absLineRaw = isEnAbs ? styleConfig.englishAbstractLineHeight : styleConfig.abstractLineHeight;
                const absLineM = (absLineRaw || '').match(/([\d.]+)\s*pt/i);
                const absSpacing = absLineM
                    ? { before: 0, after: 60, line: Math.round(parseFloat(absLineM[1]) * 20), lineRule: LineRuleType.EXACT }
                    : { before: 0, after: 60 };
                Array.from(el.childNodes).forEach(child => {
                    if (child.nodeType === Node.ELEMENT_NODE) {
                        const p = child as HTMLElement;
                        const runs: TextRun[] = [];
                        p.childNodes.forEach(inline => {
                            const t = inline.textContent || '';
                            if (!t) return;
                            const inlineTag = (inline as HTMLElement).tagName || '';
                            const isBold = inlineTag === 'STRONG' || inlineTag === 'B';
                            const isItalic = inlineTag === 'EM' || inlineTag === 'I';
                            runs.push(new TextRun({ text: t, font: makeFont(absFont), size: absSz, bold: isBold, italics: isItalic }));
                        });
                        if (runs.length === 0 && p.textContent) {
                            runs.push(new TextRun({ text: p.textContent, font: makeFont(absFont), size: absSz }));
                        }
                        if (runs.length > 0) {
                            elements.push(new Paragraph({ alignment: currentAlign as any, indent: { firstLine: 0 }, spacing: absSpacing, children: runs }));
                        }
                    } else if (child.nodeType === Node.TEXT_NODE && (child.textContent || '').trim()) {
                        elements.push(new Paragraph({ alignment: currentAlign as any, indent: { firstLine: 0 }, spacing: absSpacing, children: [new TextRun({ text: child.textContent || '', font: makeFont(absFont), size: absSz })] }));
                    }
                });
                return;
            }
            if (hasElementClass(el, 'keywords')) {
                const isEnglishKeywords = hasElementClass(el, 'keywords-en') || /^(KEY\s*WORDS|Keywords)\s*[:：]/i.test(text.trim());
                const kwFont = isEnglishKeywords
                    ? cleanFontName(styleConfig.englishKeywordsFont || styleConfig.keywordsFont || styleConfig.englishAbstractFont || 'Times New Roman')
                    : keywordsFont;
                const kwSize = isEnglishKeywords
                    ? getHalfPtSize(styleConfig.englishKeywordsSize || styleConfig.keywordsSize || styleConfig.abstractSize || styleConfig.baseSize)
                    : getHalfPtSize(styleConfig.keywordsSize || styleConfig.abstractSize || styleConfig.baseSize);
                const kwM = (styleConfig.keywordsLineHeight || '').match(/([\d.]+)\s*pt/i);
                const kwSpacing: any = kwM ? { before: 60, after: 120, line: Math.round(parseFloat(kwM[1]) * 20), lineRule: LineRuleType.EXACT } : { before: 60, after: 120 };
                elements.push(new Paragraph({ alignment: AlignmentType.LEFT, spacing: kwSpacing, indent: { firstLine: 0 }, children: [new TextRun({ text, font: makeFont(kwFont), size: kwSize, color: "000000" })] }));
                return;
            }
            if (className.includes('table-caption') || tagName === 'CAPTION') { elements.push(new Paragraph({ alignment: mapAlignment(styleConfig.tableCaptionAlign), spacing: { before: 240, after: 120 }, keepNext: true, children: [new TextRun({ text: text, font: makeFont(tableCaptionFont), size: getHalfPtSize(styleConfig.tableCaptionSize), bold: true, color: "000000" })] })); return; }

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
                const text = (el.textContent || (el as any).innerText || '').trim();

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

            // 检测正文开始 (第一个非封面非目录的标题 h1-h6)
            const isHeading = /^H[1-6]$/i.test(el.tagName);
            if (currentSection !== 'body' && isHeading && !className.includes('doc-title') && !className.includes('toc-placeholder')) {
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

    // ===== 期刊通栏/双栏分割辅助函数 =====
    // 策略1：<hr class="journal-split"> 精确标记（AI 按新指令生成时走此路径）
    // 策略2：<div class="journal-header"> / <div class="journal-body"> wrapper
    // 策略3（兜底）：扫描全文，找最后一个摘要/关键词元素，其后第一个正文标题即为分割点
    function splitJournalContent(nodes: Node[]): { hdr: Node[], body: Node[] } {
        // 策略1：仅接受带 journal-split class 的 HR（避免误判 AI 输出的装饰性 <hr>）
        const hrIdx = nodes.findIndex(n =>
            n.nodeType === Node.ELEMENT_NODE &&
            (n as HTMLElement).tagName === 'HR' &&
            (n as HTMLElement).className?.includes('journal-split')
        );
        if (hrIdx >= 0) {
            return { hdr: nodes.slice(0, hrIdx), body: nodes.slice(hrIdx + 1) };
        }

        // 策略2：wrapper div
        const jHdr = nodes.find(n =>
            n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).className?.includes('journal-header')
        ) as HTMLElement | undefined;
        const jBody = nodes.find(n =>
            n.nodeType === Node.ELEMENT_NODE && (n as HTMLElement).className?.includes('journal-body')
        ) as HTMLElement | undefined;
        if (jHdr && jBody) {
            return { hdr: Array.from(jHdr.childNodes), body: Array.from(jBody.childNodes) };
        }

        // 策略3：只扫前 12 个顶层节点（期刊 header 元素不超过 10 个）
        // 用 firstLine.startsWith 而非 txt.includes，避免正文中提到"摘要/关键词"导致误判
        const hdrCls = ['doc-title', 'doc-title-en', 'author-info', 'affiliation', 'abstract-cn', 'abstract-en', 'keywords'];
        const scanLimit = Math.min(nodes.length, 12);
        let lastMetaIdx = -1;
        for (let i = 0; i < scanLimit; i++) {
            const node = nodes[i];
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            const el = node as HTMLElement;
            const cls = el.className || '';
            const firstLine = (el.textContent?.trim() || '').split('\n')[0].trim();
            if (
                cls.includes('abstract') || cls.includes('keywords') ||
                /^(摘\s*要|关键词|Abstract|Keywords|KEY\s*WORDS|Key\s*words)/i.test(firstLine)
            ) { lastMetaIdx = i; }
        }
        if (lastMetaIdx >= 0) {
            for (let i = lastMetaIdx + 1; i < nodes.length; i++) {
                const node = nodes[i];
                if (node.nodeType !== Node.ELEMENT_NODE) continue;
                const el = node as HTMLElement;
                if (/^H[1-3]$/.test(el.tagName) && !hdrCls.some(c => (el.className || '').includes(c))) {
                    return { hdr: nodes.slice(0, i), body: nodes.slice(i) };
                }
            }
        }
        // 兜底：找不到分割点则全部单栏
        return { hdr: nodes, body: [] };
    }

    // ===== 页面尺寸 + 页边距 =====
    // 旧预设可能缺省 pageMargins/pageSize → 兜底 A4 + 标准论文边距,保证不破坏已有预设。
    // 统一换算成整数 twips(OOXML 最通用、各 Word/WPS 版本都精确识别),不用 "3.7cm" 字符串,
    // 以保证 GB/T 9704 等"分毫不差"的合规承诺真正落到导出文件里。
    const toMm = (v: string): number => {
        const m = (v || '').match(/([\d.]+)\s*(cm|mm|in)?/i);
        if (!m) return 25.4;
        const n = parseFloat(m[1]); const unit = (m[2] || 'mm').toLowerCase();
        return unit === 'cm' ? n * 10 : unit === 'in' ? n * 25.4 : n;
    };
    const PAGE_SIZES_MM: Record<string, { w: number; h: number }> = {
        A4: { w: 210, h: 297 }, A3: { w: 297, h: 420 }, Letter: { w: 215.9, h: 279.4 },
    };
    const _ps = PAGE_SIZES_MM[styleConfig.pageSize ?? 'A4'] ?? PAGE_SIZES_MM.A4;
    const _mg = styleConfig.pageMargins ?? { top: '2.54cm', bottom: '2.54cm', left: '3.18cm', right: '3.18cm' };
    const pageProps = {
        size: { width: convertMillimetersToTwip(_ps.w), height: convertMillimetersToTwip(_ps.h), orientation: PageOrientation.PORTRAIT },
        margin: {
            top: convertMillimetersToTwip(toMm(_mg.top)),
            bottom: convertMillimetersToTwip(toMm(_mg.bottom)),
            left: convertMillimetersToTwip(toMm(_mg.left)),
            right: convertMillimetersToTwip(toMm(_mg.right)),
            // 页眉/页脚距页边(可选;期刊如 PST 要求 页眉1.8cm/页脚0)
            ...(_mg.header != null ? { header: convertMillimetersToTwip(toMm(_mg.header)) } : {}),
            ...(_mg.footer != null ? { footer: convertMillimetersToTwip(toMm(_mg.footer)) } : {}),
        },
    };
    // 栏间距(双栏):优先用 styleConfig.columnGap,缺省 425 twips(≈0.75cm)
    const columnSpace = styleConfig.columnGap ? convertMillimetersToTwip(toMm(styleConfig.columnGap)) : 425;

    // ===== 构建多节文档 =====
    let sections = [];
    const isJournalLayout = styleConfig.columns && styleConfig.columns > 1;
    if (styleConfig.generateToc && !hasToc && !isJournalLayout) {
        hasToc = true;
    }

    if (hasCover || hasToc) {
        // 有封面或目录时,构建多节文档

        // 封面节:无页码
        if (hasCover && coverNodes.length > 0) {
            sections.push({
                properties: {
                    page: pageProps,
                    type: SectionType.NEXT_PAGE
                },
                // 顶部留白把封面标题往下压,让整页更像封面而非顶到页眉
                children: [
                    new Paragraph({ spacing: { before: 2000 }, children: [] }),
                    ...processNodes(coverNodes as unknown as NodeList)
                ],
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
                children: [new TextRun({ text: i18n.t('generator.toc_title', "目  录"), font: makeFont("SimHei"), bold: true, size: 44 })]
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
                    page: pageProps,
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
                // 期刊多栏布局：通栏（题目/作者/摘要/关键词）+ 双栏（正文）
                const { hdr: hdrNodes, body: bodyNodes2 } = splitJournalContent(Array.from(bodyNodes as unknown as Node[]));

                sections.push({
                    properties: {
                        page: pageProps,
                        type: SectionType.NEXT_PAGE,
                        column: { count: 1 },
                        pageNumberFormatType: NumberFormat.DECIMAL,
                        pageNumberStart: 1
                    },
                    children: processNodes(hdrNodes as unknown as NodeList),
                    footers: { default: createBodyFooter() }
                });
                sections.push({
                    properties: {
                        page: pageProps,
                        type: SectionType.CONTINUOUS,
                        column: { count: styleConfig.columns, space: columnSpace }
                    },
                    children: processNodes(bodyNodes2 as unknown as NodeList),
                    footers: { default: createBodyFooter() }
                });
            } else {
                sections.push({
                    properties: {
                        page: pageProps,
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
            const { hdr: hdrNodes2, body: bodyNodes3 } = splitJournalContent(Array.from(xmlDoc.body.childNodes));

            sections = [
                { properties: { page: pageProps, column: { count: 1 }, type: SectionType.CONTINUOUS }, children: processNodes(hdrNodes2 as unknown as NodeList), footers: { default: createBodyFooter() } },
                { properties: { page: pageProps, column: { count: styleConfig.columns, space: columnSpace }, type: SectionType.CONTINUOUS }, children: processNodes(bodyNodes3 as unknown as NodeList), footers: { default: createBodyFooter() } }
            ];
        } else {
            sections = [{
                properties: {
                    page: pageProps,
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
            default: {
                document: {
                    run: {
                        font: "SimSun",
                    }
                }
            },
            paragraphStyles: [
                {
                    id: "TOC1",
                    name: "TOC 1",
                    basedOn: "Normal",
                    next: "Normal",
                    quickFormat: true,
                    run: {
                        font: "SimSun",
                        bold: false,
                        color: "000000",
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
                        font: "SimSun",
                        bold: false,
                        color: "000000",
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
                        font: "SimSun",
                        bold: false,
                        color: "000000",
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

    const rawBlob = await Packer.toBlob(doc);

    // Post-process: inject w:firstLineChars so Word shows "X字符" instead of "Xcm"
    // docx 8.x only writes w:firstLine (twips), not w:firstLineChars, so Word falls back to cm display.
    const indentCharMap = new Map<number, number>();
    const trackIndent = (cfg: ReturnType<typeof getIndentConfig>) => {
        if (cfg && typeof cfg.firstLine === 'number' && cfg.firstLine > 0 && typeof (cfg as any).firstLineChars === 'number') {
            indentCharMap.set(cfg.firstLine, (cfg as any).firstLineChars);
        }
    };
    trackIndent(bodyIndent);
    // Also track heading indents in case they are set
    [styleConfig.h1Indent, styleConfig.h2Indent, styleConfig.h3Indent, styleConfig.h4Indent].forEach((ind, i) => {
        const sizes = [styleConfig.h1Size, styleConfig.h2Size, styleConfig.h3Size, styleConfig.h4Size];
        trackIndent(getIndentConfig(ind, getPtSize(sizes[i])));
    });

    if (indentCharMap.size === 0) return rawBlob;

    try {
        const zip = await JSZip.loadAsync(rawBlob);
        const docFile = zip.file('word/document.xml');
        if (!docFile) return rawBlob;
        let xml = await docFile.async('string');
        // Replace w:firstLine="NNN" with w:firstLine="NNN" w:firstLineChars="MMM"
        xml = xml.replace(/w:firstLine="(\d+)"/g, (match, n) => {
            const chars = indentCharMap.get(parseInt(n, 10));
            return chars !== undefined ? `w:firstLine="${n}" w:firstLineChars="${chars}"` : match;
        });
        zip.file('word/document.xml', xml);
        return zip.generateAsync({
            type: 'blob',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            compression: 'DEFLATE',
        }) as Promise<Blob>;
    } catch {
        return rawBlob; // 后处理失败时返回原始 blob
    }
};
