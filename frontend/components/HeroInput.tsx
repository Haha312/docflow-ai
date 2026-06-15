import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseUploadedFile } from '../utils/parseUploadedFile';

interface Props {
  value: string;
  count: number;
  maxLength: number;
  userTier?: 'FREE' | 'PLUS' | 'PRO' | 'ULTRA';
  onPasteChange: (value: string) => void;
  onClear: () => void;
  onFileLoaded: (content: string, fileName: string) => void;
  onTrySample?: () => void;
}

/**
 * 空状态融合输入框:同一个框里既能粘贴/输入文字,也能把文件直接拖进来或点「浏览」选择,
 * 不再把「粘贴区」和「拖拽区」上下分成两块。
 */
export const HeroInput: React.FC<Props> = ({ value, count, maxLength, userTier, onPasteChange, onClear, onFileLoaded, onTrySample }) => {
  const { t } = useTranslation();
  const [isDragOver, setDragOver] = useState(false);
  const [isParsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setParsing(true);
    try {
      const { content, fileName } = await parseUploadedFile(file, userTier, t);
      onFileLoaded(content, fileName);
    } catch (e: any) {
      setError(e.message || t('home.read_docx_failed', '读取文件失败，请确认文件未损坏。'));
    } finally {
      setParsing(false);
    }
  }, [userTier, t, onFileLoaded]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (isParsing) return;
    const files = e.dataTransfer.files;
    // 拖入的是文本/链接(非文件)→ files 为空,给提示而非静默无反应
    if (!files || files.length === 0) {
      setError(t('home.drop_need_file', '请把 Word / txt / md 文件拖到这里'));
      return;
    }
    handleFile(files[0]); // 多文件时取第一个(与多数上传交互一致)
  }, [isParsing, handleFile, t]);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!isParsing) setDragOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
      onDrop={handleDrop}
      className={`relative w-full bg-white border rounded-2xl p-5 transition-colors ${isDragOver ? 'border-gray-900 bg-gray-50/60' : 'border-gray-200 focus-within:border-gray-300'}`}
    >
      <textarea
        value={value}
        onChange={(e) => onPasteChange(e.target.value)}
        placeholder={t('home.hero_placeholder', '在此粘贴文字,或把 Word / txt 文件拖到这里…')}
        autoFocus
        maxLength={maxLength}
        className="w-full min-h-[180px] max-h-[360px] resize-none text-[15px] leading-relaxed text-gray-800 placeholder-gray-400 outline-none bg-transparent block"
      />

      {/* 底部一行:字数 / 文件提示 + 浏览 + 清空 — 全在同一个框内 */}
      <div className="flex items-center justify-between border-t border-gray-100 pt-3 mt-2">
        <div className="flex items-center gap-2.5 text-xs text-gray-400 min-w-0">
          {value
            ? <span className={`flex-shrink-0 ${value.length >= maxLength ? 'text-red-500' : ''}`}>
                {count.toLocaleString()} {t('home.chars', '字')}{value.length >= maxLength ? ` · ${t('home.at_char_limit', '已达字数上限')}` : ''}
              </span>
            : <span className="truncate">{t('home.hero_file_hint', '支持 Word / txt / md')}</span>}
          <span className="text-gray-300 flex-shrink-0">·</span>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1 text-gray-500 hover:text-gray-800 transition-colors flex-shrink-0"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            {t('home.browse_files', '浏览文件')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.doc,.docx"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
          />
        </div>
        {value ? (
          <button type="button" onClick={onClear} className="text-xs text-gray-400 hover:text-red-500 transition-colors flex-shrink-0">
            {t('home.clear', '清空')}
          </button>
        ) : onTrySample ? (
          <button type="button" onClick={onTrySample} className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 transition-colors flex-shrink-0">
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></svg>
            {t('home.try_sample', '试试示例')}
          </button>
        ) : null}
      </div>

      {/* 拖拽悬停遮罩 */}
      {isDragOver && (
        <div className="absolute inset-0 rounded-2xl bg-white/80 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-800">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 16V4M6 10l6-6 6 6" /><path d="M4 20h16" /></svg>
            {t('home.drop_to_upload', '松开以上传文件')}
          </div>
        </div>
      )}

      {/* 解析中遮罩 */}
      {isParsing && (
        <div className="absolute inset-0 rounded-2xl bg-white/85 flex items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <svg className="animate-spin w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            {t('home.parsing_file', '正在解析文件...')}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 bg-red-50 text-red-600 border border-red-100 text-xs px-3 py-2 rounded-lg">{error}</div>
      )}
    </div>
  );
};
