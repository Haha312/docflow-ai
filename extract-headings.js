/**
 * Extracts heading structure from a .docx file using only Node.js built-ins.
 * A .docx is a ZIP archive; we use the `zlib` + manual ZIP parsing, or
 * we can shell out to PowerShell to unzip on Windows.
 * Strategy: use child_process to invoke PowerShell's Expand-Archive, then read the XML.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const docxPath = process.argv[2] || 'C:\\Users\\86188\\Desktop\\基于三维信息技术的新能源电站数字化设计关键技术研究报告(1).docx';
const tmpDir = path.join(os.tmpdir(), 'docx_extract_' + Date.now());

try {
  // Use PowerShell to extract the ZIP
  const psCmd = `powershell -Command "Expand-Archive -LiteralPath '${docxPath}' -DestinationPath '${tmpDir}' -Force"`;
  execSync(psCmd, { stdio: 'pipe' });

  const docXmlPath = path.join(tmpDir, 'word', 'document.xml');
  if (!fs.existsSync(docXmlPath)) {
    console.error('document.xml not found after extraction');
    process.exit(1);
  }

  const xml = fs.readFileSync(docXmlPath, 'utf8');

  // Parse paragraphs and their styles
  // Each paragraph is <w:p>...</w:p>
  // Style is in <w:pStyle w:val="..."/>
  // Text runs are <w:t>...</w:t>

  const headingStyles = new Set([
    'Heading1','Heading2','Heading3','Heading4','Heading5','Heading6',
    'heading1','heading2','heading3','heading4','heading5','heading6',
    '1','2','3','4','5','6',  // numeric style IDs
  ]);

  // Also match Chinese heading patterns
  const isHeadingStyle = (s) => {
    if (!s) return false;
    if (headingStyles.has(s)) return true;
    // Chinese: 标题1, 标题 1, 标题一 etc.
    if (/^标题\s*[1-6一二三四五六]$/.test(s)) return true;
    // English with space: "Heading 1"
    if (/^[Hh]eading\s*[1-6]$/.test(s)) return true;
    return false;
  };

  // Extract all <w:p> blocks
  const paraRegex = /<w:p[ >][\s\S]*?<\/w:p>/g;
  const styleRegex = /<w:pStyle\s+w:val="([^"]+)"/;
  const textRegex = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;

  const headings = [];
  let match;

  while ((match = paraRegex.exec(xml)) !== null) {
    const para = match[0];
    const styleMatch = styleRegex.exec(para);
    if (!styleMatch) continue;
    const styleName = styleMatch[1];
    if (!isHeadingStyle(styleName)) continue;

    // Extract all text from this paragraph
    let text = '';
    let tMatch;
    const textRe = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g;
    while ((tMatch = textRe.exec(para)) !== null) {
      text += tMatch[1];
    }
    text = text.trim();
    if (text.length === 0) continue;

    headings.push({ style: styleName, text: text.substring(0, 100) });
  }

  console.log(`\nFound ${headings.length} headings:\n`);
  headings.forEach((h, i) => {
    console.log(`[${i+1}] Style="${h.style}" | ${h.text}`);
  });

} catch (e) {
  console.error('Error:', e.message);
  process.exit(1);
} finally {
  // Cleanup
  try {
    execSync(`powershell -Command "Remove-Item -Recurse -Force '${tmpDir}'"`, { stdio: 'pipe' });
  } catch(_) {}
}
