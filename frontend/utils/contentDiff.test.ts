import { describe, it, expect } from 'vitest';
import { diffContent } from './contentDiff';

describe('diffContent', () => {
  it('仅格式改动(加标签/加标题编号)→ 内容判定一致', () => {
    const input = '人工智能正在重塑各行各业,本报告梳理当前技术现状与未来趋势。深度学习在图像识别领域取得突破性进展。';
    const output = '<h2>1. 引言</h2><p>人工智能正在重塑各行各业,本报告梳理当前技术现状与未来趋势。</p><p>深度学习在图像识别领域取得突破性进展。</p>';
    const r = diffContent(input, output);
    expect(r.identical).toBe(true);
    expect(r.removed).toHaveLength(0);
    expect(r.retentionPct).toBe(100);
  });

  it('原文剥离旧编号 vs 成稿新编号 → 不误报', () => {
    const input = '一、引言部分介绍了本研究的背景与意义所在。二、相关工作回顾了既往文献的主要结论。';
    const output = '<h2>1. 引言</h2><p>引言部分介绍了本研究的背景与意义所在。</p><h2>2. 相关工作</h2><p>相关工作回顾了既往文献的主要结论。</p>';
    expect(diffContent(input, output).identical).toBe(true);
  });

  it('成稿丢了一句 → 标记为疑似删减', () => {
    const input = '第一句讲的是研究背景与动机非常重要。第二句讲的是方法论的具体设计细节。第三句讲的是实验结论与未来展望。';
    const output = '<p>第一句讲的是研究背景与动机非常重要。</p><p>第三句讲的是实验结论与未来展望。</p>';
    const r = diffContent(input, output);
    expect(r.identical).toBe(false);
    expect(r.removed.some(s => s.includes('方法论的具体设计细节'))).toBe(true);
    expect(r.retentionPct).toBeLessThan(100);
  });

  it('成稿自行补写一句 → 标记为疑似新增', () => {
    const input = '本文研究人工智能在医疗诊断中的应用场景与落地路径。';
    const output = '<p>本文研究人工智能在医疗诊断中的应用场景与落地路径。</p><p>这是模型自行补写的一句多余内容需要被发现。</p>';
    const r = diffContent(input, output);
    expect(r.added.some(s => s.includes('自行补写'))).toBe(true);
  });

  it('短片段(标题/零碎词)不计入,空输入不崩', () => {
    expect(diffContent('', '').identical).toBe(true);
    expect(diffContent('引言', '<h2>引言</h2>').identical).toBe(true); // 短于阈值,忽略
  });
});
