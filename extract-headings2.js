/**
 * Extract headings from a DOCX file using only Node.js built-ins.
 * DOCX = ZIP file. We parse it manually using Buffer operations.
 * Uses Node.js built-in 'zlib' for DEFLATE decompression.
 */
'use strict';
const fs = require('fs');
const zlib = require('zlib');

const docxPath = process.argv[2] ||
  'C:\\Users\\86188\\Desktop\\基于三维信息技术的新能源电站数字化设计关键技术研究报告(1).docx';

const buf = fs.readFileSync(docxPath);

// ── Minimal ZIP parser ──────────────────────────────────────────────────────
function readUint16LE(buf, off) { return buf[off] | (buf[off+1] << 8); }
function readUint32LE(buf, off) {
  return (buf[off] | (buf[off+1] << 8) | (buf[off+2] << 16) | (buf[off+3] << 24)) >>> 0;
}

function findEndOfCentralDirectory(buf) {
  // Scan from end for EOCD signature 0x06054b50
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i]===0x50 && buf[i+1]===0x4b && buf[i+2]===0x05 && buf[i+3]===0x06) {
      return i;
    }
  }
  throw new Error('No EOCD signature found — not a valid ZIP?');
}

function parseZip(buf) {
  const eocdOffset = findEndOfCentralDirectory(buf);
  const cdOffset   = readUint32LE(buf, eocdOffset + 16);
  const cdSize     = readUint32LE(buf, eocdOffset + 12);
  const entries    = {};

  let pos = cdOffset;
  const cdEnd = cdOffset + cdSize;

  while (pos < cdEnd) {
    // Central directory file header signature = 0x02014b50
    if (buf[pos]!==0x50||buf[pos+1]!==0x4b||buf[pos+2]!==0x01||buf[pos+3]!==0x02) break;

    const compression   = readUint16LE(buf, pos + 10);
    const compressedSz  = readUint32LE(buf, pos + 20);
    const uncompressedSz= readUint32LE(buf, pos + 24);
    const fileNameLen   = readUint16LE(buf, pos + 28);
    const extraLen      = readUint16LE(buf, pos + 30);
    const commentLen    = readUint16LE(buf, pos + 32);
    const localHdrOffset= readUint32LE(buf, pos + 42);

    const fileName = buf.slice(pos + 46, pos + 46 + fileNameLen).toString('utf8');
    pos += 46 + fileNameLen + extraLen + commentLen;

    entries[fileName] = { compression, compressedSz, uncompressedSz, localHdrOffset };
  }

  return entries;
}

function extractEntry(buf, entry) {
  const lhOff = entry.localHdrOffset;
  // Local file header signature = 0x04034b50
  if (buf[lhOff]!==0x50||buf[lhOff+1]!==0x4b||buf[lhOff+2]!==0x03||buf[lhOff+3]!==0x04) {
    throw new Error('Local file header signature not found at offset ' + lhOff);
  }
  const fnLen    = readUint16LE(buf, lhOff + 26);
  const extraLen = readUint16LE(buf, lhOff + 28);
  const dataStart = lhOff + 30 + fnLen + extraLen;
  const compData  = buf.slice(dataStart, dataStart + entry.compressedSz);

  if (entry.compression === 0) {
    // Stored (no compression)
    return compData;
  } else if (entry.compression === 8) {
    // Deflated
    return zlib.inflateRawSync(compData);
  } else {
    throw new Error('Unsupported compression method: ' + entry.compression);
  }
}

// ── Parse headings from XML ─────────────────────────────────────────────────
const entries = parseZip(buf);

if (!entries['word/document.xml']) {
  console.error('word/document.xml not found in ZIP. Files:', Object.keys(entries).join(', '));
  process.exit(1);
}

const docXmlBuf  = extractEntry(buf, entries['word/document.xml']);
const docXml     = docXmlBuf.toString('utf8');

let stylesXml = '';
if (entries['word/styles.xml']) {
  stylesXml = extractEntry(buf, entries['word/styles.xml']).toString('utf8');
}

// Build styleId -> name map
const styleNameMap = {};
const sbRe = /<w:style\b[\s\S]*?<\/w:style>/g;
let sb;
while ((sb = sbRe.exec(stylesXml)) !== null) {
  const block = sb[0];
  const idM   = /w:styleId="([^"]+)"/.exec(block);
  const nmM   = /<w:name\s+w:val="([^"]+)"/.exec(block);
  if (idM && nmM) styleNameMap[idM[1]] = nmM[1];
}

const isHeading = (sid, sname) => {
  const name = (sname || sid || '').toLowerCase();
  const id   = (sid   || '').toLowerCase();
  if (/^heading\s*[1-6]$/.test(name) || /^heading\s*[1-6]$/.test(id)) return true;
  // Chinese style names
  if (/^标题\s*[1-6一二三四五六]$/.test(sname || '') ||
      /^标题\s*[1-6一二三四五六]$/.test(sid   || '')) return true;
  return false;
};

const paraRe = /<w:p[ >][\s\S]*?<\/w:p>/g;
const headings = [];
let pm;

while ((pm = paraRe.exec(docXml)) !== null) {
  const para = pm[0];
  const sm   = /<w:pStyle\s+w:val="([^"]+)"/.exec(para);
  if (!sm) continue;
  const sid   = sm[1];
  const sname = styleNameMap[sid] || sid;
  if (!isHeading(sid, sname)) continue;

  let text = '';
  const tRe = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
  let tm;
  while ((tm = tRe.exec(para)) !== null) text += tm[1];
  text = text.trim();
  if (!text) continue;

  headings.push({ sid, sname, text });
}

console.log(`\nFound ${headings.length} headings:\n`);
headings.forEach((h, i) => {
  console.log(`[${String(i+1).padStart(3)}] StyleID="${h.sid}" Name="${h.sname}" | ${h.text.substring(0, 120)}`);
});

// Also dump all unique style IDs found in document (for diagnosis)
const allStyles = new Set();
const asRe = /<w:pStyle\s+w:val="([^"]+)"/g;
let asm;
while ((asm = asRe.exec(docXml)) !== null) allStyles.add(asm[1]);
console.log('\n--- All paragraph style IDs used in document ---');
for (const s of [...allStyles].sort()) {
  console.log(`  "${s}" => "${styleNameMap[s] || '(not in styles.xml)'}"  ${isHeading(s, styleNameMap[s]) ? '<-- HEADING' : ''}`);
}
