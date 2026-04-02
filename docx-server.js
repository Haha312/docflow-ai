/**
 * Minimal HTTP server that parses a DOCX and returns heading structure as JSON.
 * Uses only Node.js built-ins: http, fs, zlib, path
 */
'use strict';
const http = require('http');
const fs   = require('fs');
const zlib = require('zlib');
const path = require('path');

const DOCX_PATH = process.env.DOCX_PATH ||
  'C:\\Users\\86188\\Desktop\\基于三维信息技术的新能源电站数字化设计关键技术研究报告(1).docx';

const PORT = parseInt(process.env.PORT || '7788', 10);

// ── ZIP parser ───────────────────────────────────────────────────────────────
function r16(b, o) { return b[o] | (b[o+1]<<8); }
function r32(b, o) { return (b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0; }

function parseZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf[i]===0x50&&buf[i+1]===0x4b&&buf[i+2]===0x05&&buf[i+3]===0x06) { eocd=i; break; }
  }
  if (eocd < 0) throw new Error('No EOCD');
  const cdOff = r32(buf, eocd+16);
  const cdSz  = r32(buf, eocd+12);
  const entries = {};
  let pos = cdOff;
  while (pos < cdOff + cdSz) {
    if (buf[pos]!==0x50||buf[pos+1]!==0x4b||buf[pos+2]!==0x01||buf[pos+3]!==0x02) break;
    const comp  = r16(buf, pos+10);
    const csz   = r32(buf, pos+20);
    const usz   = r32(buf, pos+24);
    const fnLen = r16(buf, pos+28);
    const exLen = r16(buf, pos+30);
    const cmLen = r16(buf, pos+32);
    const lhOff = r32(buf, pos+42);
    const name  = buf.slice(pos+46, pos+46+fnLen).toString('utf8');
    entries[name] = { comp, csz, usz, lhOff };
    pos += 46 + fnLen + exLen + cmLen;
  }
  return entries;
}

function extractEntry(buf, e) {
  const o = e.lhOff;
  const fnLen = r16(buf, o+26);
  const exLen = r16(buf, o+28);
  const data  = buf.slice(o+30+fnLen+exLen, o+30+fnLen+exLen+e.csz);
  if (e.comp === 0) return data;
  if (e.comp === 8) return zlib.inflateRawSync(data);
  throw new Error('Unsupported compression: ' + e.comp);
}

// ── Heading extractor ────────────────────────────────────────────────────────
function extractHeadings(docxPath) {
  const buf = fs.readFileSync(docxPath);
  const entries = parseZip(buf);

  if (!entries['word/document.xml']) throw new Error('word/document.xml not found');

  const docXml    = extractEntry(buf, entries['word/document.xml']).toString('utf8');
  const stylesXml = entries['word/styles.xml']
    ? extractEntry(buf, entries['word/styles.xml']).toString('utf8') : '';

  // Build styleId → name map
  const styleMap = {};
  const sbRe = /<w:style\b[\s\S]*?<\/w:style>/g;
  let sb;
  while ((sb = sbRe.exec(stylesXml)) !== null) {
    const b  = sb[0];
    const im = /w:styleId="([^"]+)"/.exec(b);
    const nm = /<w:name\s+w:val="([^"]+)"/.exec(b);
    if (im && nm) styleMap[im[1]] = nm[1];
  }

  const isH = (sid, sname) => {
    const n = (sname||sid||'').toLowerCase();
    if (/^heading\s*[1-6]$/.test(n)) return true;
    if (/^标题\s*[1-6一二三四五六]$/.test(sname||'')) return true;
    if (/^标题\s*[1-6一二三四五六]$/.test(sid||'')) return true;
    return false;
  };

  const headings = [];
  const paraRe = /<w:p[ >][\s\S]*?<\/w:p>/g;
  let pm;
  while ((pm = paraRe.exec(docXml)) !== null) {
    const para  = pm[0];
    const sm    = /<w:pStyle\s+w:val="([^"]+)"/.exec(para);
    if (!sm) continue;
    const sid   = sm[1];
    const sname = styleMap[sid] || sid;
    if (!isH(sid, sname)) continue;
    let text = '';
    const tRe = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
    let tm;
    while ((tm = tRe.exec(para)) !== null) text += tm[1];
    text = text.trim();
    if (!text) continue;
    headings.push({ styleId: sid, styleName: sname, text: text.substring(0, 150) });
  }

  // Collect all unique style IDs for diagnostics
  const allStyles = {};
  const asRe = /<w:pStyle\s+w:val="([^"]+)"/g;
  let asm;
  while ((asm = asRe.exec(docXml)) !== null) {
    const sid = asm[1];
    if (!allStyles[sid]) allStyles[sid] = styleMap[sid] || '(unknown)';
  }

  return { headings, allStyles, docxPath };
}

// ── HTTP server ──────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  try {
    const result = extractHeadings(DOCX_PATH);
    res.writeHead(200);
    res.end(JSON.stringify(result, null, 2));
  } catch (e) {
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message, stack: e.stack }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`DOCX heading server running at http://127.0.0.1:${PORT}/`);
  console.log(`Analyzing: ${DOCX_PATH}`);
});
