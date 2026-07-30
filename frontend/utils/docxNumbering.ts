/**
 * Word 编号还原(P0 根治):
 * Word 里"图 1""1.""一、"这类编号由 numbering.xml 的编号引擎在渲染时计算,文本里并不存在。
 * mammoth 转 HTML 会把编号段落变成 <ol><li>,编号全丢且每组从 1 重数 ——
 * 真实文档实测:47 个图题全部丢号、正文出现满篇"1."重复小标题、章号起点漂移。
 * 此模块按 Word 同款规则重算每个编号段落的字面编号(lvlText 模板 + 各级计数器),
 * 再把 mammoth 输出里的 <li>/<h*> 按文档顺序对号入座,把编号以文字形式写回。
 */
import JSZip from 'jszip';

export interface NumberedPara { text: string; label: string; }

const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const toChinese = (n: number): string => {
    if (n <= 0) return String(n);
    if (n < 10) return CN[n];
    if (n < 20) return '十' + (n % 10 ? CN[n % 10] : '');
    if (n < 100) return CN[Math.floor(n / 10)] + '十' + (n % 10 ? CN[n % 10] : '');
    return String(n);
};
const ROMAN: [number, string][] = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
const toRoman = (n: number): string => { let s = ''; for (const [v, r] of ROMAN) { while (n >= v) { s += r; n -= v; } } return s; };

const formatNum = (n: number, fmt: string): string => {
    switch (fmt) {
        case 'chineseCounting':
        case 'chineseCountingThousand':
        case 'chineseLegalSimplified': return toChinese(n);
        case 'lowerLetter': return String.fromCharCode(96 + ((n - 1) % 26) + 1);
        case 'upperLetter': return String.fromCharCode(64 + ((n - 1) % 26) + 1);
        case 'lowerRoman': return toRoman(n);
        case 'upperRoman': return toRoman(n).toUpperCase();
        default: return String(n); // decimal 及其余格式兜底
    }
};

interface Lvl { start: number; numFmt: string; lvlText: string; }

/** 解析 docx,按文档顺序返回每个「编号段落」的字面编号与文本(bullet 跳过) */
export const computeDocxNumbering = async (arrayBuffer: ArrayBuffer): Promise<NumberedPara[]> => {
    try {
        const zip = await JSZip.loadAsync(arrayBuffer);
        const numberingXml = await zip.file('word/numbering.xml')?.async('text');
        const docXml = await zip.file('word/document.xml')?.async('text');
        if (!numberingXml || !docXml) return [];
        const parser = new DOMParser();

        // ── numbering.xml:abstractNum 的各级定义 + numId → abstractNumId(含 startOverride)──
        const numDoc = parser.parseFromString(numberingXml, 'application/xml');
        const abstractLevels = new Map<string, Map<number, Lvl>>();
        for (const abs of Array.from(numDoc.getElementsByTagName('w:abstractNum'))) {
            const id = abs.getAttribute('w:abstractNumId') ?? '';
            const levels = new Map<number, Lvl>();
            for (const lvl of Array.from(abs.getElementsByTagName('w:lvl'))) {
                const ilvl = parseInt(lvl.getAttribute('w:ilvl') ?? '0', 10);
                const start = parseInt(lvl.getElementsByTagName('w:start')[0]?.getAttribute('w:val') ?? '1', 10);
                const numFmt = lvl.getElementsByTagName('w:numFmt')[0]?.getAttribute('w:val') ?? 'decimal';
                const lvlText = lvl.getElementsByTagName('w:lvlText')[0]?.getAttribute('w:val') ?? '%1.';
                levels.set(ilvl, { start: Number.isFinite(start) ? start : 1, numFmt, lvlText });
            }
            abstractLevels.set(id, levels);
        }
        const numToAbstract = new Map<string, { abstractId: string; startOverrides: Map<number, number> }>();
        for (const num of Array.from(numDoc.getElementsByTagName('w:num'))) {
            const numId = num.getAttribute('w:numId') ?? '';
            const abstractId = num.getElementsByTagName('w:abstractNumId')[0]?.getAttribute('w:val') ?? '';
            const overrides = new Map<number, number>();
            for (const ov of Array.from(num.getElementsByTagName('w:lvlOverride'))) {
                const ilvl = parseInt(ov.getAttribute('w:ilvl') ?? '0', 10);
                const so = ov.getElementsByTagName('w:startOverride')[0]?.getAttribute('w:val');
                if (so != null) overrides.set(ilvl, parseInt(so, 10));
            }
            numToAbstract.set(numId, { abstractId, startOverrides: overrides });
        }

        // ── styles.xml:样式级 numPr(标题样式的编号常挂在样式上)+ basedOn 继承 ──
        const stylesXml = await zip.file('word/styles.xml')?.async('text');
        const styleNum = new Map<string, { numId: string; ilvl: number }>();
        const styleBased = new Map<string, string>();
        if (stylesXml) {
            const sDoc = parser.parseFromString(stylesXml, 'application/xml');
            for (const st of Array.from(sDoc.getElementsByTagName('w:style'))) {
                if (st.getAttribute('w:type') !== 'paragraph') continue;
                const sid = st.getAttribute('w:styleId') ?? '';
                const basedOn = st.getElementsByTagName('w:basedOn')[0]?.getAttribute('w:val');
                if (basedOn) styleBased.set(sid, basedOn);
                const pPr = st.getElementsByTagName('w:pPr')[0];
                const numPr = pPr?.getElementsByTagName('w:numPr')[0];
                if (!numPr) continue;
                const numId = numPr.getElementsByTagName('w:numId')[0]?.getAttribute('w:val');
                const ilvl = parseInt(numPr.getElementsByTagName('w:ilvl')[0]?.getAttribute('w:val') ?? '0', 10);
                if (numId) styleNum.set(sid, { numId, ilvl });
            }
        }
        const resolveStyleNum = (sid: string, depth = 0): { numId: string; ilvl: number } | null => {
            if (!sid || depth > 10) return null;
            return styleNum.get(sid) ?? resolveStyleNum(styleBased.get(sid) ?? '', depth + 1);
        };

        // ── document.xml:按文档顺序重算每个编号段落 ──
        const dDoc = parser.parseFromString(docXml, 'application/xml');
        const counters = new Map<string, number[]>(); // abstractId → 各级计数器
        const started = new Map<string, Set<number>>(); // abstractId → 已应用 startOverride 的 numId 集(粗略)
        const out: NumberedPara[] = [];
        for (const p of Array.from(dDoc.getElementsByTagName('w:p'))) {
            const pPr = p.getElementsByTagName('w:pPr')[0];
            let numId: string | null = null;
            let ilvl = 0;
            const numPr = pPr?.getElementsByTagName('w:numPr')[0];
            if (numPr) {
                numId = numPr.getElementsByTagName('w:numId')[0]?.getAttribute('w:val') ?? null;
                ilvl = parseInt(numPr.getElementsByTagName('w:ilvl')[0]?.getAttribute('w:val') ?? '0', 10);
            } else {
                const sid = pPr?.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') ?? '';
                const sn = resolveStyleNum(sid);
                if (sn) { numId = sn.numId; ilvl = sn.ilvl; }
            }
            if (!numId || numId === '0') continue;
            const link = numToAbstract.get(numId);
            if (!link) continue;
            const levels = abstractLevels.get(link.abstractId);
            const lvl = levels?.get(ilvl);
            if (!lvl || lvl.numFmt === 'bullet' || lvl.numFmt === 'none') continue;

            let ctr = counters.get(link.abstractId);
            if (!ctr) { ctr = []; counters.set(link.abstractId, ctr); }
            const so = link.startOverrides.get(ilvl);
            let startedSet = started.get(link.abstractId);
            if (!startedSet) { startedSet = new Set(); started.set(link.abstractId, startedSet); }
            if (so != null && !startedSet.has(ilvl)) { ctr[ilvl] = so - 1; startedSet.add(ilvl); }
            ctr[ilvl] = (ctr[ilvl] ?? (lvl.start - 1)) + 1;
            for (let k = ilvl + 1; k < 9; k += 1) delete ctr[k]; // 深层重置(下次触发从 start 重新起)

            const label = lvl.lvlText.replace(/%(\d)/g, (_m, d: string) => {
                const li = parseInt(d, 10) - 1;
                const lvlDef = levels?.get(li);
                const v = ctr[li] ?? lvlDef?.start ?? 1;
                return formatNum(Math.max(1, v), lvlDef?.numFmt ?? 'decimal');
            });

            let text = '';
            for (const t of Array.from(p.getElementsByTagName('w:t'))) text += t.textContent ?? '';
            text = text.trim();
            if (!text) continue;
            out.push({ text, label });
        }
        return out;
    } catch (e) {
        console.warn('[NUMBERING] compute failed, skip', e);
        return [];
    }
};

const norm = (s: string): string => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').replace(/\s+/g, '').toLowerCase();

/**
 * 把重算的编号写回 mammoth HTML:按文档顺序给 <li>/<h1-6> 对号入座。
 * 编号列表项 → 带字面编号的普通段落(视觉与 Word 一致,且编号不再被任何环节重置);
 * 编号标题 → 标题文本前插入字面编号。空掉的 ol/ul 壳就地解包。
 */
export const applyNumberingToHtml = (html: string, numbered: NumberedPara[]): string => {
    if (!numbered.length) return html;
    try {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        let qi = 0;
        const nodes = Array.from(doc.body.querySelectorAll('li, h1, h2, h3, h4, h5, h6'));
        for (const node of nodes) {
            const t = norm(node.textContent ?? '');
            if (!t) continue;
            // 顺序窗口匹配(±25):两序列同为文档序,窗口防个别节点缺席造成整体错位
            let hit = -1;
            for (let j = qi; j < Math.min(numbered.length, qi + 25); j += 1) {
                const nt = norm(numbered[j].text);
                if (nt === t || (nt.length > 8 && (t.startsWith(nt) || nt.startsWith(t)))) { hit = j; break; }
            }
            if (hit === -1) continue;
            const { label } = numbered[hit];
            qi = hit + 1;
            const sep = /[.、).）]$/.test(label) ? ' ' : ' ';
            if (node.tagName === 'LI') {
                const pEl = doc.createElement('p');
                pEl.innerHTML = `${label}${sep}${(node as HTMLElement).innerHTML}`;
                const list = node.parentElement;
                list?.parentElement?.insertBefore(pEl, list);
                node.remove();
            } else {
                (node as HTMLElement).innerHTML = `${label}${sep}${(node as HTMLElement).innerHTML}`;
            }
        }
        // 解包空列表壳
        for (const list of Array.from(doc.body.querySelectorAll('ol, ul'))) {
            if (!list.querySelector('li')) {
                while (list.firstChild) list.parentElement?.insertBefore(list.firstChild, list);
                list.remove();
            }
        }
        return doc.body.innerHTML;
    } catch (e) {
        console.warn('[NUMBERING] apply failed, keep original html', e);
        return html;
    }
};
