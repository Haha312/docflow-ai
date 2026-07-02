import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseUploadedFile, ParsedUpload } from '../utils/parseUploadedFile';

interface Props {
  value: string;
  count: number;
  maxLength: number;
  userTier?: 'FREE' | 'PLUS' | 'PRO' | 'ULTRA';
  onPasteChange: (value: string) => void;
  onClear: () => void;
  onFileLoaded: (content: string, fileName: string, upload?: ParsedUpload) => void;
}

/**
 * 空状态融合输入框:同一个框里既能粘贴/输入文字,也能把文件直接拖进来或点「浏览」选择,
 * 不再把「粘贴区」和「拖拽区」上下分成两块。
 */
export const HeroInput: React.FC<Props> = ({ value, count, maxLength, userTier, onPasteChange, onClear, onFileLoaded }) => {
  const { t } = useTranslation();
  const [isDragOver, setDragOver] = useState(false);
  const [isParsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    setParsing(true);
    try {
      const upload = await parseUploadedFile(file, userTier, t);
      onFileLoaded(upload.content, upload.fileName, upload);
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

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (isParsing) return;

    const items = Array.from<DataTransferItem>(e.clipboardData.items);
    const imageItem = items.find((item) => item.kind === 'file' && item.type.startsWith('image/'));
    const pastedImage = imageItem?.getAsFile();
    if (!pastedImage) return;

    e.preventDefault();
    const mimeType = pastedImage.type || 'image/png';
    const extension = mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    const fileName = pastedImage.name || `clipboard-image-${Date.now()}.${extension}`;
    const imageFile = new File([pastedImage], fileName, { type: mimeType });
    handleFile(imageFile);
  }, [isParsing, handleFile]);

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!isParsing) setDragOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false); }}
      onDrop={handleDrop}
      className={`relative w-full bg-[#111111] border rounded-2xl p-5 transition-colors ${isDragOver ? 'border-zinc-400 bg-[#151515]' : 'border-white/10 focus-within:border-white/25'}`}
    >
      <textarea
        value={value}
        onChange={(e) => onPasteChange(e.target.value)}
        onPaste={handlePaste}
        placeholder={t('home.hero_placeholder', '在此粘贴文字或图片,也可把 Word / txt / 图片拖到这里…')}
        autoFocus
        maxLength={maxLength}
        className="w-full min-h-[180px] max-h-[360px] resize-none text-[15px] leading-relaxed text-zinc-100 placeholder-zinc-500 outline-none bg-transparent block"
      />

      {!value && !isParsing && (
        <div className="absolute inset-x-5 top-[46%] -translate-y-1/2 flex justify-center pointer-events-none">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="pointer-events-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-white/[0.08] text-zinc-300 text-sm font-medium hover:bg-white/[0.12] hover:text-white transition-colors border border-white/10"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
            {t('home.browse_files', '浏览文件')}
          </button>
        </div>
      )}

      {/* 底部一行:字数 / 文件提示 + 浏览 + 清空 — 全在同一个框内 */}
      <div className="flex items-center justify-between border-t border-white/10 pt-3 mt-2">
        <div className="flex items-center gap-2.5 text-xs text-zinc-500 min-w-0">
          {value ? (
            <>
              <span className={`flex-shrink-0 ${value.length >= maxLength ? 'text-red-500' : ''}`}>
                {count.toLocaleString()} {t('home.chars', '字')}{value.length >= maxLength ? ` · ${t('home.at_char_limit', '已达字数上限')}` : ''}
              </span>
              <span className="text-gray-300 flex-shrink-0">·</span>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-100 transition-colors flex-shrink-0"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                {t('home.browse_files', '浏览文件')}
              </button>
            </>
          ) : (
            <span className="truncate">{t('home.hero_file_hint', '支持 Word / txt / md / 图片')}</span>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,.doc,.docx,image/png,image/jpeg,image/webp,image/gif,image/bmp"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }}
          />
        </div>
        {value ? (
          <button type="button" onClick={onClear} className="text-xs text-zinc-500 hover:text-red-300 transition-colors flex-shrink-0">
            {t('home.clear', '清空')}
          </button>
        ) : null}
      </div>

      {/* 拖拽悬停遮罩 */}
      {isDragOver && (
        <div className="absolute inset-0 rounded-2xl bg-black/70 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
          <div className="flex items-center gap-2 text-sm font-medium text-zinc-100">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 16V4M6 10l6-6 6 6" /><path d="M4 20h16" /></svg>
            {t('home.drop_to_upload', '松开以上传文件')}
          </div>
        </div>
      )}

      {/* 解析中遮罩 */}
      {isParsing && (
        <div className="absolute inset-0 rounded-2xl bg-black/75 flex items-center justify-center">
          <div className="flex items-center gap-2 text-sm text-zinc-300">
            <svg className="animate-spin w-4 h-4 text-zinc-400" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            {t('home.parsing_file', '正在解析文件...')}
          </div>
        </div>
      )}

      {error && (
        <div className="mt-3 bg-red-950/40 text-red-200 border border-red-900/60 text-xs px-3 py-2 rounded-lg">{error}</div>
      )}
    </div>
  );
};
