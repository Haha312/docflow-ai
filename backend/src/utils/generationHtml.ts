export const cleanOutput = (text: string): string => {
    let result = text.replace(/```html/g, '').replace(/```/g, '').trim();
    result = result.replace(/(<(?:p|div)[^>]*>\s*(\$[^$\n]{1,60}\$|\$\$[\s\S]{1,200}?\$\$)\s*<\/(?:p|div)>)\s*\1/g, '$1');
    return result;
};

export const normalizeText = (s: string): string => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

const stripLeadingNumbers = (s: string): string =>
    s.replace(/(\d+\.)+\s*/g, '')
     .replace(/\u7b2c[\u4e00-\u9fa5\d]+[\u7ae0\u8282\u6761\u6b3e\u90e8\u5206]\s*/g, '')
     .replace(/\s+/g, ' ').trim();

export const extractHeadingFingerprints = (html: string): Set<string> => {
    const set = new Set<string>();
    const re = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
        const text = m[1].replace(/<[^>]+>/g, '').trim();
        if (text.length >= 4) set.add(text);
    }
    return set;
};

export const calcTailHeadOverlap = (a: string, b: string, maxWindow = 2200): number => {
    const left  = stripLeadingNumbers(normalizeText(a)).slice(-maxWindow);
    const right = stripLeadingNumbers(normalizeText(b)).slice(0, maxWindow);
    const maxLen = Math.min(left.length, right.length);
    for (let len = maxLen; len >= 80; len--) {
        if (left.slice(-len) === right.slice(0, len)) return len;
    }
    return 0;
};

export const reinjectMissingPlaceholders = (chunkInput: string, chunkOutput: string): string => {
    const inputPlaceholders = [...chunkInput.matchAll(/__IMG_(\d+)__/g)].map(m => m[0]);
    if (inputPlaceholders.length === 0) return chunkOutput;

    const outputHasPlaceholder = new Set([...chunkOutput.matchAll(/__IMG_(\d+)__/g)].map(m => m[0]));
    const missing = inputPlaceholders.filter(p => !outputHasPlaceholder.has(p));
    if (missing.length === 0) return chunkOutput;

    console.log(`[IMG_REINJECT] ${missing.length} missing placeholder(s): ${missing.join(' -> ')}`);

    let missingIdx = 0;
    let result = chunkOutput.replace(/(<div\s+class="figure-caption")/gi, (match, _tag, offset) => {
        if (missingIdx >= missing.length) return match;
        const preceding = chunkOutput.slice(Math.max(0, offset - 500), offset);
        if (/__IMG_\d+__/.test(preceding)) return match;
        const placeholder = missing[missingIdx++];
        console.log(`[IMG_REINJECT] Inserting ${placeholder} before figure-caption at offset ${offset}`);
        return `${placeholder}\n${match}`;
    });

    while (missingIdx < missing.length) {
        const placeholder = missing[missingIdx++];
        console.log(`[IMG_REINJECT] Fallback: appending ${placeholder} at end of chunk`);
        result += `\n<p>${placeholder}</p>`;
    }

    return result;
};

const hasHtmlClass = (attrs: string, className: string): boolean => {
    const m = (attrs || '').match(/\bclass\s*=\s*["']([^"']*)["']/i);
    return !!m && m[1].split(/\s+/).some(x => x.toLowerCase() === className.toLowerCase());
};

const isNonBodyHeadingAttrs = (attrs: string): boolean =>
    hasHtmlClass(attrs, 'doc-title') || hasHtmlClass(attrs, 'doc-title-en') || hasHtmlClass(attrs, 'toc-placeholder');

export const extractLastHeadings = (html: string, n: number = 5): string => {
    const matches = [...html.matchAll(/<h[1-6]\b([^>]*)>([\s\S]*?)<\/h[1-6]>/gi)]
        .filter(m => !isNonBodyHeadingAttrs(m[1] || ''));
    return matches.slice(-n).map(m => m[2].replace(/<[^>]+>/g, '').trim()).join(' -> ');
};

export const extractDocumentHeadingMap = (html: string): { outline: string; levelMap: Map<string, number> } => {
    const levelMap = new Map<string, number>();
    const lines: string[] = [];
    const indent = ['', '', '  ', '    ', '      ', '        ', '          '];
    const regex = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(html)) !== null) {
        const level = parseInt(match[1]);
        if (isNonBodyHeadingAttrs(match[2] || '')) continue;
        const text = match[3].replace(/<[^>]+>/g, '').trim().slice(0, 70);
        if (!text) continue;
        levelMap.set(text.toLowerCase(), level);
        lines.push(`${indent[level] ?? '  '}H${level}: ${text}`);
    }
    return { outline: lines.join('\n'), levelMap };
};

export const detectCorporateElementClasses = (html: string): string => {
    const hasDocTitle = /class="[^"]*doc-title[^"]*"/.test(html);

    return html.replace(/<(p|div|h[1-6])\b([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, content) => {
        if (/class="[^"]*doc-/.test(attrs)) return match;

        const text = content.replace(/<[^>]+>/g, '').trim();
        if (!text || text.length > 120) return match;

        if (/[\u2605\u2606]/.test(text) || /^(?:\u7edd\u5bc6|\u673a\u5bc6|\u79d8\u5bc6)(?:[\s\u3000]*\d+\u5e74?)?$/.test(text)) {
            return `<p class="doc-classification">${content}</p>`;
        }
        if (/^(?:\u7279\u6025|\u52a0\u6025|\u7d27\u6025|\u5e73\u6025)$/.test(text)) {
            return `<p class="doc-urgency">${content}</p>`;
        }
        if (/[\u3014\u3010\[]\d{4}[\u3015\u3011\]]\d+\u53f7/.test(text) && text.length < 35) {
            return `<p class="doc-ref-number">${content}</p>`;
        }
        if (/\u6587\u4ef6$/.test(text) && text.length < 45 && !/[\u3002\uff0c\uff01\uff1f]/.test(text)) {
            return `<div class="doc-issuer">${content}</div>`;
        }
        if (/[:\uff1a]$/.test(text) && text.length < 100 && !/[\u3002\uff01\uff1f]/.test(text)) {
            return `<p class="doc-addressee">${content}</p>`;
        }
        if (tag === 'h1' && !hasDocTitle && !/class=/.test(attrs)) {
            return `<h1 class="doc-title">${content}</h1>`;
        }

        return match;
    });
};

export const reorderCorporateDocument = (html: string): string => {
    const extractByClass = (src: string, cls: string): { el: string; rest: string } => {
        const openRe = new RegExp(`<(div|p|h1|h2|h3|h4|h5|h6|section)\\b[^>]*\\bclass="[^"]*${cls}[^"]*"[^>]*>`, 'i');
        const m = openRe.exec(src);
        if (!m) return { el: '', rest: src };
        const tag = m[1].toLowerCase();
        const start = m.index;
        const afterOpen = start + m[0].length;
        let depth = 1;
        let pos = afterOpen;
        while (pos < src.length && depth > 0) {
            const nextOpen = src.indexOf(`<${tag}`, pos);
            const nextClose = src.indexOf(`</${tag}>`, pos);
            if (nextClose === -1) break;
            if (nextOpen !== -1 && nextOpen < nextClose) {
                depth++;
                pos = nextOpen + 1;
            } else {
                depth--;
                pos = nextClose + `</${tag}>`.length;
            }
        }
        const el = src.slice(start, pos);
        const rest = src.slice(0, start) + src.slice(pos);
        return { el, rest };
    };

    const extractHrDivider = (src: string): { el: string; rest: string } => {
        const re = /<hr\b[^>]*class="[^"]*doc-divider[^"]*"[^>]*\/?>/i;
        const m = re.exec(src);
        if (!m) return { el: '', rest: src };
        return { el: m[0], rest: src.slice(0, m.index) + src.slice(m.index + m[0].length) };
    };

    const slots: { cls: string; extracted: string }[] = [
        { cls: 'doc-classification', extracted: '' },
        { cls: 'doc-urgency',        extracted: '' },
        { cls: 'doc-issuer',         extracted: '' },
        { cls: '__DIVIDER__',        extracted: '' },
        { cls: 'doc-ref-number',     extracted: '' },
        { cls: 'doc-title',          extracted: '' },
        { cls: 'doc-addressee',      extracted: '' },
    ];

    let remaining = html;
    for (const slot of slots) {
        if (slot.cls === '__DIVIDER__') {
            const { el, rest } = extractHrDivider(remaining);
            slot.extracted = el;
            remaining = rest;
        } else {
            const { el, rest } = extractByClass(remaining, slot.cls);
            slot.extracted = el;
            remaining = rest;
        }
    }

    const issuerSlot = slots.find(s => s.cls === 'doc-issuer');
    const dividerSlot = slots.find(s => s.cls === '__DIVIDER__');
    if (issuerSlot?.extracted && !dividerSlot?.extracted && dividerSlot) {
        dividerSlot.extracted = '<hr class="doc-divider">';
    }

    const titleSlot = slots.find(s => s.cls === 'doc-title');
    if (!titleSlot?.extracted) return html;

    const header = slots.map(s => s.extracted).filter(Boolean).join('\n');
    return header + '\n' + remaining.trim();
};

export const ensureFigureCaptions = (html: string, priorFigCount: number): string => {
    const parts: string[] = [];
    let lastIdx = 0;
    let injectedCount = 0;
    const imgRe = /__IMG_(\d+)__/g;
    let m: RegExpExecArray | null;
    while ((m = imgRe.exec(html)) !== null) {
        const imgEnd = m.index + m[0].length;
        const after600 = html.slice(imgEnd, imgEnd + 600);
        if (/class="figure-caption"/.test(after600)) continue;
        const before = html.slice(0, imgEnd);
        const captionsInOriginal = (before.match(/class="figure-caption"/g) ?? []).length;
        const figNum = priorFigCount + captionsInOriginal + injectedCount + 1;
        parts.push(html.slice(lastIdx, imgEnd));
        parts.push(`\n<div class="figure-caption">Figure ${figNum}</div>`);
        lastIdx = imgEnd;
        injectedCount++;
    }
    if (parts.length === 0) return html;
    parts.push(html.slice(lastIdx));
    return parts.join('');
};

export const countNumberedItems = (text: string): number => {
    const explicitCount = (text.match(/[\uFF08(]\s*\d+\s*[\uFF09)]/g) ?? []).length;
    const listItemCount = (text.match(/<li\b/gi) ?? []).length;
    return Math.max(explicitCount, listItemCount);
};

export const hasSameBodyHallucination = (text: string): boolean => {
    const plain = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    const tail = plain.slice(-3000);
    const re = /[\uFF08(]\s*\d+\s*[\uFF09)]\s*([^\n\uFF08\uFF09()]{8,100})/g;
    const matches = [...tail.matchAll(re)];
    if (matches.length < 5) return false;
    const last8 = matches.slice(-8);
    const bodies = last8.map(m => m[1].trim());
    const refBody = bodies[bodies.length - 1];
    if (refBody.length < 8) return false;
    const sameCount = bodies.filter(b => b === refBody).length;
    return sameCount >= 5;
};
