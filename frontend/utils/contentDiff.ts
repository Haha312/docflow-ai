/**
 * 「仅格式改动」对比:在纯文本层面比对原文 vs 成稿,证明内容被保留、并暴露真正的增删。
 *
 * 设计:不做字符级 edit script,而是"句子是否仍存在于对方整段文本中"的包含式比对。
 * 这样能中和 AI 的预期改动(剥离旧编号、规整空白、给标题加新编号),避免满屏误报。
 * 结果是"疑似"增删,供用户复核,不是硬保证。纯函数,便于单测。
 */

export interface DiffResult {
  identical: boolean;
  removed: string[];   // 原文有、成稿整段中找不到的句子(疑似删减)
  added: string[];     // 成稿有、原文整段中找不到的句子(疑似新增/AI 自行补写)
  retentionPct: number;
}

const SENTENCE_SPLIT = /[。！？!?\n;；]+/;
const MIN_LEN = 8;             // 短于此的片段视为噪声(标题、编号、零碎词)
const MAX_LIST = 60;           // 展示上限,避免极端情况下列表爆炸

// 去标签:块级标签(标题/段落/列表项等)边界插入换行,避免相邻块文本被粘连成一句;
// 其余内联标签直接删除(不插空格,免得把一个词拆开)。
const stripTags = (s: string): string => (s || '')
  .replace(/<\/(p|h[1-6]|li|div|tr|td|th|blockquote|section|article|caption)>/gi, '\n')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, '');

// 整段压实:去标签 + 去所有空白,用作 includes 判断的 haystack(中文无需空格)
const compact = (s: string): string => stripTags(s).replace(/\s+/g, '');

// 单句清洗:剥离前导编号 / 项目符号 / "第X章节" + 压空白,使两侧句子可比
const cleanSentence = (s: string): string =>
  (s || '')
    .replace(/^[\s•·▪◦*\-—–]+/, '')
    .replace(/^(第[一二三四五六七八九十百千\d]+[章节条款部分篇讲])\s*/,'')
    .replace(/^[（(]?\s*[\d０-９一二三四五六七八九十]+\s*[）)、.．]+\s*/, '')
    .replace(/\s+/g, '')
    .trim();

const splitSentences = (text: string): string[] =>
  stripTags(text).split(SENTENCE_SPLIT).map(cleanSentence).filter((x) => x.length >= MIN_LEN);

const dedupe = (arr: string[]): string[] => Array.from(new Set(arr));

export function diffContent(input: string, output: string): DiffResult {
  const inHay = compact(input);
  const outHay = compact(output);
  const inSents = splitSentences(input);
  const outSents = splitSentences(output);

  const removedAll = inSents.filter((s) => !outHay.includes(s));
  const addedAll = outSents.filter((s) => !inHay.includes(s));

  const removed = dedupe(removedAll).slice(0, MAX_LIST);
  const added = dedupe(addedAll).slice(0, MAX_LIST);

  const matched = inSents.length - removedAll.length;
  const retentionPct = inSents.length > 0 ? Math.round((matched / inSents.length) * 100) : 100;
  const identical = removedAll.length === 0 && addedAll.length === 0;

  return { identical, removed, added, retentionPct };
}
