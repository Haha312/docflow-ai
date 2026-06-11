import DOMPurify from 'dompurify';

/**
 * 净化客户端 mammoth(.docx → HTML)转换产物,供「原文对比」预览用 dangerouslySetInnerHTML 安全渲染。
 *
 * 背景:恶意 .docx 可让 mammoth 直出危险标记(例如外链 TargetMode=External 指向 `javascript:` →
 * `<a href="javascript:...">`,或图片 onerror),经 FileDropzone → inputText 进入预览即触发 self-XSS。
 *
 * 配置与 Home.tsx 里 AI 输出(renderedContent)的净化保持一致:
 *  - ALLOWED_URI_REGEXP 放行 data:(base64 图片)/ http(s) / mailto / 锚点;不含 javascript:,故危险链接的 href 被剥离
 *  - ADD_ATTR 保留 id(标题锚点)、style(预设排版)、target
 * 表格 / 图片 / 标题等结构标签为 DOMPurify 默认放行,正常排版内容不受影响。
 */
export function sanitizeDocxPreview(html: string): string {
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ['id', 'style', 'target'],
    ALLOWED_URI_REGEXP: /^(?:data:|https?:|mailto:|#)/i,
  });
}
