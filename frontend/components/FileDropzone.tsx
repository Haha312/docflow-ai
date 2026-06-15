
import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseUploadedFile, getFileSizeLimit } from '../utils/parseUploadedFile';

interface Props {
  onFileLoaded: (content: string, fileName: string) => void;
  userTier?: 'FREE' | 'PLUS' | 'PRO' | 'ULTRA';
}

export const FileDropzone: React.FC<Props> = ({ onFileLoaded, userTier }) => {
  const { t } = useTranslation();
  const [isDragOver, setIsDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingFileType, setLoadingFileType] = useState<'docx' | 'text'>('text');

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!isLoading) setIsDragOver(true);
  }, [isLoading]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const MAX_FILE_SIZE_MB = getFileSizeLimit(userTier);

  const processFile = async (file: File) => {
    setError(null);
    setIsLoading(true);
    setLoadingFileType(file.name.endsWith('.docx') ? 'docx' : 'text');
    try {
      const { content, fileName } = await parseUploadedFile(file, userTier, t);
      setError(null);
      onFileLoaded(content, fileName);
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
        relative border border-dashed rounded-xl p-3 text-center transition-all duration-200 ease-out group
        ${isDragOver
          ? 'border-blue-400 bg-blue-50/40 shadow-sm'
          : 'border-gray-200 bg-gray-50/40 hover:border-gray-300 hover:bg-gray-50'
        }
        ${isLoading ? 'cursor-wait' : ''}
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
        <div className="flex flex-col items-center justify-center gap-2 py-1 animate-in fade-in zoom-in duration-300">
          <div className="relative w-8 h-8">
            <svg className="animate-spin absolute inset-0 w-full h-full text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
          </div>
          <div>
            <h3 className="text-gray-700 font-semibold text-sm">{t('home.parsing_file', '正在解析文件...')}</h3>
            <p className="text-gray-400 text-xs mt-0.5">
              {loadingFileType === 'docx'
                ? t('home.extracting_word', '深度提取 Word 结构与公式')
                : t('home.reading_text', '正在读取文件内容')}
            </p>
          </div>
        </div>
      ) : (
        <div className="pointer-events-none flex flex-col items-center gap-2">
          <div className={`p-2 rounded-lg transition-all duration-200 ${isDragOver ? 'bg-blue-100 text-blue-500' : 'bg-white text-gray-400 shadow-sm border border-gray-100'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>
          </div>
          <div className="space-y-0.5">
            <h3 className={`text-sm font-semibold transition-colors ${isDragOver ? 'text-blue-600' : 'text-gray-700'}`}>{t('home.drag_file_here', '拖拽文件至此')}</h3>
            <p className="text-xs text-gray-400">{t('home.supports_formats', { max_size: MAX_FILE_SIZE_MB >= 1024 ? `${MAX_FILE_SIZE_MB / 1024}GB` : `${MAX_FILE_SIZE_MB}MB`, defaultValue: `支持 .docx, .txt, .md (最大 ${MAX_FILE_SIZE_MB >= 1024 ? `${MAX_FILE_SIZE_MB / 1024}GB` : `${MAX_FILE_SIZE_MB}MB`})` })}</p>
          </div>
          <span className="bg-white border border-gray-200 text-gray-500 px-4 py-1.5 rounded-lg text-xs font-semibold shadow-sm tracking-wide transition-all">
            {t('home.browse_files', '浏览文件')}
          </span>
        </div>
      )}

      {error && (
        <div className="mt-2 bg-red-50 text-red-600 border border-red-100 text-xs px-3 py-2 rounded-lg text-center">
          {error}
        </div>
      )}
    </div>
  );
};