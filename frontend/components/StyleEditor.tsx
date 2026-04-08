
import React from 'react';
import { StyleConfig, NumberingStyle, FigureNumberingStyle, DocPreset } from '../types';
import { FONT_FAMILY_OPTIONS, FONT_SIZE_OPTIONS, SPACING_OPTIONS, ALIGNMENT_OPTIONS, FIGURE_NUMBERING_OPTIONS, TABLE_NUMBERING_OPTIONS, TEXT_INDENT_OPTIONS } from '../constants';
import { useTranslation } from 'react-i18next';
import i18n from '../i18n';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    config: StyleConfig;
    onUpdate: (newConfig: StyleConfig) => void;
    presetTitle: string;
    presetId?: string;
    defaultConfig?: StyleConfig;
}

export const StyleEditor: React.FC<Props> = ({ isOpen, onClose, config, onUpdate, presetTitle, presetId, defaultConfig }) => {
    const { t } = useTranslation();
    if (!isOpen) return null;

    // Determine if we are editing the Journal preset to show extra fields
    // Use presetId (enum value) for reliable detection regardless of display language
    const isJournal = presetId === 'ACADEMIC_JOURNAL' || presetTitle.includes("学术期刊") || presetTitle.includes("Journal");
    const isCorporate = presetId === 'CORPORATE' || presetTitle.includes("商务公文") || presetTitle.includes("Corporate");

    const handleChange = (key: keyof StyleConfig, value: string | boolean) => {
        onUpdate({ ...config, [key]: value });
    };

    const renderSelect = (
        label: string,
        value: string | undefined,
        onChange: (val: string) => void,
        options: { label: string; value: string }[]
    ) => (
        <div>
            <span className="text-xs text-zinc-500 block mb-1.5">{label}</span>
            <div className="relative">
                <select
                    value={value || options[0].value}
                    onChange={(e) => onChange(e.target.value)}
                    className="w-full text-sm p-2.5 pr-8 border border-zinc-200 rounded-lg bg-zinc-50 focus:border-indigo-500 outline-none appearance-none truncate"
                >
                    {options.map((opt) => {
                        // Create translation keys by stripping logic text
                        // e.g. "两端对齐" -> "align_justify"
                        // Since many strings are complex, it's safer to map directly via an exact dictionary match or keep it simple.
                        // We added these exactly to zh.json/en.json under "styles".

                        const translations: Record<string, string> = {
                            "两端对齐": "align_justify",
                            "左对齐": "align_left",
                            "居中对齐": "align_center",
                            "右对齐": "align_right",
                            "无": "indent_none",
                            "2字符 (2em)": "indent_2em",
                            "4字符 (4em)": "indent_4em",
                            "28磅 (约1厘米)": "indent_28pt",
                            "顺序编号 (图1, 图2)": "fig_num_seq",
                            "章节编号 (图1-1, 图2-1)": "fig_num_chap",
                            "顺序编号 (表1, 表2)": "tab_num_seq",
                            "章节编号 (表1-1, 表2-1)": "tab_num_chap"
                        };

                        let displayLabel = opt.label;
                        const transKey = translations[opt.label];

                        if (transKey) {
                            displayLabel = t(`styles.${transKey}`, opt.label);
                        } else if (i18n.language.startsWith('en')) {
                            // Extract English part from fonts and sizes, e.g. "宋体 (SimSun)" -> "SimSun", "一号 (26pt)" -> "26pt"
                            const parenMatch = opt.label.match(/\((.*?)\)/);
                            if (parenMatch) {
                                displayLabel = parenMatch[1];
                            } else if (opt.label.endsWith('行')) {
                                displayLabel = opt.label.replace('行', ' lines');
                            } else if (opt.label.endsWith('磅')) {
                                displayLabel = opt.label.replace('磅', ' pt');
                            }
                        }

                        return (
                            <option key={opt.value} value={opt.value}>
                                {displayLabel}
                            </option>
                        );
                    })}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-zinc-500">
                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                </div>
            </div>
        </div>
    );

    // Helper to get translated label for any option
    const getOptionLabel = (label: string): string => {
        if (!i18n.language.startsWith('en')) return label;
        const parenMatch = label.match(/\((.+?)\)/);
        if (parenMatch) return parenMatch[1];
        if (label.endsWith('行')) return label.replace('行', ' lines');
        if (label.endsWith('磅')) return label.replace('磅', ' pt');
        return label;
    };

    const renderHeadingStyleRow = (
        label: string,
        sizeKey: 'h1Size' | 'h2Size' | 'h3Size' | 'h4Size' | 'h5Size' | 'h6Size',
        boldKey: 'h1Bold' | 'h2Bold' | 'h3Bold' | 'h4Bold' | 'h5Bold' | 'h6Bold',
        italicKey: 'h1Italic' | 'h2Italic' | 'h3Italic' | 'h4Italic' | 'h5Italic' | 'h6Italic',
        fontKey?: keyof StyleConfig // Allow any style key to be passed for font
    ) => {
        return (
            <div>
                <span className="text-xs text-zinc-500 block mb-1.5">{label}</span>
                <div className="flex flex-col gap-2">
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <select
                                value={config[sizeKey] as string}
                                onChange={(e) => handleChange(sizeKey, e.target.value)}
                                className="w-full text-sm p-2.5 pr-6 border border-zinc-200 rounded-lg bg-zinc-50 focus:border-indigo-500 outline-none appearance-none truncate"
                            >
                                {FONT_SIZE_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{getOptionLabel(opt.label)}</option>
                                ))}
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1 text-zinc-500">
                                <svg className="fill-current h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                            </div>
                        </div>
                        <div className="flex bg-zinc-50 border border-zinc-200 rounded-lg p-1 gap-1">
                            <button
                                onClick={() => handleChange(boldKey, !config[boldKey])}
                                className={`w-8 flex items-center justify-center rounded text-sm font-serif font-bold transition-all ${config[boldKey] ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-800 hover:bg-zinc-200'}`}
                                title="Bold"
                            >
                                B
                            </button>
                            <button
                                onClick={() => handleChange(italicKey, !config[italicKey])}
                                className={`w-8 flex items-center justify-center rounded text-sm font-serif italic transition-all ${config[italicKey] ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-800 hover:bg-zinc-200'}`}
                                title="Italic"
                            >
                                I
                            </button>
                        </div>
                    </div>

                    {/* Font Override for Journal Headings */}
                    {fontKey && isJournal && (
                        <div className="relative">
                            <select
                                value={(config[fontKey] as string) || config.headingFont}
                                onChange={(e) => handleChange(fontKey, e.target.value)}
                                className="w-full text-xs p-2 pr-6 border border-zinc-200 rounded-lg bg-zinc-50/50 text-zinc-600 focus:border-indigo-500 outline-none appearance-none truncate"
                            >
                                {FONT_FAMILY_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{getOptionLabel(opt.label)}</option>
                                ))}
                            </select>
                            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1 text-zinc-400">
                                <svg className="fill-current h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm transition-opacity p-6">
            <div className="bg-white w-full max-w-[1000px] h-[85vh] rounded-2xl shadow-2xl flex flex-col animate-in zoom-in-95 duration-200 overflow-hidden">
                {/* Header */}
                <div className="px-8 py-5 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/80 backdrop-blur shrink-0">
                    <div>
                        <h3 className="font-bold text-xl text-zinc-900">{t('styles.title')}</h3>
                        <p className="text-sm text-zinc-500 mt-1">{t('styles.current_preset')} <span className="font-medium text-indigo-600">{presetTitle}</span></p>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-zinc-200 rounded-full text-zinc-500 transition-colors">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    <div className="p-8 space-y-8">

                        {/* 1. Top Section: Document Structure (Full Width) */}
                        <section className="space-y-4">
                            <div className="flex items-center gap-3 mb-2">
                                <div className="p-1.5 bg-indigo-100/50 rounded-lg text-indigo-600">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
                                </div>
                                <h4 className="font-bold text-zinc-900">{t('styles.doc_structure')}</h4>
                            </div>

                            <div className="bg-zinc-50/50 rounded-xl border border-zinc-200/60 p-5 space-y-5">
                                <div className="max-w-md">
                                    <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider block mb-2">{t('styles.heading_numbering_style')}</span>
                                    <div className="relative">
                                        <select
                                            value={config.headingNumbering}
                                            onChange={(e) => handleChange('headingNumbering', e.target.value as NumberingStyle)}
                                            className="w-full text-sm p-3 pr-8 border border-zinc-200 rounded-lg bg-white focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none transition-all appearance-none"
                                        >
                                            <option value="none">{t('styles.num_none')}</option>
                                            <option value="chinese-hierarchical">{t('styles.num_chinese')}</option>
                                            <option value="decimal-nested">{t('styles.num_decimal_nested')}</option>
                                            <option value="decimal">{t('styles.num_decimal')}</option>
                                            <option value="chapter">{t('styles.num_chapter')}</option>
                                        </select>
                                        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-zinc-500">
                                            <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                                        </div>
                                    </div>
                                </div>

                                {/* 生成目录开关 — 公文/期刊不需要目录 */}
                                {!isCorporate && !isJournal && (
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">{t('styles.generate_toc', '导出时生成目录')}</span>
                                        <button
                                            onClick={() => handleChange('generateToc', !config.generateToc)}
                                            className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${config.generateToc ? 'bg-indigo-600' : 'bg-zinc-200'}`}
                                            role="switch"
                                            aria-checked={!!config.generateToc}
                                            title={t('styles.generate_toc_desc', '下载 .docx 时自动在正文前插入目录页')}
                                        >
                                            <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${config.generateToc ? 'translate-x-4' : 'translate-x-0'}`} />
                                        </button>
                                    </div>
                                )}

                                {isCorporate ? (
                                    /* 公文：格式固定，只保留正文对齐和首行缩进 */
                                    <div className="grid grid-cols-2 gap-6">
                                        {renderSelect(t('styles.align_body'), config.bodyAlign, (v) => handleChange('bodyAlign', v), ALIGNMENT_OPTIONS)}
                                        {renderSelect(t('styles.indent_body'), config.textIndent, (v) => handleChange('textIndent', v), TEXT_INDENT_OPTIONS)}
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-4 gap-6">
                                        {renderSelect(t('styles.align_h1'), config.h1Align, (v) => handleChange('h1Align', v), ALIGNMENT_OPTIONS)}
                                        {renderSelect(t('styles.align_h2'), config.h2Align, (v) => handleChange('h2Align', v), ALIGNMENT_OPTIONS)}
                                        {renderSelect(t('styles.indent_h1'), config.h1Indent, (v) => handleChange('h1Indent', v), TEXT_INDENT_OPTIONS)}
                                        {renderSelect(t('styles.indent_h2'), config.h2Indent, (v) => handleChange('h2Indent', v), TEXT_INDENT_OPTIONS)}

                                        {renderSelect(t('styles.align_body'), config.bodyAlign, (v) => handleChange('bodyAlign', v), ALIGNMENT_OPTIONS)}
                                        {renderSelect(t('styles.indent_body'), config.textIndent, (v) => handleChange('textIndent', v), TEXT_INDENT_OPTIONS)}

                                        {!isJournal && (
                                            <>
                                                {renderSelect(t('styles.indent_h3'), config.h3Indent, (v) => handleChange('h3Indent', v), TEXT_INDENT_OPTIONS)}
                                                {renderSelect(t('styles.indent_h4'), config.h4Indent, (v) => handleChange('h4Indent', v), TEXT_INDENT_OPTIONS)}
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        </section>

                        {/* Layout: journal→2 stacked rows, corporate→vertical, others→2-col */}
                        <div className={!isCorporate && !isJournal ? "grid grid-cols-2 gap-8 items-start" : "space-y-8"}>

                            {isJournal ? (
                                /* ── Journal Row 1: Typography (left) | Journal Config (right) ── */
                                <div className="grid grid-cols-2 gap-8 items-start">
                                    {/* Typography */}
                                    <section className="space-y-4">
                                        <div className="flex items-center gap-3 mb-2">
                                            <div className="p-1.5 bg-indigo-100/50 rounded-lg text-indigo-600">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7V4h16v3"></path><path d="M9 20h6"></path><path d="M12 4v16"></path></svg>
                                            </div>
                                            <h4 className="font-bold text-zinc-900">{t('styles.typography_journal')}</h4>
                                        </div>
                                        <div className="space-y-5">
                                            <div className="grid grid-cols-2 gap-4">
                                                {renderSelect(t('styles.font_heading_def'), config.headingFont, (v) => handleChange('headingFont', v), FONT_FAMILY_OPTIONS)}
                                                {renderSelect(t('styles.font_body'), config.fontFamily, (v) => handleChange('fontFamily', v), FONT_FAMILY_OPTIONS)}
                                            </div>
                                            <div className="grid grid-cols-2 gap-x-4 gap-y-6">
                                                {renderHeadingStyleRow(t('styles.journal_h1', '论文标题'), 'h1Size', 'h1Bold', 'h1Italic', 'h1Font')}
                                                {renderHeadingStyleRow(t('styles.journal_h2', '一级节标题'), 'h2Size', 'h2Bold', 'h2Italic', 'h2Font')}
                                                {renderHeadingStyleRow(t('styles.journal_h3', '二级节标题'), 'h3Size', 'h3Bold', 'h3Italic', 'h3Font')}
                                            </div>
                                            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-zinc-100">
                                                {renderSelect(t('styles.size_body'), config.baseSize, (v) => handleChange('baseSize', v), FONT_SIZE_OPTIONS)}
                                                <div>
                                                    <span className="text-xs text-zinc-500 block mb-1.5">{t('styles.line_height')}</span>
                                                    <input
                                                        type="text"
                                                        value={config.lineHeight}
                                                        onChange={(e) => handleChange('lineHeight', e.target.value)}
                                                        className="w-full text-sm p-2.5 border border-zinc-200 rounded-lg bg-zinc-50 focus:border-indigo-500 outline-none"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </section>

                                    {/* Journal Config */}
                                    <section className="space-y-4">
                                        <div className="flex items-center gap-3 mb-2">
                                            <div className="p-1.5 bg-blue-100/50 rounded-lg text-blue-600">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path></svg>
                                            </div>
                                            <h4 className="font-bold text-blue-900">{t('styles.journal_config')}</h4>
                                        </div>
                                        <div className="bg-blue-50/30 p-5 rounded-xl border border-blue-100/60 space-y-4">
                                            <div className="grid grid-cols-2 gap-3">
                                                {renderSelect(t('styles.en_title_font'), config.englishTitleFont, (v) => handleChange('englishTitleFont', v), FONT_FAMILY_OPTIONS)}
                                                {renderSelect(t('styles.en_title_size'), config.englishTitleSize, (v) => handleChange('englishTitleSize', v), FONT_SIZE_OPTIONS)}
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                {renderSelect(t('styles.author_font'), config.authorFont, (v) => handleChange('authorFont', v), FONT_FAMILY_OPTIONS)}
                                                {renderSelect(t('styles.author_size'), config.authorSize, (v) => handleChange('authorSize', v), FONT_SIZE_OPTIONS)}
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                                {renderSelect(t('styles.affil_font'), config.affiliationFont, (v) => handleChange('affiliationFont', v), FONT_FAMILY_OPTIONS)}
                                                {renderSelect(t('styles.affil_size'), config.affiliationSize, (v) => handleChange('affiliationSize', v), FONT_SIZE_OPTIONS)}
                                            </div>
                                            <div className="pt-3 border-t border-blue-200/50">
                                                <span className="text-xs font-bold text-blue-800/70 block mb-3">{t('styles.abstract_settings')}</span>
                                                <div className="grid grid-cols-2 gap-3 mb-3">
                                                    {renderSelect(t('styles.zh_abs_font'), config.abstractFont, (v) => handleChange('abstractFont', v), FONT_FAMILY_OPTIONS)}
                                                    {renderSelect(t('styles.zh_abs_size'), config.abstractSize, (v) => handleChange('abstractSize', v), FONT_SIZE_OPTIONS)}
                                                </div>
                                                <div className="grid grid-cols-2 gap-3">
                                                    {renderSelect(t('styles.en_abs_font'), config.englishAbstractFont, (v) => handleChange('englishAbstractFont', v), FONT_FAMILY_OPTIONS)}
                                                    {renderSelect(t('styles.en_abs_size'), config.englishAbstractSize, (v) => handleChange('englishAbstractSize', v), FONT_SIZE_OPTIONS)}
                                                </div>
                                            </div>
                                        </div>
                                    </section>
                                </div>
                            ) : (
                                /* ── Non-journal Left Column: Typography + optional Spacing ── */
                                <div className="space-y-8">
                                    <section className="space-y-4">
                                        <div className="flex items-center gap-3 mb-2">
                                            <div className="p-1.5 bg-indigo-100/50 rounded-lg text-indigo-600">
                                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7V4h16v3"></path><path d="M9 20h6"></path><path d="M12 4v16"></path></svg>
                                            </div>
                                            <h4 className="font-bold text-zinc-900">{t('styles.typography_spacing')}</h4>
                                        </div>
                                        <div className="space-y-5">
                                            <div className="grid grid-cols-2 gap-4">
                                                {renderSelect(t('styles.font_heading_def'), config.headingFont, (v) => handleChange('headingFont', v), FONT_FAMILY_OPTIONS)}
                                                {renderSelect(t('styles.font_body'), config.fontFamily, (v) => handleChange('fontFamily', v), FONT_FAMILY_OPTIONS)}
                                            </div>
                                            <div className={`grid gap-x-4 gap-y-6 ${isCorporate ? 'grid-cols-4' : 'grid-cols-2'}`}>
                                                {isCorporate ? (
                                                    <>
                                                        {renderHeadingStyleRow('发文标题', 'h1Size', 'h1Bold', 'h1Italic')}
                                                        {renderHeadingStyleRow('一级条目', 'h2Size', 'h2Bold', 'h2Italic')}
                                                        {renderHeadingStyleRow('二级条目', 'h3Size', 'h3Bold', 'h3Italic')}
                                                        {renderHeadingStyleRow('三级条目', 'h4Size', 'h4Bold', 'h4Italic')}
                                                    </>
                                                ) : (
                                                    <>
                                                        {renderHeadingStyleRow(t('styles.h1'), 'h1Size', 'h1Bold', 'h1Italic')}
                                                        {renderHeadingStyleRow(t('styles.h2'), 'h2Size', 'h2Bold', 'h2Italic')}
                                                        {renderHeadingStyleRow(t('styles.h3'), 'h3Size', 'h3Bold', 'h3Italic')}
                                                        {renderHeadingStyleRow(t('styles.h4'), 'h4Size', 'h4Bold', 'h4Italic')}
                                                        {renderHeadingStyleRow(t('styles.h5'), 'h5Size', 'h5Bold', 'h5Italic')}
                                                        {renderHeadingStyleRow(t('styles.h6'), 'h6Size', 'h6Bold', 'h6Italic')}
                                                    </>
                                                )}
                                            </div>
                                            <div className="grid grid-cols-2 gap-4 pt-2 border-t border-zinc-100">
                                                {renderSelect(t('styles.size_body'), config.baseSize, (v) => handleChange('baseSize', v), FONT_SIZE_OPTIONS)}
                                                <div>
                                                    <span className="text-xs text-zinc-500 block mb-1.5">
                                                        {t('styles.line_height')}
                                                        {isCorporate && <span className="ml-1 text-zinc-400 font-normal normal-case">（默认 28磅 / GB/T 9704）</span>}
                                                    </span>
                                                    <input
                                                        type="text"
                                                        value={config.lineHeight}
                                                        onChange={(e) => handleChange('lineHeight', e.target.value)}
                                                        className="w-full text-sm p-2.5 border border-zinc-200 rounded-lg bg-zinc-50 focus:border-indigo-500 outline-none"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    </section>

                                    {/* Spacing — not for corporate */}
                                    {!isCorporate && (
                                        <section className="space-y-4">
                                            <div className="flex items-center gap-3 mb-2">
                                                <div className="p-1.5 bg-indigo-100/50 rounded-lg text-indigo-600">
                                                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v18"></path><rect x="6" y="8" width="12" height="8" rx="1"></rect></svg>
                                                </div>
                                                <h4 className="font-bold text-zinc-900">{t('styles.paragraph_spacing')}</h4>
                                            </div>
                                            <div className="bg-zinc-50/50 rounded-xl border border-zinc-200/60 p-5">
                                                <div className="grid grid-cols-2 gap-4">
                                                    {renderSelect(t('styles.space_before'), config.spacingBefore, (v) => handleChange('spacingBefore', v), SPACING_OPTIONS)}
                                                    {renderSelect(t('styles.space_after'), config.spacingAfter, (v) => handleChange('spacingAfter', v), SPACING_OPTIONS)}
                                                </div>
                                            </div>
                                        </section>
                                    )}
                                </div>
                            )}

                            {/* ── Row 2 / Right Column: Figures + Tables ── */}
                            {/* journal/corporate: side-by-side grid; others: stacked in right col */}
                            <div className={isCorporate || isJournal ? "grid grid-cols-2 gap-8 items-stretch" : "space-y-8"}>
                                {/* Figures */}
                                <section className="space-y-4 flex flex-col">
                                    <div className="flex items-center gap-3 mb-2">
                                        <div className="p-1.5 bg-indigo-100/50 rounded-lg text-indigo-600">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                                        </div>
                                        <h4 className="font-bold text-zinc-900">{t('styles.figures')}</h4>
                                    </div>
                                    <div className="flex-1 p-5 bg-zinc-50/50 rounded-xl border border-zinc-200/60 space-y-4">
                                        <div>
                                            <span className="text-xs text-zinc-500 block mb-1.5">{t('styles.numbering_mode')}</span>
                                            <div className="relative">
                                                <select
                                                    value={config.figureNumbering}
                                                    onChange={(e) => handleChange('figureNumbering', e.target.value as FigureNumberingStyle)}
                                                    className="w-full text-sm p-2.5 border border-zinc-200 rounded-lg bg-white focus:border-indigo-500 outline-none appearance-none"
                                                >
                                                    {FIGURE_NUMBERING_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.value === 'sequential' ? t('styles.fig_num_seq') : t('styles.fig_num_chap')}</option>)}
                                                </select>
                                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-zinc-500">
                                                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            {renderSelect(t('styles.fig_font'), config.figureFont, (v) => handleChange('figureFont', v), FONT_FAMILY_OPTIONS)}
                                            {renderSelect(t('styles.fig_size'), config.figureSize, (v) => handleChange('figureSize', v), FONT_SIZE_OPTIONS)}
                                        </div>
                                        <div>
                                            {renderSelect(t('styles.fig_align'), config.figureAlign, (v) => handleChange('figureAlign', v), ALIGNMENT_OPTIONS)}
                                        </div>
                                    </div>
                                </section>

                                {/* Tables */}
                                <section className="space-y-4 flex flex-col">
                                    <div className="flex items-center gap-3 mb-2">
                                        <div className="p-1.5 bg-indigo-100/50 rounded-lg text-indigo-600">
                                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"></path></svg>
                                        </div>
                                        <h4 className="font-bold text-zinc-900">{t('styles.tables')}</h4>
                                    </div>
                                    <div className="flex-1 p-5 bg-zinc-50/50 rounded-xl border border-zinc-200/60 space-y-4">
                                        <div>
                                            <span className="text-xs text-zinc-500 block mb-1.5">{t('styles.tab_num_mode')}</span>
                                            <div className="relative">
                                                <select
                                                    value={config.tableNumbering}
                                                    onChange={(e) => handleChange('tableNumbering', e.target.value as FigureNumberingStyle)}
                                                    className="w-full text-sm p-2.5 border border-zinc-200 rounded-lg bg-white focus:border-indigo-500 outline-none appearance-none"
                                                >
                                                    {TABLE_NUMBERING_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.value === 'sequential' ? t('styles.tab_num_seq') : t('styles.tab_num_chap')}</option>)}
                                                </select>
                                                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-zinc-500">
                                                    <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z" /></svg>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3">
                                            {renderSelect(t('styles.tab_cap_font'), config.tableCaptionFont, (v) => handleChange('tableCaptionFont', v), FONT_FAMILY_OPTIONS)}
                                            {renderSelect(t('styles.tab_cap_size'), config.tableCaptionSize, (v) => handleChange('tableCaptionSize', v), FONT_SIZE_OPTIONS)}
                                        </div>
                                        <hr className="border-zinc-200 border-dashed my-2" />
                                        <div className="grid grid-cols-2 gap-3">
                                            {renderSelect(t('styles.tab_content_font'), config.tableFont, (v) => handleChange('tableFont', v), FONT_FAMILY_OPTIONS)}
                                            {renderSelect(t('styles.tab_content_size'), config.tableSize, (v) => handleChange('tableSize', v), FONT_SIZE_OPTIONS)}
                                        </div>
                                    </div>
                                </section>
                            </div>
                        </div>

                    </div>
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-zinc-100 bg-white shrink-0 flex justify-between items-center">
                    <button
                        onClick={() => defaultConfig && onUpdate({ ...defaultConfig })}
                        disabled={!defaultConfig}
                        className="px-4 py-2 text-sm border rounded-xl transition-all disabled:opacity-30 disabled:cursor-not-allowed text-zinc-500 hover:text-zinc-800 border-zinc-200 hover:border-zinc-300"
                        title={!defaultConfig ? t('styles.no_default', '当前预设无默认配置') : undefined}
                    >
                        {t('styles.reset_defaults', '恢复默认')}
                    </button>
                    <button
                        onClick={onClose}
                        className="px-8 py-2.5 bg-zinc-900 text-white rounded-xl text-sm font-bold hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200/50 hover:shadow-xl hover:shadow-zinc-200/50 transform hover:-translate-y-0.5 active:translate-y-0"
                    >
                        {t('styles.confirm_btn')}
                    </button>
                </div>
            </div>
        </div>
    );
};