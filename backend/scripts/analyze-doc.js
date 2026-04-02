const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const docId = process.argv[2];

if (!docId) {
  console.error('Usage: node scripts/analyze-doc.js <docId>');
  process.exit(1);
}

const normalize = (s) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function analyzeOutput(html) {
  const fullText = normalize(html);
  const headingRegex = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
  const headings = [];
  let m;
  while ((m = headingRegex.exec(html)) !== null) {
    const level = Number(m[1]);
    const attrs = m[2] || '';
    const isDocTitle = /class\s*=\s*["'][^"']*\bdoc-title\b/i.test(attrs);
    if (isDocTitle) continue;
    const text = normalize(m[3]);
    if (text) headings.push({ level, text });
  }

  const repeatedLevelOne = [];
  const byLevel = new Map();
  for (const h of headings) {
    if (!byLevel.has(h.level)) byLevel.set(h.level, []);
    byLevel.get(h.level).push(h.text);
  }
  for (const [level, arr] of byLevel.entries()) {
    let run = 0;
    for (const t of arr) {
      if (/^\s*1([.)、\s]|$)/.test(t)) run += 1;
      else run = 0;
      if (run >= 2) repeatedLevelOne.push({ level, sample: t });
    }
  }

  const h2Sequence = headings
    .filter((h) => h.level === 2)
    .map((h) => {
      const m2 = h.text.match(/^\s*(\d+)[.)、]/);
      return { text: h.text, n: m2 ? Number(m2[1]) : null };
    });
  const h2Regressions = [];
  let prev = -Infinity;
  for (const item of h2Sequence) {
    if (item.n == null) continue;
    if (item.n <= prev) h2Regressions.push({ prev, curr: item.n, text: item.text });
    prev = item.n;
  }

  const blockRegex = /<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  const blocks = [];
  while ((m = blockRegex.exec(html)) !== null) {
    const txt = normalize(m[2]);
    if (txt.length >= 30) blocks.push(txt);
  }
  const duplicateAdjacent = [];
  for (let i = 1; i < blocks.length; i++) {
    if (blocks[i] === blocks[i - 1]) duplicateAdjacent.push(blocks[i].slice(0, 120));
  }

  const fullRepeatSignals = [];
  const probeSizes = [600, 1200, 2400];
  for (const size of probeSizes) {
    if (fullText.length < size * 3) continue;
    const probe = fullText.slice(0, size);
    const firstPos = fullText.indexOf(probe);
    const secondPos = fullText.indexOf(probe, firstPos + size);
    if (secondPos !== -1) {
      fullRepeatSignals.push({ probeSize: size, secondPos });
    }
  }

  return {
    headingCount: headings.length,
    repeatedLevelOneCount: repeatedLevelOne.length,
    duplicateAdjacentBlockCount: duplicateAdjacent.length,
    fullRepeatSignalCount: fullRepeatSignals.length,
    h2RegressionsCount: h2Regressions.length,
    repeatedLevelOneSamples: repeatedLevelOne.slice(0, 10),
    h2Regressions: h2Regressions.slice(0, 10),
    duplicateSamples: duplicateAdjacent.slice(0, 10),
    fullRepeatSignals,
    headingSamples: headings.slice(0, 20)
  };
}

async function main() {
  const doc = await prisma.document.findUnique({
    where: { id: docId },
    select: { id: true, title: true, content: true, createdAt: true, wordCount: true }
  });
  if (!doc) {
    console.error('Document not found');
    process.exit(1);
  }
  const report = analyzeOutput(doc.content || '');
  console.log(JSON.stringify({ meta: { id: doc.id, title: doc.title, createdAt: doc.createdAt, wordCount: doc.wordCount }, report }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

