
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileDropzone } from './components/FileDropzone';
import { PresetCard } from './components/PresetCard';
import { ProductRequirements } from './components/ProductRequirements';
import { StyleEditor } from './components/StyleEditor';
import { AuthModal } from './components/AuthModal';
import { PricingModal } from './components/PricingModal';
import { UserInfo } from './components/UserInfo';
import { UserProfileModal } from './components/UserProfileModal';
import { useConfirmDialog } from './components/ConfirmDialog';
import { generateDocumentViaBackend } from './services/backendApiService';
import { generateDocx } from './utils/docxGenerator';
import { useAuth } from './contexts/AuthContext';
// useTypewriter removed: SSE stream is already incremental, no need for secondary typing animation
import { PRESETS } from './constants';
import { DocPreset, AIState, StyleConfig } from './types';
import katex from 'katex';
import 'katex/dist/katex.min.css';

const getTextCount = (html: string) => {
  return html.replace(/<[^>]+>/g, '').replace(/\s/g, '').length;
};

const MODEL_OPTIONS = [
  { key: 'gemini-flash', name: 'Gemini Flash',  descKey: 'home.model_fast' },
  { key: 'gemini-pro',   name: 'Gemini 3 Pro',  descKey: 'home.model_quality' },
  { key: 'doubao',       name: '豆包 Doubao',    descKey: 'home.model_bytedance' },
  { key: 'deepseek',     name: 'DeepSeek V3',   descKey: 'home.model_deepseek' },
  { key: 'qwen-max',     name: 'Qwen Max',       descKey: 'home.model_qwen' },
] as const;

// A4 page dimensions at 96 dpi (297mm × 96 / 25.4 ≈ 1122px)
const A4_HEIGHT_PX = 1122;
// Top + bottom padding of the paper div (each side = 80px)
const A4_PADDING_PX = 160;

function Home() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { confirm, ConfirmDialogComponent } = useConfirmDialog();
  const [inputText, setInputText] = useState<string>('');
  const [inputFileName, setInputFileName] = useState<string>('document.txt');
  const [selectedPreset, setSelectedPreset] = useState<DocPreset>(DocPreset.ACADEMIC);
  const [selectedModel, setSelectedModel] = useState<string>(
    () => localStorage.getItem('docuflow_selected_model') ?? 'gemini-pro'
  );
  const [isModelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const [outputText, setOutputText] = useState<string>('');
  const [imageMap, setImageMap] = useState<Record<string, string>>({});
  const [showToast, setShowToast] = useState(false);
  // Directly use outputText for rendering — SSE stream provides natural incremental flow

  const [currentStyles, setCurrentStyles] = useState<Record<DocPreset, StyleConfig>>(() => {
    const initial: any = {};
    PRESETS.forEach(p => initial[p.id] = { ...p.styleConfig });
    return initial;
  });

  const [isStyleEditorOpen, setStyleEditorOpen] = useState(false);
  const [aiState, setAiState] = useState<AIState>({
    isThinking: false,
    error: null,
    stopMessage: null,
    progressStep: '',
    progress: 0
  });
  const [isCopied, setIsCopied] = useState(false);

  const [showPRD, setShowPRD] = useState(false);
  const [viewMode, setViewMode] = useState<'split' | 'preview'>('preview');
  const [downloadHighlight, setDownloadHighlight] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);

  const { isAuthenticated, user, refreshUser } = useAuth();
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  // TOC sidebar states
  const [tocItems, setTocItems] = useState<{ id: string; level: number; text: string }[]>([]);
  
  const [activeFormats, setActiveFormats] = useState<{
    bold: boolean;
    italic: boolean;
    underline: boolean;
    heading: string;
    align: string;
    list: string;
  }>({
    bold: false, italic: false, underline: false, heading: '', align: '', list: ''
  });

  const updateActiveFormats = useCallback(() => {
    if (typeof document === 'undefined') return;
    try {
      setActiveFormats({
        bold: document.queryCommandState('bold'),
        italic: document.queryCommandState('italic'),
        underline: document.queryCommandState('underline'),
        heading: document.queryCommandValue('formatBlock') || '',
        align: document.queryCommandState('justifyCenter') ? 'center' :
               document.queryCommandState('justifyRight') ? 'right' :
               document.queryCommandState('justifyFull') ? 'justify' : 'left',
        list: document.queryCommandState('insertOrderedList') ? 'ol' :
              document.queryCommandState('insertUnorderedList') ? 'ul' : ''
      });
    } catch (e) {
      // Ignored
    }
  }, []);
  const [tocCollapsed, setTocCollapsed] = useState(false);
  const prevTocCountRef = useRef(0);
  const [newTocIds, setNewTocIds] = useState<Set<string>>(new Set());

  // Rich editor states
  const previewContentRef = useRef<HTMLDivElement>(null);
  const [isContentEdited, setIsContentEdited] = useState(false);
  const savedRangeRef = useRef<Range | null>(null);

  // Live page count — measured from real DOM scroll height each time content updates
  const [contentPageCount, setContentPageCount] = useState(1);

  const abortControllerRef = useRef<AbortController | null>(null);
  // Buffer for batching SSE text updates — flush every ~80ms (matches ChatGPT/Claude streaming cadence)
  const textBufferRef = useRef<string>('');
  const rafIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Layout Resizing States
  const [sidebarWidth, setSidebarWidth] = useState(360); // Default 360px
  const [splitRatio, setSplitRatio] = useState(50); // Default 50%
  const [isDraggingSidebar, setIsDraggingSidebar] = useState(false);
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const activeStyle = currentStyles[selectedPreset];
  const activePresetConfig = PRESETS.find(p => p.id === selectedPreset)!;


  const handleFileLoaded = (content: string, name: string) => {
    setInputText(content);
    setInputFileName(name);
    setOutputText('');
    setAiState(prev => ({ ...prev, error: null, progress: 0 }));
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Persist model selection across page refreshes
  useEffect(() => {
    localStorage.setItem('docuflow_selected_model', selectedModel);
  }, [selectedModel]);


  useEffect(() => {
    // 生成期间让光标元素始终保持在视口内，跟随光标而不是跳到容器底部
    if (shouldAutoScroll && aiState.isThinking) {
      const cursor = document.getElementById('ai-typing-cursor');
      if (cursor) {
        cursor.scrollIntoView({ block: 'end', inline: 'nearest' });
      } else if (previewContainerRef.current) {
        // 光标元素尚未渲染时降级为滚到底部
        previewContainerRef.current.scrollTop = previewContainerRef.current.scrollHeight;
      }
    }
  }, [outputText, shouldAutoScroll, aiState.isThinking]);

  const handlePreviewScroll = () => {
    if (previewContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = previewContainerRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight <= 80;
      if (isAtBottom !== shouldAutoScroll) {
        setShouldAutoScroll(isAtBottom);
      }
    }
  };

  const handleClear = async () => {
    const confirmed = await confirm(t('home.confirm_clear_desc', '确定要清空当前所有内容吗？'), {
      title: t('home.confirm_clear_title', '清空内容'),
      variant: 'warning'
    });

    if (confirmed) {
      setInputText('');
      setInputFileName('document.txt');
      setOutputText('');
      setContentPageCount(1);
      setAiState({ isThinking: false, error: null, progressStep: '', progress: 0 });
    }
  };

  // Ctrl/Cmd+Enter keyboard shortcut to start generation (metaKey = Cmd on Mac, ctrlKey = Ctrl on Windows/Linux)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        if (inputText && !aiState.isThinking) {
          handleProcess();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [inputText, aiState.isThinking]);

  // --- Resizing Handlers ---
  const handleSidebarMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingSidebar(true);
  };

  const handleSplitMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingSplit(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingSidebar) {
        // Limit sidebar width between 240px and 500px
        const newWidth = Math.max(240, Math.min(e.clientX, 500));
        setSidebarWidth(newWidth);
      } else if (isDraggingSplit && workspaceRef.current) {
        // Calculate relative position within the workspace
        const workspaceRect = workspaceRef.current.getBoundingClientRect();
        // Calculate offset from the start of the workspace area
        const offsetX = e.clientX - workspaceRect.left;
        const percentage = (offsetX / workspaceRect.width) * 100;
        // Limit split ratio between 20% and 80%
        setSplitRatio(Math.max(20, Math.min(percentage, 80)));
      }
    };

    const handleMouseUp = () => {
      setIsDraggingSidebar(false);
      setIsDraggingSplit(false);
    };

    if (isDraggingSidebar || isDraggingSplit) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      // Disable text selection while dragging to prevent highlighting text
      document.body.style.userSelect = 'none';
      if (isDraggingSidebar) {
        document.body.style.cursor = 'col-resize';
      } else if (isDraggingSplit) {
        document.body.style.cursor = 'col-resize';
      }
    } else {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [isDraggingSidebar, isDraggingSplit]);

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setAiState(prev => ({
        ...prev,
        isThinking: false,
        error: null,
        stopMessage: t('home.stopped_manually', "已手动停止生成"),
        progressStep: '',
        progress: 0
      }));
    }
  };

  const calculateEstimate = (textLength: number) => {
    // Estimate: ~15s per 10k chars + 5s overhead
    return Math.ceil(textLength / 10000 * 15) + 5;
  };

  const handleProcess = async () => {
    if (!inputText) return;
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    setAiState({ isThinking: true, error: null, stopMessage: null, progressStep: t('home.analyzing', '正在分析文档结构...'), progress: 0 });
    setOutputText('');
    setImageMap({});
    setShouldAutoScroll(true); // 每次新生成重置自动滚动
    textBufferRef.current = '';
    if (rafIdRef.current !== null) {
      clearTimeout(rafIdRef.current);
      rafIdRef.current = null;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      await generateDocumentViaBackend(
        {
          content: inputText,
          preset: selectedPreset,
          fileName: inputFileName,
          styleConfig: activeStyle,
          model: selectedModel,
        },
        (partialText, progressData, newImageMap) => {
          if (abortControllerRef.current === null) return;
          if (newImageMap) {
            setImageMap(prev => ({ ...prev, ...newImageMap }));
          }
          if (progressData) {
            const pct = Math.round((progressData.current / progressData.total) * 100);
            const remaining = progressData.estimatedRemainingSeconds
              ? t('home.estimated_time', ' (预计剩余 {{seconds}} 秒)', { seconds: Math.ceil(progressData.estimatedRemainingSeconds) })
              : '';

            let displayStatus = progressData.status;
            if (displayStatus === 'GENERATING') {
              displayStatus = t('home.status_generating', '正在智能排版...');
            } else if (displayStatus.startsWith('PARTIAL_GENERATING|')) {
              const [, cur, tot] = displayStatus.split('|');
              displayStatus = t('home.status_partial_generating', '正在生成第 {{cur}}/{{tot}} 部分...', { cur, tot });
            } else if (displayStatus.startsWith('PART_COMPLETE|')) {
              const [, cur, tot] = displayStatus.split('|');
              displayStatus = t('home.status_part_complete', '第 {{cur}}/{{tot}} 部分完成', { cur, tot });
            }

            setAiState(prev => ({
              ...prev,
              progress: Math.max(prev.progress, pct),
              progressStep: `${displayStatus}${remaining}`
            }));
          }
          // Buffer incoming text; flush to DOM every 80ms (reduces DOM thrashing on long docs)
          if (partialText !== textBufferRef.current) {
            textBufferRef.current = partialText;
            if (rafIdRef.current === null) {
              rafIdRef.current = setTimeout(() => {
                setOutputText(textBufferRef.current);
                rafIdRef.current = null;
              }, 80);
            }
          }
        },
        controller.signal
      );

      // Generation complete
      if (abortControllerRef.current !== null) {
        setAiState(prev => ({ ...prev, progress: 100, progressStep: t('home.generation_complete', '排版生成完毕') }));
        // Flush: cancel any pending timer and show final text
        if (rafIdRef.current !== null) {
          clearTimeout(rafIdRef.current);
          rafIdRef.current = null;
        }
        setOutputText(textBufferRef.current);
        // Brief pause for React to finish rendering, then trigger KaTeX (runs when isThinking=false)
        setAiState(prev => ({ ...prev, progressStep: t('home.rendering', '正在应用排版格式...') }));
        await new Promise(r => setTimeout(r, 300));
        setAiState({ isThinking: false, error: null, stopMessage: null, progressStep: t('home.done', '完成'), progress: 0 });
        setViewMode('preview'); // 生成完成后自动切换到全宽预览模式
        setShowToast(true);
        setTimeout(() => setShowToast(false), 3000);
        setDownloadHighlight(true);
        setTimeout(() => setDownloadHighlight(false), 2500);
        await refreshUser();
      }

    } catch (err: any) {
      if (err.message === 'QUOTA_EXCEEDED') {
        setAiState({ isThinking: false, error: t('home.quota_exceeded', "免费额度已用尽，升级 Pro 享受更多生成次数"), stopMessage: null, progressStep: '', progress: 0 });
        setTimeout(() => setShowPricingModal(true), 1000);
      } else if (err.message === 'LOGIN_REQUIRED') {
        setAiState({ isThinking: false, error: t('home.login_required', "登录已失效,请重新登录"), stopMessage: null, progressStep: '', progress: 0 });
        setTimeout(() => setShowAuthModal(true), 1000);
      } else if (err.message === 'ABORT_ERR' || err.name === 'AbortError') {
        setAiState({ isThinking: false, error: null, stopMessage: t('home.stopped_manually', "已手动停止生成"), progressStep: '', progress: 0 });
      } else {
        console.error("Processing error:", err);
        setAiState({ isThinking: false, error: err.message || t('home.processing_failed', "文档处理失败,请重试。"), stopMessage: null, progressStep: '', progress: 0 });
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
    }
  };

  const handleDownload = async () => {
    if (!outputText) return;
    try {
      // If user has edited content, read directly from the DOM
      let docxReadyHtml: string;
      if (isContentEdited && previewContentRef.current) {
        // Strip KaTeX-rendered spans — docxGenerator cannot handle KaTeX HTML.
        // Replace each .katex element with the raw TeX source stored in the <annotation> tag.
        const tmp = document.createElement('div');
        tmp.innerHTML = previewContentRef.current.innerHTML;
        tmp.querySelectorAll('span.katex').forEach(katexEl => {
          const annotation = katexEl.querySelector('annotation[encoding="application/x-tex"]');
          const tex = annotation?.textContent?.trim() ?? '';
          const isDisplay = katexEl.closest('.katex-display') !== null;
          katexEl.replaceWith(document.createTextNode(isDisplay ? `$$${tex}$$` : `$${tex}$`));
        });
        docxReadyHtml = tmp.innerHTML;
      } else {
        // Restore __IMG_N__ placeholders before export (same as renderedContent step 2,
        // but WITHOUT KaTeX — KaTeX HTML would break docxGenerator)
        // Also strip any FORMULA_DATA marker that was appended during file parsing
        docxReadyHtml = outputText.replace(/```html/gi, '').replace(/```/g, '');
      }
      if (!isContentEdited) {
        const formulaMarkerIdx = docxReadyHtml.indexOf('<!-- FORMULA_DATA -->');
        if (formulaMarkerIdx !== -1) {
          docxReadyHtml = docxReadyHtml.substring(0, formulaMarkerIdx);
        }
        if (Object.keys(imageMap).length > 0) {
          docxReadyHtml = docxReadyHtml.replace(/__IMG_\d+__/g, (match) => imageMap[match] || match);
        }
      }
      // Inject TOC placeholder if generateToc is enabled and no existing TOC placeholder
      if (activeStyle.generateToc && !docxReadyHtml.includes('toc-placeholder') && !docxReadyHtml.includes('TOC_PLACEHOLDER')) {
        docxReadyHtml = docxReadyHtml.replace(
          /(<h[1-6](?![^>]*doc-title)[^>]*>)/i,
          '<h1 class="toc-placeholder">目录</h1>\n$1'
        );
      }
      const blob = await generateDocx(docxReadyHtml, activeStyle);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const downloadName = inputFileName.substring(0, inputFileName.lastIndexOf('.')) || inputFileName;
      link.download = `DocFlow_${downloadName}.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export failed", e);
      alert(t('home.export_failed', "导出失败，请重试"));
    }
  };

  const handleCopyOutput = async () => {
    if (!outputText) return;
    try {
      const plainText = isContentEdited && previewContentRef.current
        ? previewContentRef.current.innerText.trim()
        : outputText.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      await navigator.clipboard.writeText(plainText);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (e) {
      console.error('Copy failed', e);
    }
  };

  // Rich editor: update TOC from DOM after user edits
  const updateTocFromDom = useCallback(() => {
    if (!previewContentRef.current) return;
    const headings = Array.from(previewContentRef.current.querySelectorAll('h1,h2,h3,h4,h5,h6')) as HTMLElement[];
    const items = headings
      .filter(h => !h.classList.contains('doc-title') && h.textContent?.trim())
      .map((h, i) => {
        // Ensure every heading has an id so scrollToHeading works after user edits
        if (!h.id) h.id = `toc-h-edit-${i}`;
        return { id: h.id, level: parseInt(h.tagName[1]), text: h.textContent!.trim() };
      });
    setTocItems(items);
  }, []);

  const handleContentEdit = useCallback(() => {
    if (!isContentEdited) setIsContentEdited(true);
    updateTocFromDom();
  }, [isContentEdited, updateTocFromDom]);

  // handleResetContent is defined after renderedContent useMemo
  const handleResetContentRef = useRef<() => void>();

  const execFormat = useCallback((command: string, value?: string) => {
    // Restore saved selection before executing so toggle (e.g. un-bold) works correctly
    const selection = window.getSelection();
    if (savedRangeRef.current && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRangeRef.current);
    }
    document.execCommand(command, false, value);
    previewContentRef.current?.focus();
    handleContentEdit();
    setTimeout(updateActiveFormats, 10);
  }, [handleContentEdit, updateActiveFormats]);

  const execHeading = useCallback((level: string) => {
    // Restore saved selection (select onChange loses editor focus/range)
    const selection = window.getSelection();
    if (savedRangeRef.current && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRangeRef.current);
    }
    document.execCommand('formatBlock', false, level === 'p' ? 'p' : `h${level}`);
    previewContentRef.current?.focus();
    handleContentEdit();
    setTimeout(updateActiveFormats, 10);
  }, [handleContentEdit, updateActiveFormats]);

  const handleStyleUpdate = (newConfig: StyleConfig) => {
    setCurrentStyles(prev => ({
      ...prev,
      [selectedPreset]: newConfig
    }));
  };

  const getPreviewFontStack = (fontVal: string) => {
    if ((fontVal.includes("SimSun") || fontVal.includes("Songti") || fontVal.includes("Heiti") || fontVal.includes("KaiTi")) && !fontVal.toLowerCase().startsWith('"times')) {
      const clean = fontVal.replace(/"Times New Roman",/g, '').replace(/Times New Roman,/g, '');
      return `"Times New Roman", ${clean}`;
    }
    return fontVal;
  };

  const toCssVal = (val: string) => {
    if (!val) return '0';
    if (val.includes('行')) {
      return `calc(${parseFloat(val)} * 1.5em)`;
    }
    return val;
  };

  // Memoize KaTeX and Image rendering — only re-compute when outputText actually changes
  const renderedContent = useMemo(() => {
    if (!outputText) return '';

    // 1. Clean Markdown ```html block quotes if they exist in the stream
    let processedText = outputText.replace(/```html/gi, '').replace(/```/g, '');

    // Inject typing cursor token at the absolute end of the stream string
    if (aiState.isThinking) {
      processedText += '___AI_CURSOR_TOKEN___';
    }

    // 2. Restore Image Placeholders
    if (Object.keys(imageMap).length > 0) {
      processedText = processedText.replace(/__IMG_\d+__/g, (match) => {
        return imageMap[match] || match;
      });
    }

    // 3. Strip AI-generated inline font styles so preset CSS takes effect
    processedText = processedText.replace(/(\s+style=")([^"]*?)(")/gi, (_m, open, styleContent: string, close) => {
      const cleaned = styleContent
        .split(';')
        .filter(decl => {
          const prop = decl.split(':')[0]?.trim().toLowerCase() || '';
          return !['font-size', 'font-family', 'line-height'].includes(prop);
        })
        .join(';')
        .trim()
        .replace(/;$/, '');
      return cleaned ? `${open}${cleaned}${close}` : '';
    });

    // 3.5 Inject heading IDs for TOC navigation anchors
    let headingCounter = 0;
    processedText = processedText.replace(/<(h[1-6])(\s[^>]*)?>/gi, (_m: string, tag: string, attrs: string = '') => {
      if (/\bid=/.test(attrs)) return `<${tag}${attrs}>`;
      return `<${tag} id="toc-h-${headingCounter++}"${attrs}>`;
    });

    // 4. During streaming: style complete formula blocks as code placeholders (no KaTeX yet — too expensive per frame)
    if (aiState.isThinking) {
      return processedText.replace(/(\$\$[\s\S]*?\$\$|\$[^\$\n]+\$)/g, (match) => {
        const isDisplay = match.startsWith('$$');
        const tex = (isDisplay ? match.slice(2, -2) : match.slice(1, -1)).trim();
        if (isDisplay) {
          return `<div style="font-family:ui-monospace,monospace;text-align:center;margin:0.75em auto;padding:8px 16px;background:#f8f9fa;border:1px solid #e9ecef;border-radius:6px;color:#495057;font-size:0.875em;">${tex}</div>`;
        }
        return `<code style="font-family:ui-monospace,monospace;background:#f1f3f5;padding:1px 5px;border-radius:3px;font-size:0.875em;color:#495057;">${tex}</code>`;
      }).replace('___AI_CURSOR_TOKEN___', '<span id="ai-typing-cursor" class="inline-block w-[6px] h-[15px] bg-slate-400 ml-1 mb-[-2px] animate-[pulse_0.8s_ease-in-out_infinite] rounded-sm align-middle"></span>');
    }

    // 5. After streaming: render with KaTeX — Match Display Math ($$...$$) OR Inline Math ($...$)
    const finalText = processedText.replace(/(\$\$[\s\S]*?\$\$|\$([^\$\n]+)\$)/g, (match) => {
      try {
        const isDisplay = match.startsWith('$$');
        const tex = isDisplay
          ? match.substring(2, match.length - 2)
          : match.substring(1, match.length - 1);

        const cleanTex = tex.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

        return katex.renderToString(cleanTex, {
          throwOnError: false,
          displayMode: isDisplay,
          output: 'html'
        });
      } catch (e) {
        return match;
      }
    });

    // Finally, replace the token with the actual blinking cursor HTML
    // It is injected as a string, letting the browser's HTML parser elegantly wrap it in open tags (e.g. <p>) automatically
    return finalText.replace('___AI_CURSOR_TOKEN___', '<span id="ai-typing-cursor" class="inline-block w-[6px] h-[15px] bg-slate-400 ml-1 mb-[-2px] animate-[pulse_0.8s_ease-in-out_infinite] rounded-sm align-middle"></span>');
  }, [outputText, imageMap, aiState.isThinking]);

  // TOC extraction is now done inside useLayoutEffect below — no DOMParser, no debounce.

  // Assign reset content handler
  useEffect(() => {
    handleResetContentRef.current = () => {
      if (!previewContentRef.current || !renderedContent) return;
      previewContentRef.current.innerHTML = renderedContent;
      setIsContentEdited(false);
      updateTocFromDom();
    };
  }, [renderedContent, updateTocFromDom]);

  // Track isContentEdited in a ref so the innerHTML effect doesn't re-run on edit state change.
  // This prevents React from ever touching the DOM of the contentEditable during user editing.
  const isContentEditedRef = useRef(false);
  useEffect(() => { isContentEditedRef.current = isContentEdited; }, [isContentEdited]);

  // Single useLayoutEffect handles three jobs in one synchronous pass (before browser paint):
  //   1. Write innerHTML imperatively — bypasses React reconciliation on contentEditable
  //   2. Extract TOC directly from the rendered DOM — no DOMParser re-parse, no debounce
  //   3. Measure real content height for live page count
  // This eliminates the old 300ms TOC debounce + separate DOMParser pass, keeping content
  // and TOC perfectly in sync with each streaming chunk.
  useLayoutEffect(() => {
    const el = previewContentRef.current;
    if (!el) return;

    // 1. Update innerHTML only when not in user-edit mode
    if (!isContentEditedRef.current) {
      el.innerHTML = renderedContent;
    }

    // 2. Handle cleared content
    if (!renderedContent) {
      setTocItems([]);
      prevTocCountRef.current = 0;
      setContentPageCount(1);
      return;
    }

    // 3. Extract TOC from already-rendered DOM nodes — O(headings), not O(html string length)
    const headings = Array.from(el.querySelectorAll('h1,h2,h3,h4,h5,h6')) as HTMLElement[];
    const items = headings
      .filter(h => !h.classList.contains('doc-title') && h.textContent?.trim())
      .map((h, i) => {
        if (!h.id) h.id = `toc-h-${i}`; // write ID back so scrollToHeading can find it
        return { id: h.id, level: parseInt(h.tagName[1]), text: h.textContent!.trim() };
      });

    // Fade-in animation for newly appeared headings
    const prevCount = prevTocCountRef.current;
    if (items.length > prevCount) {
      const ids = new Set(items.slice(prevCount).map(item => item.id));
      setNewTocIds(ids);
      setTimeout(() => setNewTocIds(new Set()), 700);
    }
    prevTocCountRef.current = items.length;
    setTocItems(items);

    // 4. Real page count from actual scroll height
    const totalH = el.scrollHeight + A4_PADDING_PX;
    setContentPageCount(Math.max(1, Math.ceil(totalH / A4_HEIGHT_PX)));
  }, [renderedContent, viewMode]); // viewMode dep: re-init when switching preview ↔ split

  const scrollToHeading = (id: string) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Detect if the current output contains math formulas (for streaming hint)
  const hasFormulas = useMemo(() => /\$[\s\S]+?\$/.test(outputText), [outputText]);

  const generatePreviewStyles = () => {
    const s = activeStyle;
    return `
      @keyframes fadeInUp {
        from { opacity: 0; transform: translateY(8px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes shimmer {
        0%   { transform: translateX(-100%); }
        100% { transform: translateX(200%); }
      }
      #preview-content {
        animation: fadeInUp 0.35s ease;
        font-family: ${getPreviewFontStack(s.fontFamily)};
        font-size: ${s.baseSize};
        line-height: ${s.lineHeight};
        color: #1a1a1a;
        text-align: ${s.bodyAlign};
        ${s.columns && s.columns > 1 ? `column-count: ${s.columns}; column-gap: 2em;` : ''}
      }
      #preview-content p, #preview-content div:not(.katex-display):not(.math-display):not(.figure-caption):not(.table-caption):not(.doc-title):not(.doc-title-en):not(.author-info):not(.affiliation):not(.abstract-cn):not(.abstract-en):not(.cover-page) { margin-top: ${toCssVal(s.spacingBefore)}; margin-bottom: ${toCssVal(s.spacingAfter)}; text-indent: ${s.textIndent}; }
      /* 表格内部的 div/p 不要缩进 */
      #preview-content td div, #preview-content th div, #preview-content td p, #preview-content th p { text-indent: 0 !important; margin: 0; }

      /* Format Defenses: Protect alignments and lists from global text-indent / margin logic */
      #preview-content [style*="text-align: center"], #preview-content [style*="text-align: right"], #preview-content [align="center"], #preview-content [align="right"], #preview-content center { text-indent: 0 !important; }
      #preview-content [style*="text-align: justify"], #preview-content [align="justify"] { text-align: justify !important; }
      #preview-content ul { list-style-type: disc; padding-left: 2.5em; margin-top: ${toCssVal(s.spacingBefore)}; margin-bottom: ${toCssVal(s.spacingAfter)}; }
      #preview-content ol { list-style-type: decimal; padding-left: 2.5em; margin-top: ${toCssVal(s.spacingBefore)}; margin-bottom: ${toCssVal(s.spacingAfter)}; }
      #preview-content li { margin-bottom: 0.5em; }
      #preview-content li p, #preview-content li div { margin: 0; text-indent: 0 !important; }
      #preview-content b, #preview-content strong { font-weight: bold; }
      #preview-content i, #preview-content em { font-style: italic; }
      #preview-content h1 { font-family: ${getPreviewFontStack(s.h1Font || s.headingFont)}; font-size: ${s.h1Size}; font-weight: ${s.h1Bold ? 'bold' : 'normal'}; text-align: ${s.h1Align}; margin-top: ${toCssVal(s.spacingBefore)}; margin-bottom: ${toCssVal(s.spacingAfter)}; text-indent: ${s.h1Indent}; column-span: all; }
      #preview-content h2 { font-family: ${getPreviewFontStack(s.h2Font || s.headingFont)}; font-size: ${s.h2Size}; font-weight: ${s.h2Bold ? 'bold' : 'normal'}; text-align: ${s.h2Align}; margin-top: ${toCssVal(s.spacingBefore)}; margin-bottom: ${toCssVal(s.spacingAfter)}; text-indent: ${s.h2Indent}; }
      #preview-content h3 { font-family: ${getPreviewFontStack(s.h3Font || s.headingFont)}; font-size: ${s.h3Size}; font-weight: ${s.h3Bold ? 'bold' : 'normal'}; margin-top: ${toCssVal(s.spacingBefore)}; margin-bottom: ${toCssVal(s.spacingAfter)}; text-indent: ${s.h3Indent}; }
      #preview-content h4 { font-family: ${getPreviewFontStack(s.h4Font || s.headingFont)}; font-size: ${s.h4Size}; font-weight: ${s.h4Bold ? 'bold' : 'normal'}; margin-top: ${toCssVal(s.spacingBefore)}; margin-bottom: ${toCssVal(s.spacingAfter)}; text-indent: ${s.h4Indent}; }
      #preview-content .doc-title { text-indent: 0; font-size: 26pt; text-align: center; margin-bottom: 1em; column-span: all; }
      #preview-content table { width: 100%; border-collapse: collapse; margin: 1em 0; font-family: ${getPreviewFontStack(s.tableFont)}; font-size: ${s.tableSize}; }
      #preview-content th, #preview-content td { border: 1px solid #e5e5e5; padding: 8px 12px; text-align: left; text-indent: 0; }
      #preview-content td p, #preview-content th p { text-indent: 0; margin: 0; }
      #preview-content td li, #preview-content th li { text-indent: 0; }
      #preview-content th { background-color: #f9fafb; font-weight: 600; }
      #preview-content .table-caption, #preview-content caption { text-align: ${s.tableCaptionAlign}; font-family: ${getPreviewFontStack(s.tableCaptionFont)}; font-size: ${s.tableCaptionSize}; font-weight: 600; margin-bottom: 8px; display: block; }
      #preview-content .figure-caption { text-align: ${s.figureAlign || 'center'}; font-family: ${getPreviewFontStack(s.figureFont || s.fontFamily)}; font-size: ${s.figureSize || '9pt'}; font-weight: 600; margin-top: 12px; margin-bottom: 24px; }
      
      /* Formula & Pre Overflow handling */
      #preview-content .katex-display, #preview-content .math-display { max-width: 100%; overflow-x: auto; overflow-y: hidden; text-indent: 0; }
      #preview-content pre { max-width: 100%; overflow-x: auto; }
      
      /* Hide scrollbar visually but keep scrollable to maintain the cleanest A4 look */
      #preview-content .katex-display::-webkit-scrollbar, #preview-content .math-display::-webkit-scrollbar, #preview-content pre::-webkit-scrollbar { display: none; }
      
      .katex { font-size: 1.1em; }
      @keyframes tocFadeIn {
        from { opacity: 0; transform: translateX(-6px); }
        to   { opacity: 1; transform: translateX(0); }
      }
    `;
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white sticky top-0 z-50">
        <div className="w-full px-4 md:px-6 lg:px-8 h-14 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 bg-black rounded-lg flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                </svg>
              </div>
              <span className="text-lg font-semibold text-gray-900">DocFlow AI</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowPRD(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-900 transition-colors bg-gray-50 hover:bg-gray-100 rounded-full border border-gray-200"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
                <line x1="12" y1="17" x2="12.01" y2="17"></line>
              </svg>
              {t('nav.help', '帮助')}
            </button>
            <div className="w-px h-6 bg-gray-200 mx-2"></div>
            <UserInfo
              onOpenPricing={() => setShowPricingModal(true)}
              onOpenAuth={() => setShowAuthModal(true)}
              onOpenProfile={() => setShowProfileModal(true)}
              onOpenAdmin={() => navigate('/admin')}
            />
          </div>
        </div>
      </header>

      <main className="w-full px-4 md:px-6 lg:px-8 py-4 md:py-6">
        <div ref={workspaceRef} className="flex flex-col md:flex-row gap-4 md:gap-6 h-auto md:h-[calc(100vh-100px)]">

          {/* Left Panel */}
          <div
            className="hidden md:flex flex-col flex-shrink-0 relative"
            style={{
              width: sidebarCollapsed ? 48 : sidebarWidth,
              minWidth: sidebarCollapsed ? 48 : undefined,
              transition: 'width 0.25s cubic-bezier(0.4,0,0.2,1)',
            }}
          >
            {sidebarCollapsed ? (
              /* Collapsed strip */
              <div className="flex-1 flex flex-col items-center pt-4 gap-5">
                <button
                  onClick={() => setSidebarCollapsed(false)}
                  className="w-8 h-8 rounded-lg bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
                  title={t('home.expand_sidebar', '展开侧边栏')}
                >
                  <svg className="w-3.5 h-3.5 text-gray-600 rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                {[t('home.upload_doc', '上传'), t('home.select_preset', '模板'), t('home.start_generate', '生成')].map((label, i) => (
                  <button
                    key={i}
                    onClick={() => setSidebarCollapsed(false)}
                    className="w-6 h-6 bg-gray-900 hover:bg-gray-700 text-white rounded-md flex items-center justify-center text-xs font-bold transition-colors cursor-pointer"
                    title={label}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
            ) : (
              <>
                {/* Drag Handle */}
                <div
                  className="absolute -right-2 md:-right-3 lg:-right-4 top-0 bottom-0 w-4 cursor-col-resize z-10"
                  onMouseDown={handleSidebarMouseDown}
                  title={t('home.drag_resize', '拖拽调整宽度')}
                />

                {/* Collapse button */}
                <button
                  onClick={() => setSidebarCollapsed(true)}
                  className="absolute right-2 top-2 p-1.5 text-gray-300 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors z-20"
                  title="收起侧边栏"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>

            {/* Three steps wrapper */}
            <div className="flex flex-col gap-4">

            {/* Upload Section */}
            <div className={`bg-white border border-gray-200 rounded-xl p-4 flex-shrink-0 transition-opacity duration-300 ${aiState.isThinking ? 'opacity-50 pointer-events-none' : 'opacity-100'}`} title={aiState.isThinking ? t('home.wait_for_generation', '生成完成后可操作') : undefined}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 bg-gray-900 text-white rounded-md flex items-center justify-center text-xs font-bold">1</div>
                <h2 className="text-sm font-semibold text-gray-900">{t('home.upload_doc', '上传文档')}</h2>
              </div>

              {!inputText ? (
                <FileDropzone onFileLoaded={handleFileLoaded} userTier={user?.subscriptionStatus} />
              ) : (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-8 h-8 bg-white border border-gray-200 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                      </svg>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate" title={inputFileName}>{inputFileName}</p>
                      <p className="text-xs text-gray-400">{getTextCount(inputText).toLocaleString()} {t('home.chars', '字')}</p>
                    </div>
                  </div>
                  <button onClick={handleClear} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            {/* Preset Section */}
            <div className={`bg-white border border-gray-200 rounded-xl p-4 flex-shrink-0 transition-opacity duration-300 ${aiState.isThinking ? 'opacity-50 pointer-events-none' : 'opacity-100'}`} title={aiState.isThinking ? t('home.wait_for_generation', '生成完成后可操作') : undefined}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 bg-gray-900 text-white rounded-md flex items-center justify-center text-xs font-bold">2</div>
                  <h2 className="text-sm font-semibold text-gray-900">{t('home.select_preset', '选择模板')}</h2>
                </div>
                <button
                  onClick={() => setStyleEditorOpen(true)}
                  className="text-xs text-gray-500 hover:text-gray-900 flex items-center gap-1"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3"></circle>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                  </svg>
                  {t('home.custom', '自定义')}
                </button>
              </div>

              <div className="-mx-1 px-1">
                <div className="grid grid-cols-2 gap-2">
                  {PRESETS.map(preset => (
                    <PresetCard
                      key={`${preset.id}-${i18n.language}`}
                      config={preset}
                      isSelected={selectedPreset === preset.id}
                      onSelect={setSelectedPreset}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Step 3: Generate */}
            <div className={`bg-white border border-gray-200 rounded-xl p-4 flex-shrink-0 transition-opacity duration-300 ${aiState.isThinking ? 'opacity-60' : 'opacity-100'}`}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 bg-gray-900 text-white rounded-md flex items-center justify-center text-xs font-bold">3</div>
                <h2 className="text-sm font-semibold text-gray-900">{t('home.start_generate', '开始生成')}</h2>
              </div>

              {/* Model Selector */}
              <div className="mb-3" ref={modelDropdownRef}>
                <p className="text-xs text-gray-400 mb-1.5">{t('home.model', '生成模型')}</p>
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => !aiState.isThinking && setModelDropdownOpen(v => !v)}
                    disabled={aiState.isThinking}
                    className="w-full flex items-center justify-between px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-left"
                  >
                    <span className="font-medium text-gray-800">
                      {MODEL_OPTIONS.find(m => m.key === selectedModel)?.name ?? selectedModel}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-gray-400">
                        {t(MODEL_OPTIONS.find(m => m.key === selectedModel)?.descKey ?? '')}
                      </span>
                      <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-150 ${isModelDropdownOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M6 9l6 6 6-6" />
                      </svg>
                    </div>
                  </button>
                  {isModelDropdownOpen && (
                    <div className="absolute bottom-full mb-1 left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-50 overflow-hidden">
                      {MODEL_OPTIONS.map(opt => (
                        <button
                          key={opt.key}
                          type="button"
                          onClick={() => { setSelectedModel(opt.key); setModelDropdownOpen(false); }}
                          className={`w-full flex items-center justify-between px-3 py-2.5 text-sm transition-colors text-left ${selectedModel === opt.key ? 'bg-gray-50' : 'hover:bg-gray-50'}`}
                        >
                          <span className={`font-medium ${selectedModel === opt.key ? 'text-gray-900' : 'text-gray-700'}`}>
                            {opt.name}
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-gray-400">{t(opt.descKey)}</span>
                            {selectedModel === opt.key && (
                              <svg className="w-3.5 h-3.5 text-gray-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M20 6L9 17l-5-5" />
                              </svg>
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Action Button */}
              <div>
                {aiState.isThinking ? (
                  <button
                    onClick={handleStop}
                    className="w-full py-3 bg-white border-2 border-red-200 text-red-600 rounded-xl font-medium text-sm flex items-center justify-center gap-2 hover:bg-red-50 transition-colors"
                  >
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                    </span>
                    {t('home.stop_generation', '停止生成')}
                  </button>
                ) : (
                  <>
                    <button
                      onClick={handleProcess}
                      disabled={!inputText}
                      className={`w-full py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all ${!inputText
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-gray-900 text-white hover:bg-gray-800 shadow-sm'
                        }`}
                    >
                      {t('home.start_process', '开始智能重排')}
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </button>
                    {inputText && (
                      <p className="text-center text-[10px] text-gray-300 mt-1.5">
                        {typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌘' : 'Ctrl'}+Enter
                      </p>
                    )}
                  </>
                )}

                {aiState.isThinking && (
                  <div className="mt-3 flex items-center justify-center gap-2 text-xs text-gray-500">
                    <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>{aiState.progressStep}</span>
                  </div>
                )}

                {aiState.error && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-lg">
                    <p className="text-xs text-red-600">{aiState.error}</p>
                  </div>
                )}
                {aiState.stopMessage && !aiState.error && (
                  <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg flex items-center gap-2">
                    <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="8" x2="12" y2="12"></line>
                      <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                    <p className="text-xs text-gray-500">{aiState.stopMessage}</p>
                  </div>
                )}
              </div>
            </div>

            </div>{/* end scrollable wrapper */}
              </>
            )}
          </div>

          {/* Right Panel - Preview */}
          <div className="flex-1 flex flex-col min-w-0 bg-white border border-gray-200 rounded-xl overflow-hidden shadow-[0_0_15px_rgba(0,0,0,0.02)]">
            {/* Toolbar */}
            <div className="h-12 px-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
              <div className="flex items-center gap-3">
                {/* Expand sidebar button — only when collapsed */}
                {sidebarCollapsed && (
                  <button
                    onClick={() => setSidebarCollapsed(false)}
                    className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                    title="展开侧边栏"
                  >
                    <svg className="w-4 h-4 rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M15 18l-6-6 6-6" />
                    </svg>
                  </button>
                )}
                <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-0.5">
                  <button
                    onClick={() => setViewMode('preview')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === 'preview' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900'}`}
                  >
                    {t('home.preview_view', '结果预览')}
                  </button>
                  <button
                    onClick={() => setViewMode('split')}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === 'split' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900'}`}
                  >
                    {t('home.split_view', '原文对比')}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {outputText && !aiState.isThinking && (
                  <>
                    <button
                      onClick={handleCopyOutput}
                      className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-xl hover:border-gray-300 hover:bg-gray-50 transition-all"
                      title={t('home.copy_output', '复制内容')}
                    >
                      {isCopied ? (
                        <>
                          <svg className="w-4 h-4 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          <span className="text-green-600 font-medium">{t('home.copied', '已复制 ✓')}</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                          </svg>
                          <span>{t('home.copy_output', '复制内容')}</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => { handleDownload(); setDownloadHighlight(false); }}
                      className={`flex items-center gap-2 bg-gray-900 text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-gray-800 transition-all shadow-sm ${downloadHighlight ? 'ring-2 ring-offset-2 ring-green-400 scale-105' : 'ring-0 scale-100'}`}
                    >
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      {t('home.download_docx', '下载 .docx')}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 flex min-h-0">
              {/* Original */}
              {viewMode === 'split' && inputText && (
                <div
                  className="border-r border-gray-100 flex flex-col relative"
                  style={{ width: `${splitRatio}%` }}
                >
                  <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-400 uppercase tracking-wider">
                    {t('home.original_text', '原文')}
                  </div>
                  <div className="flex-1 overflow-auto p-6 text-sm text-gray-600 leading-relaxed custom-scrollbar">
                    {inputFileName.endsWith('.docx') ? (
                      <div
                        dangerouslySetInnerHTML={{ __html: inputText }}
                        className="[&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-gray-200 [&_th]:p-2 [&_th]:bg-gray-50 [&_td]:border [&_td]:border-gray-200 [&_td]:p-2"
                      />
                    ) : (
                      <div className="font-mono whitespace-pre-wrap">{inputText}</div>
                    )}
                  </div>

                  {/* Invisible Split Pane Drag Handle */}
                  <div
                    className="absolute -right-2 top-0 bottom-0 w-4 cursor-col-resize transition-colors z-10"
                    onMouseDown={handleSplitMouseDown}
                    title={t('home.drag_resize', '拖拽调整宽度')}
                  />
                </div>
              )}

              {/* Result */}
              <div
                className="flex flex-col"
                style={{ width: viewMode === 'split' && inputText ? `${100 - splitRatio}%` : '100%' }}
              >
                <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{t('home.result_text', '结果')}</span>
                    {outputText && !aiState.isThinking && (
                      <span className="text-xs text-gray-400">{getTextCount(outputText).toLocaleString()} {t('home.chars', '字')}</span>
                    )}
                    {/* Rich editor toolbar movable to left block */}
                    {outputText && !aiState.isThinking && viewMode === 'preview' && (
                      <>
                        <div className="w-px h-4 bg-gray-200 mx-1 lg:mx-2" />
                        <div className="flex items-center gap-0.5 md:gap-1" onMouseDown={(e) => { if ((e.target as HTMLElement).tagName !== 'SELECT') { const sel = window.getSelection(); savedRangeRef.current = (sel && sel.rangeCount > 0) ? sel.getRangeAt(0).cloneRange() : null; e.preventDefault(); } }}>
                          <button onClick={() => execFormat('bold')} className={`w-7 h-7 flex items-center justify-center rounded text-xs font-bold transition-all ${activeFormats.bold ? 'bg-gray-800 text-white shadow-inner scale-95' : 'text-gray-500 hover:bg-gray-200 hover:text-gray-800'}`} title={t('home.bold', '加粗')}>B</button>
                          <button onClick={() => execFormat('italic')} className={`w-7 h-7 flex items-center justify-center rounded text-xs italic transition-all ${activeFormats.italic ? 'bg-gray-800 text-white shadow-inner scale-95' : 'text-gray-500 hover:bg-gray-200 hover:text-gray-800'}`} title={t('home.italic', '斜体')}>I</button>
                          <button onClick={() => execFormat('underline')} className={`w-7 h-7 flex items-center justify-center rounded text-xs underline transition-all ${activeFormats.underline ? 'bg-gray-800 text-white shadow-inner scale-95' : 'text-gray-500 hover:bg-gray-200 hover:text-gray-800'}`} title={t('home.underline', '下划线')}>U</button>
                          <div className="w-px h-4 bg-gray-200 mx-0.5 md:mx-1" />
                          <select
                            onMouseDown={() => { const sel = window.getSelection(); savedRangeRef.current = (sel && sel.rangeCount > 0) ? sel.getRangeAt(0).cloneRange() : null; }}
                            onChange={(e) => execHeading(e.target.value)}
                            value={activeFormats.heading ? activeFormats.heading.replace(/h/i, '') : 'p'}
                            className="text-xs px-1.5 py-1 bg-transparent border border-transparent rounded text-gray-500 hover:bg-white hover:border-gray-200 outline-none cursor-pointer font-medium"
                            title={t('home.heading_level', '标题级别')}
                          >
                            <option value="p">{t('home.normal_text', '正文')}</option>
                            <option value="1">H1</option>
                            <option value="2">H2</option>
                            <option value="3">H3</option>
                            <option value="4">H4</option>
                            <option value="5">H5</option>
                            <option value="6">H6</option>
                          </select>
                          <div className="w-px h-4 bg-gray-200 mx-0.5 md:mx-1" />
                          <button onClick={() => execFormat('justifyLeft')} className={`w-7 h-7 flex items-center justify-center rounded transition-all ${activeFormats.align === 'left' ? 'bg-gray-200 text-gray-800 shadow-inner scale-95' : 'text-gray-400 hover:bg-gray-200 hover:text-gray-700'}`} title={t('home.align_left', '左对齐')}>
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18 M3 12h12 M3 18h18" strokeLinecap="round"/></svg>
                          </button>
                          <button onClick={() => execFormat('justifyCenter')} className={`w-7 h-7 flex items-center justify-center rounded transition-all ${activeFormats.align === 'center' ? 'bg-gray-200 text-gray-800 shadow-inner scale-95' : 'text-gray-400 hover:bg-gray-200 hover:text-gray-700'}`} title={t('home.align_center', '居中对齐')}>
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18 M6 12h12 M3 18h18" strokeLinecap="round"/></svg>
                          </button>
                          <button onClick={() => execFormat('justifyRight')} className={`w-7 h-7 flex items-center justify-center rounded transition-all ${activeFormats.align === 'right' ? 'bg-gray-200 text-gray-800 shadow-inner scale-95' : 'text-gray-400 hover:bg-gray-200 hover:text-gray-700'}`} title={t('home.align_right', '右对齐')}>
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18 M9 12h12 M3 18h18" strokeLinecap="round"/></svg>
                          </button>
                          <div className="w-px h-4 bg-gray-200 mx-0.5 md:mx-1" />
                          <button onClick={() => execFormat('insertUnorderedList')} className={`w-7 h-7 flex items-center justify-center rounded transition-all ${activeFormats.list === 'ul' ? 'bg-gray-200 text-gray-800 shadow-inner scale-95' : 'text-gray-400 hover:bg-gray-200 hover:text-gray-700'}`} title={t('home.bullet_list', '无序列表')}>
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </button>
                          <button onClick={() => execFormat('insertOrderedList')} className={`w-7 h-7 flex items-center justify-center rounded transition-all ${activeFormats.list === 'ol' ? 'bg-gray-200 text-gray-800 shadow-inner scale-95' : 'text-gray-400 hover:bg-gray-200 hover:text-gray-700'}`} title={t('home.numbered_list', '有序列表')}>
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 6h11 M10 12h11 M10 18h11 M4 6h1v4 M4 10h2 M4 14h2 M4 18h2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </button>
                          <div className="w-px h-4 bg-gray-200 mx-0.5 md:mx-1" />
                          <button onClick={() => execFormat('removeFormat')} className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition-colors" title={t('home.clear_format', '清除格式')}>
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 7V4h14v3 M9 20h6 M12 4v16 M17 15l4 4 M21 15l-4 4" strokeLinecap="round" strokeLinejoin="round"/></svg>
                          </button>
                          <div className="w-px h-4 bg-gray-200 mx-0.5 md:mx-1" />
                          <button onClick={() => execFormat('undo')} className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition-colors" title={t('home.undo', '撤销')}>
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 10h10a5 5 0 0 1 0 10H9" /><path d="M3 10l4-4" /><path d="M3 10l4 4" /></svg>
                          </button>
                          <button onClick={() => execFormat('redo')} className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700 transition-colors" title={t('home.redo', '重做')}>
                            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10H11a5 5 0 0 0 0 10h4" /><path d="M21 10l-4-4" /><path d="M21 10l-4 4" /></svg>
                          </button>
                          {isContentEdited && (
                            <>
                              <div className="w-px h-4 bg-gray-200 mx-0.5 md:mx-1" />
                              <button onClick={() => handleResetContentRef.current?.()} className="px-1.5 py-1 text-xs text-amber-600 hover:bg-amber-100/50 rounded transition-colors font-medium border border-transparent" title={t('home.reset_content', '还原为 AI 原始内容')}>
                                {t('home.reset', '还原')}
                              </button>
                              <span className="text-[11px] text-emerald-500 font-medium flex items-center gap-1 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100/50">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-[pulse_2s_ease-in-out_infinite]" />
                                编辑
                              </span>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {selectedPreset && (
                      <span className="text-xs text-gray-500">{t(`home.preset_${selectedPreset.toLowerCase().replace('-', '_')}`, activePresetConfig.title)}</span>
                    )}
                  </div>
                </div>

                <style>{generatePreviewStyles()}</style>

                {/* TOC sidebar + preview content wrapper */}
                <div className="flex flex-1 min-h-0 overflow-hidden">
                  {/* TOC sidebar: only show when there is output content */}
                  {outputText && tocItems.length > 0 && viewMode === 'preview' && (
                    <div
                      className="flex-shrink-0 border-r border-gray-100 flex flex-col overflow-hidden transition-all duration-300"
                      style={{ width: tocCollapsed ? 32 : 200 }}
                    >
                      {/* Collapse toggle */}
                      <div className="flex items-center justify-between px-2 py-2 border-b border-gray-100 bg-gray-50/50">
                        {!tocCollapsed && <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">{t('home.toc', '目录')}</span>}
                        <button
                          onClick={() => setTocCollapsed(c => !c)}
                          className="p-1 text-gray-300 hover:text-gray-600 rounded ml-auto transition-colors"
                          title={tocCollapsed ? t('home.expand_toc', '展开目录') : t('home.collapse_toc', '收起目录')}
                        >
                          <svg className={`w-3 h-3 transition-transform ${tocCollapsed ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M15 18l-6-6 6-6" />
                          </svg>
                        </button>
                      </div>
                      {/* TOC entries */}
                      {!tocCollapsed && (
                        <div className="flex-1 overflow-y-auto py-2 custom-scrollbar">
                          {tocItems.map(item => (
                            <button
                              key={item.id}
                              onClick={() => scrollToHeading(item.id)}
                              className={`w-full text-left px-3 py-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded truncate transition-all ${newTocIds.has(item.id) ? 'animate-[tocFadeIn_0.4s_ease]' : ''}`}
                              style={{ paddingLeft: `${8 + (item.level - 1) * 10}px`, fontWeight: item.level === 1 ? 600 : 400 }}
                              title={item.text}
                            >
                              {item.text}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Preview container (original) */}
                  <div
                    className={`flex-1 overflow-auto ${viewMode === 'preview' ? 'bg-[#f0f0f0] p-6' : 'bg-white p-8'}`}
                    ref={previewContainerRef}
                    onScroll={handlePreviewScroll}
                  >
                    {outputText ? (
                      <>
                        {/* 生成中顶部流动进度条 */}
                        {aiState.isThinking && (
                          <div className="h-[2px] bg-gray-100 relative overflow-hidden flex-shrink-0">
                            <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-gray-500 to-transparent animate-[shimmer_1.5s_ease-in-out_infinite]" />
                          </div>
                        )}
                        {viewMode === 'preview' ? (
                          /* A4 纸张模式 */
                          <>

                            
                            <div
                              className="mx-auto bg-white border border-gray-200 mb-6 relative shadow-sm flex flex-col"
                              style={{ maxWidth: '794px', width: '100%', minHeight: '1123px', padding: '80px 90px 40px' }}
                            >
                              <div
                                id="preview-content"
                                ref={previewContentRef}
                                contentEditable={!aiState.isThinking}
                                suppressContentEditableWarning
                                spellCheck={false}
                                onInput={handleContentEdit}
                                onKeyUp={updateActiveFormats}
                                onMouseUp={updateActiveFormats}
                                className="outline-none min-h-[500px]"
                              />
                              {/* Page number footer */}
                              {outputText && (
                                <div className="mt-auto pt-4 border-t border-gray-100 flex items-center justify-between select-none pointer-events-none">
                                  <span className="text-xs text-gray-300 tracking-wide">DocFlow AI</span>
                                  <span className="text-xs text-gray-300 tabular-nums">
                                    {aiState.isThinking
                                      ? t('home.page_count_streaming', '已生成约 {{n}} 页', { n: contentPageCount })
                                      : t('home.page_count_total', '共 {{n}} 页', { n: contentPageCount })}
                                  </span>
                                </div>
                              )}
                            </div>
                            {/* Formula rendering hint — sticky at bottom during streaming */}
                            {aiState.isThinking && hasFormulas && (
                              <div style={{ position: 'sticky', bottom: 0 }} className="flex justify-center pb-3 pointer-events-none select-none">
                                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/90 border border-amber-100 rounded-full shadow-sm backdrop-blur-sm" style={{ animation: 'fadeInUp 0.4s ease' }}>
                                  <svg className="w-3 h-3 text-amber-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                                  </svg>
                                  <span className="text-xs text-gray-400">{t('home.formula_rendering_hint', '公式将在生成完成后自动渲染')}</span>
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          /* 对比模式：全宽无纸张效果 */
                          <>
                            <div
                              id="preview-content"
                              ref={!viewMode || viewMode !== 'preview' ? previewContentRef : undefined}
                              contentEditable={!aiState.isThinking}
                              suppressContentEditableWarning
                              spellCheck={false}
                              onInput={handleContentEdit}
                              className="outline-none"
                            />
                            {aiState.isThinking && hasFormulas && (
                              <div style={{ position: 'sticky', bottom: 0 }} className="flex justify-center pb-3 pointer-events-none select-none">
                                <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white/90 border border-amber-100 rounded-full shadow-sm backdrop-blur-sm" style={{ animation: 'fadeInUp 0.4s ease' }}>
                                  <svg className="w-3 h-3 text-amber-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                                  </svg>
                                  <span className="text-xs text-gray-400">{t('home.formula_rendering_hint', '公式将在生成完成后自动渲染')}</span>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </>
                    ) : aiState.isThinking ? (
                      /* 等待开始：极简状态区 */
                      <div className="h-full flex flex-col items-center justify-center gap-6">
                        {/* 三点足跡动画 */}
                        <div className="flex gap-1.5">
                          {[0, 1, 2].map(i => (
                            <div
                              key={i}
                              className="w-2 h-2 rounded-full bg-gray-300"
                              style={{ animation: `bounce 1.4s ease-in-out ${i * 0.16}s infinite` }}
                            />
                          ))}
                        </div>
                        <div className="text-center">
                          <p className="text-sm font-medium text-gray-700">{aiState.progressStep || t('home.processing_doc', '正在处理文档...')}</p>
                          <p className="mt-1 text-xs text-gray-400">{t('home.model_thinking', '模型思考中，请稍候')}</p>
                        </div>
                        {aiState.progress > 0 ? (
                          <div className="flex flex-col items-center gap-1.5">
                            <span className="text-xs text-gray-400 font-mono tabular-nums">{aiState.progress}%</span>
                            <div className="w-48 h-1 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-500 ${aiState.progress >= 100 ? 'bg-green-500' : 'bg-gray-400'}`}
                                style={{ width: `${aiState.progress}%` }}
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="w-48 h-1 bg-gray-100 rounded-full overflow-hidden relative">
                            <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-gray-400 to-transparent animate-[shimmer_1.5s_ease-in-out_infinite]" />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-gray-300">
                        <svg className="w-12 h-12 mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                          <rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect>
                          <line x1="8" y1="6" x2="16" y2="6"></line>
                          <line x1="8" y1="10" x2="16" y2="10"></line>
                          <line x1="8" y1="14" x2="12" y2="14"></line>
                        </svg>
                        <p className="text-sm text-gray-400">{t('home.upload_to_start', '上传文档开始排版')}</p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      <StyleEditor
        isOpen={isStyleEditorOpen}
        onClose={() => setStyleEditorOpen(false)}
        config={activeStyle}
        onUpdate={handleStyleUpdate}
        presetTitle={t(`home.preset_${selectedPreset.toLowerCase().replace('-', '_')}`, activePresetConfig.title)}
        presetId={selectedPreset}
        defaultConfig={activePresetConfig.styleConfig}
      />
      <ProductRequirements isOpen={showPRD} onClose={() => setShowPRD(false)} />
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
      <PricingModal isOpen={showPricingModal} onClose={() => setShowPricingModal(false)} />
      <UserProfileModal isOpen={showProfileModal} onClose={() => setShowProfileModal(false)} />

      {/* Toast Notification */}
      {showToast && (
        <div className="fixed top-6 left-1/2 transform -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-xl shadow-xl z-50 flex items-center gap-2" style={{ animation: 'fadeInDown 0.4s ease-out' }}>
          <svg className="w-5 h-5 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          <span className="font-medium">{t('home.toast_complete', '排版生成已完成')}</span>
        </div>
      )}

      {/* Custom Confirm Dialog */}
      {ConfirmDialogComponent}
    </div>
  );
}

export default Home;
