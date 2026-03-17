
import React, { useCallback, useState } from 'react';
import mammoth from 'mammoth';
import { extractRawTextWithFormulas } from '../utils/docxParser';
import { useTranslation } from 'react-i18next';

interface Props {
  onFileLoaded: (content: string, fileName: string) => void;
  userTier?: 'FREE' | 'PLUS' | 'PRO' | 'ULTRA';
}

// 根据用户等级获取文件大小限制 (MB)
const getFileSizeLimit = (tier?: string): number => {
  switch (tier) {
    case 'ULTRA': return 100;       // 100MB
    case 'PRO': return 50;          // 50MB
    case 'PLUS': return 50;         // 50MB
    default: return 20;             // FREE: 20MB
  }
};

export const FileDropzone: React.FC<Props> = ({ onFileLoaded, userTier }) => {
  const { t } = useTranslation();
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!isLoading) setIsDragOver(true);
  }, [isLoading]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const MAX_FILE_SIZE_MB = getFileSizeLimit(userTier);
  const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

  const processFile = async (file: File) => {
    setError(null);
    setIsLoading(true);

    // 文件大小检查
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const fileSizeMB = (file.size / 1024 / 1024).toFixed(1);
      setError(t('home.file_too_large', { size: fileSizeMB, max: MAX_FILE_SIZE_MB, defaultValue: `文件过大 (${fileSizeMB}MB)，最大支持 ${MAX_FILE_SIZE_MB}MB` }));
      setIsLoading(false);
      return;
    }

    try {
      if (file.name.endsWith('.docx')) {
        const arrayBuffer = await file.arrayBuffer();

        // 1. Standard HTML conversion (Layout, tables, images)
        // Mammoth strips OMML formulas, so the visual preview usually lacks them.
        const result = await mammoth.convertToHtml({ arrayBuffer });
        let finalContent = result.value;

        // 2. Advanced: Extract raw XML text to capture Native Word Formulas (OMML)
        try {
          const rawContext = await extractRawTextWithFormulas(arrayBuffer);
          // 公式提取成功但不追加任何提示文字到内容中（避免被导出到 Word）
          console.log('Formula extraction:', rawContext?.includes("$$") ? 'found formulas' : 'no formulas');
        } catch (xmlErr) {
          console.warn("Failed to extract raw XML context", xmlErr);
        }

        onFileLoaded(finalContent, file.name);

      } else if (file.type === "application/vnd.ms-word" || file.name.endsWith('.doc')) {
        throw new Error(t('home.unsupported_doc', "暂不支持旧版 .doc 格式，请另存为 .docx 或 .txt 后上传。"));
      } else {
        const textContent = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = () => reject(new Error(t('home.read_failed', "文件读取失败")));
          reader.readAsText(file);
        });
        onFileLoaded(textContent, file.name);
      }
    } catch (e: any) {
      setError(e.message || t('home.read_docx_failed', "读取 .docx 文件失败，请确认文件未损坏。"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    if (isLoading) return;

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      processFile(e.dataTransfer.files[0]);
    }
  }, [onFileLoaded, isLoading]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      processFile(e.target.files[0]);
    }
    e.target.value = '';
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`
        relative border-2 border-dashed rounded-2xl p-4 text-center transition-all duration-300 ease-out group overflow-hidden
        ${isDragOver
          ? 'border-blue-500 bg-blue-50/50 scale-[1.01] shadow-xl shadow-blue-100/50'
          : 'border-slate-200 bg-slate-50/50 hover:border-blue-400 hover:bg-white hover:shadow-lg hover:shadow-blue-50/50'
        }
        ${isLoading ? 'cursor-wait bg-slate-50 border-slate-200' : ''}
      `}
    >
      <input
        type="file"
        accept=".txt,.md,.doc,.docx"
        onChange={handleInputChange}
        disabled={isLoading}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10 disabled:cursor-wait"
      />

      {isLoading ? (
        <div className="flex flex-col items-center justify-center gap-4 py-2 animate-in fade-in zoom-in duration-300">
          <div className="relative w-14 h-14">
            <svg className="animate-spin absolute inset-0 w-full h-full text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <div>
            <h3 className="text-slate-800 font-bold text-lg">{t('home.parsing_file', '正在解析文件...')}</h3>
            <p className="text-slate-500 text-sm mt-1">{t('home.extracting_word', '深度提取 Word 结构与公式')}</p>
          </div>
        </div>
      ) : (
        <div className="pointer-events-none flex flex-col items-center gap-3 transition-transform duration-300 group-hover:-translate-y-1">
          <div className={`p-3 rounded-xl transition-all duration-300 ${isDragOver ? 'bg-blue-100 text-blue-600 scale-110' : 'bg-white text-slate-400 shadow-sm border border-slate-100 group-hover:text-blue-500 group-hover:border-blue-100 group-hover:shadow-blue-100'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>
          </div>
          <div className="space-y-1">
            <h3 className={`text-base font-bold transition-colors ${isDragOver ? 'text-blue-700' : 'text-slate-700'}`}>{t('home.drag_file_here', '拖拽文件至此')}</h3>
            <p className="text-sm text-slate-500 font-medium">{t('home.supports_formats', { max_size: MAX_FILE_SIZE_MB >= 1024 ? `${MAX_FILE_SIZE_MB / 1024}GB` : `${MAX_FILE_SIZE_MB}MB`, defaultValue: `支持 .docx, .txt, .md (最大 ${MAX_FILE_SIZE_MB >= 1024 ? `${MAX_FILE_SIZE_MB / 1024}GB` : `${MAX_FILE_SIZE_MB}MB`})` })}</p>
          </div>
          <span className="bg-white border border-slate-200 text-slate-600 px-5 py-2 rounded-lg text-sm font-bold shadow-sm tracking-wide group-hover:border-blue-200 group-hover:text-blue-600 group-hover:shadow-blue-100 transition-all">
            {t('home.browse_files', '浏览文件')}
          </span>
        </div>
      )}

      {error && (
        <div className="absolute bottom-4 left-0 right-0 mx-auto w-max max-w-[90%] bg-red-50 text-red-600 border border-red-100 text-xs px-4 py-2 rounded-full animate-in slide-in-from-bottom-2 fade-in z-20">
          {error}
        </div>
      )}
    </div>
  );
};