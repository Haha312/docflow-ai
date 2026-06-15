import mammoth from 'mammoth';
import { extractRawTextWithFormulas, extractDocumentStructure } from './docxParser';

/** 根据用户等级获取文件大小限制 (MB) */
export const getFileSizeLimit = (tier?: string): number => {
  switch (tier) {
    case 'ULTRA': return 100;       // 100MB
    case 'PRO': return 50;          // 50MB
    case 'PLUS': return 50;         // 50MB
    default: return 20;             // FREE: 20MB
  }
};

type TFn = (key: string, opts?: any) => string;

/**
 * 解析上传/拖入的文件为 HTML/文本内容,供 FileDropzone 与 HeroInput 共用。
 * 失败时抛出带可读消息的 Error(大小超限 / 旧版 .doc / 读取失败)。
 */
export async function parseUploadedFile(
  file: File,
  userTier: string | undefined,
  t: TFn
): Promise<{ content: string; fileName: string }> {
  const maxMB = getFileSizeLimit(userTier);
  if (file.size > maxMB * 1024 * 1024) {
    const sizeMB = (file.size / 1024 / 1024).toFixed(1);
    throw new Error(t('home.file_too_large', { size: sizeMB, max: maxMB, defaultValue: `文件过大 (${sizeMB}MB)，最大支持 ${maxMB}MB` }));
  }

  if (file.name.endsWith('.docx')) {
    const arrayBuffer = await file.arrayBuffer();

    // 0. 预读 styles.xml 构建动态 mammoth styleMap,让非标准命名/ID 的标题样式也能正确映射到 <h1>-<h6>。
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
    } catch (_) { /* 静默跳过 — mammoth 回退默认 */ }

    // 1. 标准 HTML 转换(版式、表格、图片)
    const result = await mammoth.convertToHtml({
      arrayBuffer,
      ...(dynamicStyleMap.length > 0 ? { styleMap: dynamicStyleMap } : {}),
    });
    let finalContent = result.value;

    // 2. 提取原始 XML 中的 Word 原生公式(OMML),作为隐藏标记附加,供后端处理。
    try {
      const rawContext = await extractRawTextWithFormulas(arrayBuffer);
      const hasFormulas = rawContext?.includes('$$');
      console.log('Formula extraction:', hasFormulas ? 'found formulas' : 'no formulas');
      if (hasFormulas && rawContext) {
        finalContent += `\n<!-- FORMULA_DATA -->\n${rawContext}`;
      }
    } catch (xmlErr) {
      console.warn('Failed to extract raw XML context', xmlErr);
    }

    // 3. 提取文档标题结构用于预计算编号,消除跨 chunk 编号漂移。
    try {
      const structure = await extractDocumentStructure(arrayBuffer);
      if (structure.length > 0) {
        finalContent += `\n<!-- STRUCTURE_DATA -->\n${JSON.stringify(structure)}`;
        console.log(`[STRUCTURE] Appended ${structure.length} heading entries`);
      }
    } catch (structErr) {
      console.warn('Failed to extract document structure', structErr);
    }

    return { content: finalContent, fileName: file.name };
  }

  if (file.type === 'application/vnd.ms-word' || file.name.endsWith('.doc')) {
    throw new Error(t('home.unsupported_doc', '暂不支持旧版 .doc 格式，请另存为 .docx 或 .txt 后上传。'));
  }

  const textContent = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error(t('home.read_failed', '文件读取失败')));
    reader.readAsText(file);
  });
  return { content: textContent, fileName: file.name };
}
