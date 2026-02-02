
import React from 'react';
import { StyleConfig, NumberingStyle, FigureNumberingStyle, DocPreset } from '../types';
import { FONT_FAMILY_OPTIONS, FONT_SIZE_OPTIONS, SPACING_OPTIONS, ALIGNMENT_OPTIONS, FIGURE_NUMBERING_OPTIONS, TABLE_NUMBERING_OPTIONS, TEXT_INDENT_OPTIONS } from '../constants';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  config: StyleConfig;
  onUpdate: (newConfig: StyleConfig) => void;
  presetTitle: string;
}

export const StyleEditor: React.FC<Props> = ({ isOpen, onClose, config, onUpdate, presetTitle }) => {
  if (!isOpen) return null;
  
  // Determine if we are editing the Journal preset to show extra fields
  const isJournal = presetTitle.includes("学术期刊");

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
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-zinc-500">
           <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
        </div>
      </div>
    </div>
  );

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
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1 text-zinc-500">
                    <svg className="fill-current h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
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
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1 text-zinc-400">
                       <svg className="fill-current h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                    </div>
                </div>
            )}
         </div>
       </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/20 backdrop-blur-[2px] transition-opacity">
      <div className="bg-white w-96 h-full shadow-2xl border-l border-zinc-200 flex flex-col animate-in slide-in-from-right duration-300">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/80 backdrop-blur">
          <div>
            <h3 className="font-bold text-lg text-zinc-900">高级排版配置</h3>
            <p className="text-xs text-zinc-500 mt-1">当前预设: {presetTitle}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-zinc-200 rounded-full text-zinc-500 transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          
          {/* Section: Structure */}
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-xs font-bold text-indigo-600 uppercase tracking-wider">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>
              文档结构与编号
            </label>
            <div>
              <span className="text-sm font-medium block mb-2 text-zinc-700">标题自动编号风格</span>
              <div className="relative">
                <select 
                  value={config.headingNumbering} 
                  onChange={(e) => handleChange('headingNumbering', e.target.value as NumberingStyle)}
                  className="w-full text-sm p-3 pr-8 border border-zinc-200 rounded-lg bg-zinc-50 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 outline-none transition-all appearance-none"
                >
                  <option value="none">无编号 (纯文本标题)</option>
                  <option value="chinese-hierarchical">公文式 (一、 / (一) / 1.)</option>
                  <option value="decimal-nested">学术式 (1. / 1.1 / 1.1.1)</option>
                  <option value="decimal">简单数字 (1. / 2. / 3.)</option>
                  <option value="chapter">章节式 (第一章 / 第一节)</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-zinc-500">
                  <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                </div>
              </div>
            </div>
            
            {/* Alignment Controls */}
            <div className="grid grid-cols-2 gap-3">
                 {renderSelect('一级标题对齐', config.h1Align, (v) => handleChange('h1Align', v), ALIGNMENT_OPTIONS)}
                 {renderSelect('二级标题对齐', config.h2Align, (v) => handleChange('h2Align', v), ALIGNMENT_OPTIONS)}
                 {renderSelect('正文对齐', config.bodyAlign, (v) => handleChange('bodyAlign', v), ALIGNMENT_OPTIONS)}
                 {renderSelect('正文首行缩进', config.textIndent, (v) => handleChange('textIndent', v), TEXT_INDENT_OPTIONS)}
            </div>

            {/* Heading Indent Controls */}
            <div className="grid grid-cols-2 gap-3">
                 {renderSelect('一级标题缩进', config.h1Indent, (v) => handleChange('h1Indent', v), TEXT_INDENT_OPTIONS)}
                 {renderSelect('二级标题缩进', config.h2Indent, (v) => handleChange('h2Indent', v), TEXT_INDENT_OPTIONS)}
                 {/* Only show H3-H6 indent for non-journal presets to avoid clutter */}
                 {!isJournal && (
                   <>
                     {renderSelect('三级标题缩进', config.h3Indent, (v) => handleChange('h3Indent', v), TEXT_INDENT_OPTIONS)}
                     {renderSelect('四级标题缩进', config.h4Indent, (v) => handleChange('h4Indent', v), TEXT_INDENT_OPTIONS)}
                     {renderSelect('五级标题缩进', config.h5Indent, (v) => handleChange('h5Indent', v), TEXT_INDENT_OPTIONS)}
                     {renderSelect('六级标题缩进', config.h6Indent, (v) => handleChange('h6Indent', v), TEXT_INDENT_OPTIONS)}
                   </>
                 )}
            </div>
          </div>

          <hr className="border-zinc-100" />
          
          {/* Section: Journal Specifics (Conditional) */}
          {isJournal && (
             <>
               <div className="space-y-4">
                  <label className="flex items-center gap-2 text-xs font-bold text-blue-600 uppercase tracking-wider">
                     <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 19l7-7 3 3-7 7-3-3z"></path><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"></path></svg>
                     期刊专用配置
                  </label>
                  <div className="bg-blue-50/50 p-4 rounded-xl border border-blue-100 space-y-4">
                     <div className="grid grid-cols-2 gap-3">
                        {renderSelect('英文标题字体', config.englishTitleFont, (v) => handleChange('englishTitleFont', v), FONT_FAMILY_OPTIONS)}
                        {renderSelect('英文标题字号', config.englishTitleSize, (v) => handleChange('englishTitleSize', v), FONT_SIZE_OPTIONS)}
                     </div>
                     <div className="grid grid-cols-2 gap-3">
                        {renderSelect('作者字体', config.authorFont, (v) => handleChange('authorFont', v), FONT_FAMILY_OPTIONS)}
                        {renderSelect('作者字号', config.authorSize, (v) => handleChange('authorSize', v), FONT_SIZE_OPTIONS)}
                     </div>
                     <div className="grid grid-cols-2 gap-3">
                        {renderSelect('单位字体', config.affiliationFont, (v) => handleChange('affiliationFont', v), FONT_FAMILY_OPTIONS)}
                        {renderSelect('单位字号', config.affiliationSize, (v) => handleChange('affiliationSize', v), FONT_SIZE_OPTIONS)}
                     </div>
                     
                     <div className="pt-2 border-t border-blue-200/50">
                        <span className="text-xs font-bold text-blue-800 block mb-3">摘要设置</span>
                        <div className="grid grid-cols-2 gap-3 mb-3">
                            {renderSelect('中文摘要字体', config.abstractFont, (v) => handleChange('abstractFont', v), FONT_FAMILY_OPTIONS)}
                            {renderSelect('中文摘要字号', config.abstractSize, (v) => handleChange('abstractSize', v), FONT_SIZE_OPTIONS)}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            {renderSelect('英文摘要字体', config.englishAbstractFont, (v) => handleChange('englishAbstractFont', v), FONT_FAMILY_OPTIONS)}
                            {renderSelect('英文摘要字号', config.englishAbstractSize, (v) => handleChange('englishAbstractSize', v), FONT_SIZE_OPTIONS)}
                        </div>
                     </div>
                  </div>
               </div>
               <hr className="border-zinc-100" />
             </>
          )}

          {/* Section: Fonts */}
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-xs font-bold text-indigo-600 uppercase tracking-wider">
               <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7V4h16v3"></path><path d="M9 20h6"></path><path d="M12 4v16"></path></svg>
               {isJournal ? '正文/标题字体' : '字体与字号'}
            </label>
            <div className="grid grid-cols-1 gap-4">
              {renderSelect('标题字体 (默认)', config.headingFont, (v) => handleChange('headingFont', v), FONT_FAMILY_OPTIONS)}
              {renderSelect('正文字体', config.fontFamily, (v) => handleChange('fontFamily', v), FONT_FAMILY_OPTIONS)}
              
              <div className="grid grid-cols-2 gap-3">
                 {/* In Journal Mode, we pass the specific font key for each level */}
                 {isJournal ? (
                    <>
                     {renderHeadingStyleRow('一级标题', 'h1Size', 'h1Bold', 'h1Italic', 'h1Font')}
                     {renderHeadingStyleRow('二级标题', 'h2Size', 'h2Bold', 'h2Italic', 'h2Font')}
                     {renderHeadingStyleRow('三级标题', 'h3Size', 'h3Bold', 'h3Italic', 'h3Font')}
                    </>
                 ) : (
                    <>
                     {renderHeadingStyleRow('一级标题', 'h1Size', 'h1Bold', 'h1Italic')}
                     {renderHeadingStyleRow('二级标题', 'h2Size', 'h2Bold', 'h2Italic')}
                     {renderHeadingStyleRow('三级标题', 'h3Size', 'h3Bold', 'h3Italic')}
                     {renderHeadingStyleRow('四级标题', 'h4Size', 'h4Bold', 'h4Italic')}
                     {renderHeadingStyleRow('五级标题', 'h5Size', 'h5Bold', 'h5Italic')}
                     {renderHeadingStyleRow('六级标题', 'h6Size', 'h6Bold', 'h6Italic')}
                    </>
                 )}

                 {renderSelect('正文字号', config.baseSize, (v) => handleChange('baseSize', v), FONT_SIZE_OPTIONS)}
                 
                 <div>
                    <span className="text-xs text-zinc-500 block mb-1.5">行间距</span>
                    <input 
                      type="text" 
                      value={config.lineHeight} 
                      onChange={(e) => handleChange('lineHeight', e.target.value)} 
                      className="w-full text-sm p-2.5 border border-zinc-200 rounded-lg bg-zinc-50 focus:border-indigo-500 outline-none" 
                    />
                 </div>
              </div>
            </div>
          </div>
          
          <hr className="border-zinc-100" />
          
           {/* Section: Spacing */}
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-xs font-bold text-indigo-600 uppercase tracking-wider">
               <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v18"></path><rect x="6" y="8" width="12" height="8" rx="1"></rect></svg>
               段落间距
            </label>
            <div className="grid grid-cols-2 gap-3">
              {renderSelect('段前间距', config.spacingBefore, (v) => handleChange('spacingBefore', v), SPACING_OPTIONS)}
              {renderSelect('段后间距', config.spacingAfter, (v) => handleChange('spacingAfter', v), SPACING_OPTIONS)}
            </div>
          </div>

          <hr className="border-zinc-100" />

           {/* Section: Figures */}
           <div className="space-y-4">
            <label className="flex items-center gap-2 text-xs font-bold text-indigo-600 uppercase tracking-wider">
               <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
               图片/插图
            </label>
            <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200 space-y-4">
               <div>
                  <span className="text-sm font-semibold text-zinc-900 block mb-2">编号模式</span>
                   <select 
                    value={config.figureNumbering} 
                    onChange={(e) => handleChange('figureNumbering', e.target.value as FigureNumberingStyle)}
                    className="w-full text-sm p-2.5 border border-zinc-200 rounded-lg bg-white focus:border-indigo-500 outline-none"
                   >
                    {FIGURE_NUMBERING_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                   </select>
               </div>
               
               <div className="grid grid-cols-2 gap-3">
                   {renderSelect('图注字体', config.figureFont, (v) => handleChange('figureFont', v), FONT_FAMILY_OPTIONS)}
                   {renderSelect('图注对齐', config.figureAlign, (v) => handleChange('figureAlign', v), ALIGNMENT_OPTIONS)}
               </div>
               <div>
                   {renderSelect('图注字号', config.figureSize, (v) => handleChange('figureSize', v), FONT_SIZE_OPTIONS)}
               </div>
            </div>
          </div>

          {/* Section: Tables */}
          <div className="space-y-4">
            <label className="flex items-center gap-2 text-xs font-bold text-indigo-600 uppercase tracking-wider">
               <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"></path></svg>
               表格设置
            </label>
            <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200 space-y-4">
               <div>
                  <span className="text-sm font-semibold text-zinc-900 block mb-2">表格编号模式</span>
                   <select 
                    value={config.tableNumbering} 
                    onChange={(e) => handleChange('tableNumbering', e.target.value as FigureNumberingStyle)}
                    className="w-full text-sm p-2.5 border border-zinc-200 rounded-lg bg-white focus:border-indigo-500 outline-none"
                   >
                    {TABLE_NUMBERING_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                   </select>
               </div>
               
               {/* Table Caption (Title) */}
               <div className="grid grid-cols-2 gap-3">
                   {renderSelect('表题字体', config.tableCaptionFont, (v) => handleChange('tableCaptionFont', v), FONT_FAMILY_OPTIONS)}
                   {renderSelect('表题字号', config.tableCaptionSize, (v) => handleChange('tableCaptionSize', v), FONT_SIZE_OPTIONS)}
               </div>
               <div className="grid grid-cols-2 gap-3">
                   {renderSelect('表题对齐', config.tableCaptionAlign, (v) => handleChange('tableCaptionAlign', v), ALIGNMENT_OPTIONS)}
                   {/* Empty */}
               </div>
               
               <hr className="border-zinc-200 border-dashed my-2" />

               {/* Table Content (Body) */}
               <div className="grid grid-cols-2 gap-3">
                   {renderSelect('内容字体', config.tableFont, (v) => handleChange('tableFont', v), FONT_FAMILY_OPTIONS)}
                   {renderSelect('内容字号', config.tableSize, (v) => handleChange('tableSize', v), FONT_SIZE_OPTIONS)}
               </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="p-5 border-t border-zinc-200 bg-white">
          <button 
            onClick={onClose}
            className="w-full py-3 bg-zinc-900 text-white rounded-xl text-sm font-bold hover:bg-zinc-800 transition-all shadow-lg shadow-zinc-200"
          >
            确认配置
          </button>
        </div>
      </div>
    </div>
  );
};