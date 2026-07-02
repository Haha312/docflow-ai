import { DocPreset } from '../types';

const PRESET_ALIASES: Record<string, DocPreset> = {
    corporate: DocPreset.CORPORATE,
    official: DocPreset.CORPORATE,
    'official-document': DocPreset.CORPORATE,
    academic: DocPreset.ACADEMIC,
    'academic-journal': DocPreset.ACADEMIC_JOURNAL,
    creative: DocPreset.CREATIVE,
    publication: DocPreset.CREATIVE,
    'work-report': DocPreset.WORK_REPORT,
    'work-plan': DocPreset.WORK_REPORT,
    'meeting-minutes': DocPreset.MEETING_MINUTES,
    minimalist: DocPreset.MINIMALIST,
    'web-document': DocPreset.MINIMALIST,
};

export const normalizePreset = (preset: string): DocPreset => {
    const key = String(preset || '').trim().toLowerCase().replace(/_/g, '-');
    return PRESET_ALIASES[key] || (Object.values(DocPreset).includes(key as DocPreset) ? key as DocPreset : DocPreset.ACADEMIC);
};
