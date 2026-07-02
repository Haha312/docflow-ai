import { describe, expect, it } from 'vitest';
import { DocPreset } from '../../types';
import { normalizePreset } from '../preset';

describe('normalizePreset', () => {
    it('accepts frontend enum names and backend enum values', () => {
        expect(normalizePreset('ACADEMIC_JOURNAL')).toBe(DocPreset.ACADEMIC_JOURNAL);
        expect(normalizePreset('academic_journal')).toBe(DocPreset.ACADEMIC_JOURNAL);
        expect(normalizePreset('academic-journal')).toBe(DocPreset.ACADEMIC_JOURNAL);
        expect(normalizePreset('CORPORATE')).toBe(DocPreset.CORPORATE);
        expect(normalizePreset('WORK_REPORT')).toBe(DocPreset.WORK_REPORT);
        expect(normalizePreset('work-report')).toBe(DocPreset.WORK_REPORT);
        expect(normalizePreset('MEETING_MINUTES')).toBe(DocPreset.MEETING_MINUTES);
        expect(normalizePreset('meeting-minutes')).toBe(DocPreset.MEETING_MINUTES);
    });
});
