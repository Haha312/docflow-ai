import { describe, it, expect } from 'vitest';
import { countStructure, buildIntegrityReport, detectStructuralAnomalies } from '../integrity';

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

describe('detectStructuralAnomalies', () => {
  it('单个 doc-title → 无异常', () => {
    expect(detectStructuralAnomalies('<h1 class="doc-title">标题</h1><h2>章</h2>')).toHaveLength(0);
  });
  it('多个 doc-title → critical 绊线', () => {
    const issues = detectStructuralAnomalies('<h1 class="doc-title">A</h1><h2>x</h2><h1 class="doc-title">B</h1>');
    expect(issues.some((x) => x.type === 'multiple_titles' && x.severity === 'critical')).toBe(true);
  });
  it('重复标题被降级成同文本 h2(doc-title class 已抹掉)→ 文本级 critical 绊线', () => {
    // 旧绊线只数 class 会漏检;文本级检测能抓到。
    const html = '<h1 class="doc-title">平台设计</h1><h2>目标</h2><h2>平台设计</h2>';
    const issues = detectStructuralAnomalies(html);
    expect(issues.some((x) => x.type === 'title_text_duplicated_as_heading' && x.severity === 'critical')).toBe(true);
  });
  it('正常文档(章节文本均不等于标题)→ 无绊线', () => {
    const html = '<h1 class="doc-title">关于XX的通知</h1><h2>1. 引言</h2><h2>2. 现状</h2>';
    expect(detectStructuralAnomalies(html)).toHaveLength(0);
  });
});
