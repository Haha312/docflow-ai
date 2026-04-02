
import React, { useCallback, useState } from 'react';
import mammoth from 'mammoth';
import { extractRawTextWithFormulas, extractDocumentStructure } from '../utils/docxParser';
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
  const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

  const processFile = async (file: File) => {
    setError(null);
    setIsLoading(true);
    setLoadingFileType(file.name.endsWith('.docx') ? 'docx' : 'text');

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

        // 0. Pre-read styles.xml to build a dynamic mammoth styleMap,
        //    so heading styles with non-standard names/IDs are correctly mapped to <h1>-<h6>.
        let dynamicStyleMap: string[] = [];
        try {
          const JSZip = (await import('jszip')).default;
          const zip = await JSZip.loadAsync(arrayBuffer);
          const stylesEntry = zip.file('word/styles.xml');
          if (stylesEntry) {
            const stylesXml = await stylesEntry.async('text');
            const stylesDoc = new DOMParser().parseFromString(stylesXml, 'application/xml');
            const allStyles = stylesDoc.getElementsByTagName('w:style');
            for (const style of Array.from(allStyles)) {
              if (style.getAttribute('w:type') !== 'paragraph') continue;
              const nameEl = style.getElementsByTagName('w:name')[0];
              const name = nameEl?.getAttribute('w:val') ?? '';
              const enMatch = name.match(/^heading\s+(\d+)$/i);
              const cnMatch = name.match(/^标题\s*(\d+)$/);
              const level = enMatch ? enMatch[1] : cnMatch ? cnMatch[1] : null;
              if (level && parseInt(level) <= 6) {
                dynamicStyleMap.push(`p[style-name='${name}'] => h${level}:fresh`);
              }
            }
          }
        } catch (_) { /* silently skip — mammoth falls back to defaults */ }

        // 1. Standard HTML conversion (Layout, tables, images)
        // Mammoth strips OMML formulas, so the visual preview usually lacks them.
        const result = await mammoth.convertToHtml({
          arrayBuffer,
          ...(dynamicStyleMap.length > 0 ? { styleMap: dynamicStyleMap } : {}),
        });
        let finalContent = result.value;

        // 2. Advanced: Extract raw XML text to capture Native Word Formulas (OMML)
        // Append formula data as a hidden marker so the AI backend can process them.
        // The marker <!-- FORMULA_DATA --> is stripped before docx export in handleDownload.
        try {
          const rawContext = await extractRawTextWithFormulas(arrayBuffer);
          const hasFormulas = rawContext?.includes("$$");
          console.log('Formula extraction:', hasFormulas ? 'found formulas' : 'no formulas');
          if (hasFormulas && rawContext) {
            finalContent += `\n<!-- FORMULA_DATA -->\n${rawContext}`;
          }
        } catch (xmlErr) {
          console.warn("Failed to extract raw XML context", xmlErr);
        }

        // 3. Extract document heading structure for pre-computed numbering.
        // This lets the backend tell the AI exactly what number each heading should get,
        // eliminating cross-chunk numbering drift entirely.
        try {
          const structure = await extractDocumentStructure(arrayBuffer);
          if (structure.length > 0) {
            finalContent += `\n<!-- STRUCTURE_DATA -->\n${JSON.stringify(structure)}`;
            console.log(`[STRUCTURE] Appended ${structure.length} heading entries`);
          }
        } catch (structErr) {
          console.warn("Failed to extract document structure", structErr);
        }

        setError(null);
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
        setError(null);
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