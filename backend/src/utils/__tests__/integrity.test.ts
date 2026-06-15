import { describe, it, expect } from 'vitest';
import { countStructure, buildIntegrityReport } from '../integrity';

describe('countStructure', () => {
  it('按级统计标题并跳过 doc-title', () => {
    const html =
      '<h1 class="doc-title">关于XX的通知</h1>' +
      '<h2>1. 引言</h2><p>第一段正文。</p>' +
      '<h2>2. 现状</h2><h3>2.1 子节</h3><p>第二段。</p>' +
      '<ul><li>条目一</li><li>条目二</li></ul>' +
      '<p>第三段 <img src="x.png"></p>';
    const c = countStructure(html);
    expect(c.headings).toBe(3);            // 2×h2 + 1×h3,doc-title 不计
    expect(c.headingsByLevel[2]).toBe(2);
    expect(c.headingsByLevel[3]).toBe(1);
    expect(c.headingsByLevel[1]).toBeUndefined();
    expect(c.paragraphs).toBe(3);
    expect(c.listItems).toBe(2);
    expect(c.images).toBe(1);
    expect(c.charCount).toBeGreaterThan(0);
  });

  it('列表项取 <li> 与 (N) 显式编号的较大者', () => {
    expect(countStructure('<li>a</li><li>b</li><li>c</li>').listItems).toBe(3);
    expect(countStructure('（1）甲 （2）乙 （3）丙 （4）丁').listItems).toBe(4);
  });

  it('纯文本(无标签)→ 标题/段落为 0,字符数有效,不崩', () => {
    const c = countStructure('这是一段没有任何标签的纯文本内容。');
    expect(c.headings).toBe(0);
    expect(c.paragraphs).toBe(0);
    expect(c.charCount).toBe('这是一段没有任何标签的纯文本内容。'.length);
  });

  it('空输入返回全 0', () => {
    const c = countStructure('');
    expect(c).toEqual({ paragraphs: 0, headings: 0, headingsByLevel: {}, listItems: 0, charCount: 0, images: 0 });
  });
});

describe('buildIntegrityReport', () => {
  const counts = (charCount: number, headings = 0) => ({
    paragraphs: 0, headings, headingsByLevel: {}, listItems: 0, charCount, images: 0,
  });

  it('字符保留率四舍五入,标题齐则 headingsMatched=true', () => {
    const r = buildIntegrityReport(counts(100, 5), counts(106, 5), []);
    expect(r.charRetentionPct).toBe(106);
    expect(r.headingsMatched).toBe(true);
    expect(r.truncated).toBe(false);
  });

  it('输出标题少于输入 → headingsMatched=false', () => {
    expect(buildIntegrityReport(counts(100, 6), counts(90, 4), []).headingsMatched).toBe(false);
  });

  it('含截断/幻觉类事件 → truncated=true;纯 info 不算', () => {
    expect(buildIntegrityReport(counts(100), counts(50), [{ type: 'loop_truncated', severity: 'critical', detail: 'x' }]).truncated).toBe(true);
    expect(buildIntegrityReport(counts(100), counts(99), [{ type: 'chunk_skipped', severity: 'info', detail: 'x' }]).truncated).toBe(false);
  });

  it('输入字符为 0 → 保留率兜底 100', () => {
    expect(buildIntegrityReport(counts(0), counts(50), []).charRetentionPct).toBe(100);
  });
});
