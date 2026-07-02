import { describe, expect, it } from 'vitest';
import {
  buildIntegrityReport,
  countStructure,
  detectStructuralAnomalies,
  reconcileMissingTables,
  validateFinalIntegrity,
  type StructuralCounts,
} from '../integrity';

describe('countStructure', () => {
  it('counts headings, paragraphs, lists, images, placeholders, and tables', () => {
    const html =
      '<h1 class="doc-title">Document Title</h1>' +
      '<h2>1. Intro</h2><p>First paragraph.</p>' +
      '<h2>2. Status</h2><h3>2.1 Detail</h3><p>Second paragraph.</p>' +
      '<ul><li>Item one</li><li>Item two</li></ul>' +
      '<table><tr><td>Table cell</td></tr></table>' +
      '<p>Third paragraph <img src="x.png"></p>' +
      '<p>__IMG_0__</p>';

    const c = countStructure(html);
    expect(c.headings).toBe(3);
    expect(c.headingsByLevel[2]).toBe(2);
    expect(c.headingsByLevel[3]).toBe(1);
    expect(c.headingsByLevel[1]).toBeUndefined();
    expect(c.paragraphs).toBe(4);
    expect(c.listItems).toBe(2);
    expect(c.images).toBe(2);
    expect(c.tables).toBe(1);
    expect(c.charCount).toBeGreaterThan(0);
  });

  it('uses the larger count between li elements and explicit numbered items', () => {
    expect(countStructure('<li>a</li><li>b</li><li>c</li>').listItems).toBe(3);
    expect(countStructure('(1) A (2) B (3) C (4) D').listItems).toBe(4);
  });

  it('counts plain text characters without inventing structure', () => {
    const c = countStructure('plain text without tags');
    expect(c.headings).toBe(0);
    expect(c.paragraphs).toBe(0);
    expect(c.charCount).toBe('plaintextwithouttags'.length);
  });

  it('returns all zeroes for empty input', () => {
    expect(countStructure('')).toEqual({
      paragraphs: 0,
      headings: 0,
      headingsByLevel: {},
      listItems: 0,
      charCount: 0,
      images: 0,
      tables: 0,
    });
  });
});

describe('buildIntegrityReport', () => {
  const counts = (charCount: number, headings = 0): StructuralCounts => ({
    paragraphs: 0,
    headings,
    headingsByLevel: {},
    listItems: 0,
    charCount,
    images: 0,
    tables: 0,
  });

  it('rounds character retention and matches headings when counts are aligned', () => {
    const r = buildIntegrityReport(counts(100, 5), counts(106, 5), []);
    expect(r.charRetentionPct).toBe(106);
    expect(r.headingsMatched).toBe(true);
    expect(r.truncated).toBe(false);
  });

  it('marks headings unmatched when output has fewer headings', () => {
    expect(buildIntegrityReport(counts(100, 6), counts(90, 4), []).headingsMatched).toBe(false);
  });

  it('marks truncation only for truncation-like issues', () => {
    expect(buildIntegrityReport(counts(100), counts(50), [{ type: 'loop_truncated', severity: 'critical', detail: 'x' }]).truncated).toBe(true);
    expect(buildIntegrityReport(counts(100), counts(99), [{ type: 'chunk_skipped', severity: 'info', detail: 'x' }]).truncated).toBe(false);
  });

  it('uses 100% retention when the input has no text', () => {
    expect(buildIntegrityReport(counts(0), counts(50), []).charRetentionPct).toBe(100);
  });
});

describe('validateFinalIntegrity', () => {
  const counts = (overrides: Partial<StructuralCounts> = {}): StructuralCounts => ({
    paragraphs: 20,
    headings: 3,
    headingsByLevel: { 2: 3 },
    listItems: 10,
    charCount: 2000,
    images: 2,
    tables: 2,
    ...overrides,
  });

  it('detects obvious loss after the whole document is merged', () => {
    const issues = validateFinalIntegrity(
      counts(),
      counts({ paragraphs: 5, listItems: 3, charCount: 1300, images: 1, tables: 1 }),
    );

    expect(issues.map((x) => x.type)).toEqual(expect.arrayContaining([
      'images_reduced',
      'tables_reduced',
      'list_items_reduced',
      'paragraphs_reduced',
      'content_reduced',
    ]));
  });

  it('does not flag normal small structural shifts', () => {
    expect(validateFinalIntegrity(
      counts(),
      counts({ paragraphs: 16, listItems: 8, charCount: 1950, images: 2, tables: 2 }),
    )).toHaveLength(0);
  });
});

describe('reconcileMissingTables', () => {
  it('appends source tables that are missing from output', () => {
    const source = '<p>A</p><table><tr><td>Kept</td></tr></table><table><tr><td>Missing</td></tr></table>';
    const output = '<p>A</p><table><tr><td>Kept</td></tr></table>';
    const repaired = reconcileMissingTables(source, output);

    expect(repaired.text).toContain('Missing');
    expect(repaired.text).toContain('未能定位到原位置的表格');
    expect(repaired.issues.some((x) => x.type === 'table_missing')).toBe(true);
  });

  it('does not change output when all tables are present', () => {
    const source = '<table><tr><td>Only table</td></tr></table>';
    const output = '<p>Styled</p><table><tr><td>Only table</td></tr></table>';
    expect(reconcileMissingTables(source, output)).toEqual({ text: output, issues: [] });
  });
});

describe('detectStructuralAnomalies', () => {
  it('accepts a single document title', () => {
    expect(detectStructuralAnomalies('<h1 class="doc-title">Title</h1><h2>Chapter</h2>')).toHaveLength(0);
  });

  it('flags multiple document titles', () => {
    const issues = detectStructuralAnomalies('<h1 class="doc-title">A</h1><h2>x</h2><h1 class="doc-title">B</h1>');
    expect(issues.some((x) => x.type === 'multiple_titles' && x.severity === 'critical')).toBe(true);
  });

  it('flags the document title repeated as a section heading', () => {
    const html = '<h1 class="doc-title">Platform Design</h1><h2>Goals</h2><h2>Platform Design</h2>';
    const issues = detectStructuralAnomalies(html);
    expect(issues.some((x) => x.type === 'title_text_duplicated_as_heading' && x.severity === 'critical')).toBe(true);
  });

  it('accepts normal section headings', () => {
    const html = '<h1 class="doc-title">Notice</h1><h2>1. Intro</h2><h2>2. Status</h2>';
    expect(detectStructuralAnomalies(html)).toHaveLength(0);
  });
});
