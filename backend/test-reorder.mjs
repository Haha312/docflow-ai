// Quick test for reorderCorporateDocument and repairUnclosedTags logic
// Run: node test-reorder.mjs

const repairUnclosedTags = (html) => {
    const trackTags = ['ul', 'ol', 'li', 'table', 'tbody', 'thead', 'tr', 'td', 'th'];
    const stack = [];
    const tagRe = /<(\/?)([a-z][a-z0-9]*)\b[^>]*>/gi;
    let m;
    while ((m = tagRe.exec(html)) !== null) {
        const isClose = m[1] === '/';
        const tag = m[2].toLowerCase();
        if (!trackTags.includes(tag)) continue;
        if (isClose) {
            const idx = stack.lastIndexOf(tag);
            if (idx !== -1) stack.splice(idx, 1);
        } else {
            if (!m[0].endsWith('/>')) stack.push(tag);
        }
    }
    const closingTags = stack.reverse().map(t => `</${t}>`).join('');
    return html + closingTags;
};

const reorderCorporateDocument = (html) => {
    const extractByClass = (src, cls) => {
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

    const extractHrDivider = (src) => {
        const re = /<hr\b[^>]*class="[^"]*doc-divider[^"]*"[^>]*\/?>/i;
        const m = re.exec(src);
        if (!m) return { el: '', rest: src };
        return { el: m[0], rest: src.slice(0, m.index) + src.slice(m.index + m[0].length) };
    };

    const slots = [
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
    if (issuerSlot?.extracted && !dividerSlot?.extracted) {
        if (dividerSlot) dividerSlot.extracted = '<hr class="doc-divider">';
    }

    const titleSlot = slots.find(s => s.cls === 'doc-title');
    if (!titleSlot?.extracted) {
        console.log('[CORPORATE_REORDER] doc-title not found, skipping reorder');
        return html;
    }

    const header = slots.map(s => s.extracted).filter(Boolean).join('\n');
    console.log(`[CORPORATE_REORDER] Reordered header (${header.length} chars) + body (${remaining.trim().length} chars)`);
    return header + '\n' + remaining.trim();
};

// ===== Test 1: Basic reorder (title before issuer in input) =====
console.log('\n=== TEST 1: Basic reorder ===');
const test1Input = `
<h1 class="doc-title">关于加强某某工作的通知</h1>
<p class="doc-addressee">各县（市、区）人民政府：</p>
<div class="doc-issuer">某市人民政府文件</div>
<p class="doc-ref-number">某政发〔2024〕15号</p>
<h2>一、 总体要求</h2>
<p>这是正文内容。</p>
`;
const result1 = reorderCorporateDocument(test1Input);
const lines1 = result1.trim().split('\n').map(l => l.trim()).filter(Boolean);
console.log('Output order of elements:');
lines1.forEach((l, i) => console.log(`  ${i+1}. ${l.substring(0, 60)}`));

// Verify order
const issuerPos1 = result1.indexOf('doc-issuer');
const dividerPos1 = result1.indexOf('doc-divider');
const titlePos1 = result1.indexOf('doc-title');
const addrPos1 = result1.indexOf('doc-addressee');
const refPos1 = result1.indexOf('doc-ref-number');

console.log('\nOrder checks:');
console.log(`  doc-issuer (${issuerPos1}) < doc-divider (${dividerPos1}): ${issuerPos1 < dividerPos1 ? '✓ PASS' : '✗ FAIL'}`);
console.log(`  doc-divider (${dividerPos1}) < doc-ref-number (${refPos1}): ${dividerPos1 < refPos1 ? '✓ PASS' : '✗ FAIL'}`);
console.log(`  doc-ref-number (${refPos1}) < doc-title (${titlePos1}): ${refPos1 < titlePos1 ? '✓ PASS' : '✗ FAIL'}`);
console.log(`  doc-title (${titlePos1}) < doc-addressee (${addrPos1}): ${titlePos1 < addrPos1 ? '✓ PASS' : '✗ FAIL'}`);

// ===== Test 2: Divider auto-injection =====
console.log('\n=== TEST 2: Auto-inject divider when issuer found ===');
const test2Input = `
<div class="doc-issuer">某市人民政府文件</div>
<h1 class="doc-title">关于某某工作的通知</h1>
<h2>一、 正文</h2>
`;
const result2 = reorderCorporateDocument(test2Input);
const hasDivider2 = result2.includes('doc-divider');
console.log(`  Auto-injected <hr class="doc-divider">: ${hasDivider2 ? '✓ PASS' : '✗ FAIL'}`);
const dividerPos2 = result2.indexOf('doc-divider');
const titlePos2 = result2.indexOf('doc-title');
console.log(`  doc-divider (${dividerPos2}) < doc-title (${titlePos2}): ${dividerPos2 < titlePos2 ? '✓ PASS' : '✗ FAIL'}`);

// ===== Test 3: repairUnclosedTags =====
console.log('\n=== TEST 3: repairUnclosedTags ===');
const test3Input = `<ul><li>Item 1</li><li>Item 2`;
const result3 = repairUnclosedTags(test3Input);
console.log(`  Input:  ${test3Input}`);
console.log(`  Output: ${result3}`);
console.log(`  Contains </li>: ${result3.includes('</li>') ? '✓ PASS' : '✗ FAIL'}`);
console.log(`  Contains </ul>: ${result3.includes('</ul>') ? '✓ PASS' : '✗ FAIL'}`);

// ===== Test 4: No doc-title = skip reorder =====
console.log('\n=== TEST 4: No doc-title → skip reorder ===');
const test4Input = `<p>Plain text with no doc-title</p>`;
const result4 = reorderCorporateDocument(test4Input);
console.log(`  Unchanged: ${result4 === test4Input ? '✓ PASS' : '✗ FAIL'}`);

console.log('\n=== All tests complete ===');
