import { describe, it, expect } from 'vitest';
import { evaluateCompliance } from './compliance';
import { PRESETS } from '../constants';
import { DocPreset, StyleConfig } from '../types';

const styleOf = (id: DocPreset): StyleConfig => PRESETS.find(p => p.id === id)!.styleConfig;

describe('evaluateCompliance', () => {
  it('公文预设(含阶段0页边距)全部达标 GB/T 9704', () => {
    const { spec, results } = evaluateCompliance(DocPreset.CORPORATE, styleOf(DocPreset.CORPORATE));
    expect(spec?.standardId).toBe('GB9704');
    const failed = results.filter(r => !r.pass);
    expect(failed, `偏离项: ${failed.map(f => f.label).join(', ')}`).toHaveLength(0);
    // 关键项点名校验
    expect(results.find(r => r.id === 'line')?.pass).toBe(true); // 28pt
    expect(results.find(r => r.id === 'mTop')?.pass).toBe(true);  // 3.7cm(阶段0 修复)
  });

  it('论文预设映射到 THESIS 且达标', () => {
    const { spec, results } = evaluateCompliance(DocPreset.ACADEMIC, styleOf(DocPreset.ACADEMIC));
    expect(spec?.standardId).toBe('THESIS');
    expect(results.filter(r => !r.pass)).toHaveLength(0);
  });

  it('无对标标准的预设返回 spec=null', () => {
    expect(evaluateCompliance(DocPreset.CREATIVE, styleOf(DocPreset.CREATIVE)).spec).toBeNull();
    expect(evaluateCompliance(DocPreset.MINIMALIST, styleOf(DocPreset.MINIMALIST)).spec).toBeNull();
  });

  it('用户偏离标准时对应项翻为不达标', () => {
    const tampered: StyleConfig = { ...styleOf(DocPreset.CORPORATE), lineHeight: '1.5' }; // 改掉 28pt
    const { results } = evaluateCompliance(DocPreset.CORPORATE, tampered);
    expect(results.find(r => r.id === 'line')?.pass).toBe(false);
    expect(results.find(r => r.id === 'line')?.expected).toBe('28pt');
  });

  it('缺页边距(旧数据)时边距项不达标,不崩', () => {
    const noMargin = { ...styleOf(DocPreset.CORPORATE) };
    delete (noMargin as any).pageMargins;
    const { results } = evaluateCompliance(DocPreset.CORPORATE, noMargin);
    expect(results.find(r => r.id === 'mTop')?.pass).toBe(false);
    expect(results.find(r => r.id === 'mTop')?.actual).toBe('默认');
  });
});
