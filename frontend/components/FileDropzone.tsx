
import React, { useCallback, useState } from 'react';
import mammoth from 'mammoth';
import { extractRawTextWithFormulas } from '../utils/docxParser';

interface Props {
  onFileLoaded: (content: string, fileName: string) => void;
}

export const FileDropzone: React.FC<Props> = ({ onFileLoaded }) => {
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

  const processFile = async (file: File) => {
    setError(null);
    setIsLoading(true);

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
               
               // We append this visible block so the user knows formulas were captured, 
               // even if Mammoth didn't render them in the main view.
               if (rawContext && rawContext.includes("$$")) {
                   const escapedContext = rawContext.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                   finalContent += `
                    <div style="margin-top: 48px; border-top: 2px dashed #e4e4e7; padding-top: 24px; font-family: sans-serif;">
                      <div style="background: #fafafa; border: 1px solid #e4e4e7; border-radius: 12px; overflow: hidden;">
                        <div style="background: #f4f4f5; padding: 12px 16px; border-bottom: 1px solid #e4e4e7; display: flex; align-items: center; justify-content: space-between;">
                           <div style="display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; color: #18181b;">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path><path d="M16 13H8"></path><path d="M16 17H8"></path><path d="M10 9H8"></path></svg>
                              系统已捕获公式数据 (AI Context)
                           </div>
                           <span style="font-size: 11px; color: #16a34a; background: #dcfce7; padding: 2px 8px; border-radius: 99px; font-weight: 500;">
                             增强识别已启用
                           </span>
                        </div>
                        <div style="padding: 16px;">
                           <div style="margin-bottom: 12px; font-size: 12px; color: #71717a; line-height: 1.5;">
                              <strong>提示：</strong> 上方的可视化预览由浏览器直接渲染，可能无法显示 Word 原生公式。但无需担心，系统已通过底层解析提取到了以下数据（包含 $$ 包裹的公式），它们将完整提交给 AI 进行排版重构。
                           </div>
                           <pre style="white-space: pre-wrap; word-break: break-all; background: white; padding: 16px; border: 1px solid #e4e4e7; border-radius: 8px; max-height: 240px; overflow-y: auto; font-family: monospace; font-size: 12px; color: #52525b; box-shadow: inset 0 2px 4px 0 rgb(0 0 0 / 0.05);">${escapedContext}</pre>
                        </div>
                      </div>
                    </div>
                   `;
               }
           } catch (xmlErr) {
               console.warn("Failed to extract raw XML context", xmlErr);
           }
           
           onFileLoaded(finalContent, file.name);

        } else if (file.type === "application/vnd.ms-word" || file.name.endsWith('.doc')) {
            throw new Error("暂不支持旧版 .doc 格式，请另存为 .docx 或 .txt 后上传。");
        } else {
            const textContent = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => resolve(e.target?.result as string);
                reader.onerror = () => reject(new Error("文件读取失败"));
                reader.readAsText(file);
            });
            onFileLoaded(textContent, file.name);
        }
    } catch (e: any) {
         setError(e.message || "读取 .docx 文件失败，请确认文件未损坏。");
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
        relative border border-dashed rounded-2xl p-8 text-center transition-all duration-500 ease-out group overflow-hidden
        ${isDragOver 
          ? 'border-indigo-500 bg-indigo-50/50 scale-[1.01] shadow-xl shadow-indigo-100/50' 
          : 'border-zinc-300 bg-zinc-50/50 hover:border-indigo-400 hover:bg-white'
        }
        ${isLoading ? 'cursor-wait bg-zinc-50 border-zinc-200' : ''}
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
           <div className="relative w-12 h-12">
             <svg className="animate-spin absolute inset-0 w-full h-full text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
               <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
               <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
             </svg>
           </div>
           <div>
             <h3 className="text-zinc-700 font-bold">正在解析文件...</h3>
             <p className="text-zinc-400 text-xs mt-1">深度提取 Word 结构与公式</p>
           </div>
        </div>
      ) : (
        <div className="pointer-events-none flex flex-col items-center gap-4 transition-transform duration-300 group-hover:-translate-y-1">
          <div className={`p-4 rounded-full transition-colors duration-300 ${isDragOver ? 'bg-indigo-100 text-indigo-600' : 'bg-white text-zinc-400 shadow-sm border border-zinc-100 group-hover:text-indigo-500 group-hover:border-indigo-100'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>
          </div>
          <div>
            <h3 className={`text-lg font-bold transition-colors ${isDragOver ? 'text-indigo-700' : 'text-zinc-700'}`}>拖拽文件至此</h3>
            <p className="text-sm text-zinc-500 mt-1.5 font-light">支持 .docx, .txt, .md</p>
          </div>
          <span className="bg-white border border-zinc-200 text-zinc-600 px-5 py-2 rounded-full text-xs font-semibold shadow-sm tracking-wide group-hover:border-indigo-200 group-hover:text-indigo-600 transition-all">
            浏览文件
          </span>
          
          <div className="mt-1 px-3 py-1 bg-green-50 text-green-700 text-[10px] leading-tight rounded-full border border-green-100 flex items-center gap-1.5">
             <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
             <span>公式深度提取已就绪</span>
          </div>
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