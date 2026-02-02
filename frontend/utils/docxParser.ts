import JSZip from 'jszip';

// Mapping of Word OMML operators to LaTeX
const CHR_MAP: Record<string, string> = {
    '∑': '\\sum',
    '∫': '\\int',
    '∬': '\\iint',
    '∭': '\\iiint',
    '∮': '\\oint',
    '∏': '\\prod',
    '∐': '\\coprod',
    '⋃': '\\bigcup',
    '⋂': '\\bigcap',
    '⋁': '\\bigvee',
    '⋀': '\\bigwedge',
};

// Helper to safely get child by tag name (ignoring namespace prefix)
const getChild = (el: Element, tagName: string): Element | undefined => {
    for (let i = 0; i < el.childNodes.length; i++) {
        const node = el.childNodes[i] as Element;
        if (node.nodeType === 1) {
            const nodeName = node.tagName.includes(':') ? node.tagName.split(':')[1] : node.tagName;
            if (nodeName === tagName) return node;
        }
    }
    return undefined;
};

// Helper to get all children by tag name
const getChildren = (el: Element, tagName: string): Element[] => {
    const res: Element[] = [];
    for (let i = 0; i < el.childNodes.length; i++) {
        const node = el.childNodes[i] as Element;
        if (node.nodeType === 1) {
             const nodeName = node.tagName.includes(':') ? node.tagName.split(':')[1] : node.tagName;
             if (nodeName === tagName) res.push(node);
        }
    }
    return res;
}

// Robust OMML (Office Math Markup Language) to LaTeX converter
const parseOMML = (node: Element): string => {
    let result = "";
    
    // Iterate child nodes
    for (let i = 0; i < node.childNodes.length; i++) {
        const child = node.childNodes[i] as Element;
        if (child.nodeType !== 1) continue; // Skip non-elements
        
        const tagName = child.tagName.includes(':') ? child.tagName.split(':')[1] : child.tagName;

        // --- Basic Text & Runs ---
        if (tagName === 't') {
            result += child.textContent;
        }
        else if (tagName === 'r') {
             // Just recurse for text content inside a run
             result += parseOMML(child);
        }

        // --- Fractions: \frac{num}{den} ---
        else if (tagName === 'f') {
            const num = getChild(child, 'num');
            const den = getChild(child, 'den');
            result += `\\frac{${num ? parseOMML(num) : ''}}{${den ? parseOMML(den) : ''}}`;
        }

        // --- Scripts (Superscript, Subscript) ---
        else if (tagName === 'sSup') {
            const e = getChild(child, 'e');
            const sup = getChild(child, 'sup');
            result += `{${e ? parseOMML(e) : ''}}^{${sup ? parseOMML(sup) : ''}}`;
        }
        else if (tagName === 'sSub') {
            const e = getChild(child, 'e');
            const sub = getChild(child, 'sub');
            result += `{${e ? parseOMML(e) : ''}}_{${sub ? parseOMML(sub) : ''}}`;
        }
        else if (tagName === 'sSubSup') {
            const e = getChild(child, 'e');
            const sub = getChild(child, 'sub');
            const sup = getChild(child, 'sup');
            result += `{${e ? parseOMML(e) : ''}}_{${sub ? parseOMML(sub) : ''}}^{${sup ? parseOMML(sup) : ''}}`;
        }

        // --- Radicals (Square root / N-th root) ---
        else if (tagName === 'rad') {
            const deg = getChild(child, 'deg');
            const e = getChild(child, 'e');
            // If deg exists and has text, it's an nth root
            const degText = deg ? parseOMML(deg) : '';
            if (degText) {
                 result += `\\sqrt[${degText}]{${e ? parseOMML(e) : ''}}`;
            } else {
                 result += `\\sqrt{${e ? parseOMML(e) : ''}}`;
            }
        }

        // --- N-ary operators (Sum, Integral) ---
        else if (tagName === 'nary') {
            const naryPr = getChild(child, 'naryPr');
            const chrNode = naryPr ? getChild(naryPr, 'chr') : null;
            let op = "\\int"; // Default fallback
            if (chrNode) {
                const val = chrNode.getAttribute('m:val') || chrNode.getAttribute('val');
                if (val && CHR_MAP[val]) op = CHR_MAP[val];
                else if (val) op = val;
            }
            
            const sub = getChild(child, 'sub');
            const sup = getChild(child, 'sup');
            const e = getChild(child, 'e');
            
            result += `${op}_{${sub ? parseOMML(sub) : ''}}^{${sup ? parseOMML(sup) : ''}}{${e ? parseOMML(e) : ''}}`;
        }

        // --- Delimiters (Parentheses, Brackets) ---
        else if (tagName === 'd') {
            const dPr = getChild(child, 'dPr');
            let begChr = '(';
            let endChr = ')';
            
            if (dPr) {
                const beg = getChild(dPr, 'begChr');
                const valBeg = beg ? (beg.getAttribute('m:val') || beg.getAttribute('val')) : null;
                if (valBeg) begChr = valBeg;

                const end = getChild(dPr, 'endChr');
                const valEnd = end ? (end.getAttribute('m:val') || end.getAttribute('val')) : null;
                if (valEnd) endChr = valEnd;
            }
            
            if (begChr === '{') begChr = '\\{';
            if (endChr === '}') endChr = '\\}';

            const eList = getChildren(child, 'e');
            const content = eList.map(node => parseOMML(node)).join(', ');
            
            result += `\\left${begChr} ${content} \\right${endChr}`;
        }
        
        // --- Functions (sin, cos, lim) ---
        else if (tagName === 'func') {
            const fname = getChild(child, 'fname');
            const e = getChild(child, 'e');
            let funcName = fname ? parseOMML(fname).trim() : '';
            
            // Normalize generic text function names to LaTeX commands if applicable
            if (['sin','cos','tan','cot','sec','csc','log','ln','lim','min','max'].includes(funcName)) {
                funcName = '\\' + funcName;
            }
            result += `${funcName} {${e ? parseOMML(e) : ''}}`;
        }

        // --- Accents/Bars ---
        else if (tagName === 'bar') {
            const e = getChild(child, 'e');
            result += `\\overline{${e ? parseOMML(e) : ''}}`;
        }
        else if (tagName === 'acc') {
             const accPr = getChild(child, 'accPr');
             const chr = accPr ? getChild(accPr, 'chr') : null;
             const val = chr ? (chr.getAttribute('m:val') || chr.getAttribute('val')) : null;
             const e = getChild(child, 'e');
             
             let cmd = "";
             if (val === '̇') cmd = "\\dot";
             else if (val === '̈') cmd = "\\ddot";
             else if (val === '̂') cmd = "\\hat";
             else if (val === '̃') cmd = "\\tilde";
             else if (val === '⃑') cmd = "\\vec";
             else if (val === '̅') cmd = "\\overline";
             
             if (cmd) result += `${cmd}{${e ? parseOMML(e) : ''}}`;
             else if (e) result += parseOMML(e); 
        }
        
        // --- Generic container (e) or other wrappers ---
        else {
             result += parseOMML(child);
        }
    }
    return result;
};

// Main extraction function
export const extractRawTextWithFormulas = async (arrayBuffer: ArrayBuffer): Promise<string> => {
    try {
        const zip = await JSZip.loadAsync(arrayBuffer);
        const docXml = await zip.file("word/document.xml")?.async("string");
        
        if (!docXml) {
            console.warn("No word/document.xml found in docx.");
            return ""; 
        }

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(docXml, "application/xml");
        
        const parserError = xmlDoc.getElementsByTagName("parsererror");
        if (parserError.length > 0) {
            console.error("XML Parsing Error", parserError[0]);
            return "";
        }

        let extractedText = "";

        const traverse = (node: Element) => {
            const tagName = node.tagName.includes(':') ? node.tagName.split(':')[1] : node.tagName;

            // Paragraphs imply newlines
            if (tagName === 'p') { 
                Array.from(node.childNodes).forEach(child => {
                    if (child.nodeType === 1) traverse(child as Element);
                });
                extractedText += "\n";
            }
            // Math Blocks (OMML)
            else if (tagName === 'oMath' || tagName === 'oMathPara') { 
                const latex = parseOMML(node);
                if (latex && latex.trim()) {
                    extractedText += ` $$ ${latex} $$ `;
                }
            }
            // Text Nodes
            else if (tagName === 't') { 
                 extractedText += node.textContent;
            }
            // Runs / Generic Containers
            else {
                 Array.from(node.childNodes).forEach(child => {
                     if (child.nodeType === 1) traverse(child as Element);
                 });
            }
        };

        if (xmlDoc.documentElement) {
            traverse(xmlDoc.documentElement);
        }
        
        return extractedText.trim();

    } catch (e) {
        console.error("Failed to parse docx XML:", e);
        return "";
    }
};