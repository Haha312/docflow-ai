import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { convertMillimetersToTwip } from 'docx';
import { generateDocx } from './docxGenerator';
import { PRESETS } from '../constants';
import { DocPreset } from '../types';

const mm = convertMillimetersToTwip; // 用 docx 自身换算口径,避免取整规则差异导致脆性

const styleOf = (id: DocPreset) => PRESETS.find(p => p.id === id)!.styleConfig;

async function docXml(html: string, preset: DocPreset): Promise<string> {
  const blob = await generateDocx(html, styleOf(preset));
  const buf = await blob.arrayBuffer();
  const zip = await JSZip.loadAsync(buf);
  return zip.file('word/document.xml')!.async('string');
}
const attr = (xml: string, tag: string, name: string): number =>
  parseInt(new RegExp(`<w:${tag}[^>]*w:${name}="(\\d+)"`).exec(xml)?.[1] ?? '0', 10);

describe('generateDocx 页面设置(阶段0 合规修复,整数 twips)', () => {
  it('公文导出 = GB/T 9704 页边距 + A4(整数 twips,非默认 1440)', async () => {
    const xml = await docXml('<h1 class="doc-title">关于XX的通知</h1><p>正文内容测试一二三。</p>', DocPreset.CORPORATE);
    expect(attr(xml, 'pgMar', 'top')).toBe(mm(37));     // 3.7cm
    expect(attr(xml, 'pgMar', 'bottom')).toBe(mm(35));  // 3.5cm
    expect(attr(xml, 'pgMar', 'left')).toBe(mm(28));    // 2.8cm
    expect(attr(xml, 'pgMar', 'right')).toBe(mm(26));   // 2.6cm
    expect(attr(xml, 'pgMar', 'top')).toBeGreaterThan(1440); // 确证不是 docx 默认
    expect(attr(xml, 'pgSz', 'w')).toBe(mm(210));       // A4
    expect(attr(xml, 'pgSz', 'h')).toBe(mm(297));
  });

  it('论文导出 = 标准学术边距(左右 3.18cm)+ A4', async () => {
    const xml = await docXml('<h2>1. 引言</h2><p>论文正文测试内容。</p>', DocPreset.ACADEMIC);
    expect(attr(xml, 'pgMar', 'left')).toBe(mm(31.8));  // 3.18cm
    expect(attr(xml, 'pgMar', 'top')).toBe(mm(25.4));   // 2.54cm
    expect(attr(xml, 'pgSz', 'h')).toBe(mm(297));
  });
});
