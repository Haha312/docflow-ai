
import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FileDropzone } from './components/FileDropzone';
import { HeroInput } from './components/HeroInput';
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
import { sanitizeDocxPreview } from './utils/sanitizeHtml';
import { useAuth } from './contexts/AuthContext';
// useTypewriter removed: SSE stream is already incremental, no need for secondary typing animation
import { PRESETS, VISIBLE_PRESETS } from './constants';
import { DocPreset, AIState, StyleConfig } from './types';
import katex from 'katex';
import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';

const getTextCount = (html: string) => {
  return html.replace(/<[^>]+>/g, '').replace(/\s/g, '').length;
};

// A4 page dimensions at 96 dpi (297mm × 96 / 25.4 ≈ 1122px)
const A4_HEIGHT_PX = 1122;
// Top + bottom padding of the paper div (each side = 80px)
const A4_PADDING_PX = 160;

// ── 真·分页:把一段干净 HTML 按高度切成多张 A4 纸 ──
const A4_SHEET_W = 794;                 // 纸宽 px(96dpi 下 A4 宽)
const A4_SHEET_PAD = '80px 90px 40px';  // 纸张内边距(上 右/左 下)
const PAGE_USABLE_H = 1000;             // 每页可用内容高度(纸高 1123 - 上80 - 下40 ≈ 1003,留点余量)

/**
 * 把 html 写入 el,按顶层块的真实高度贪心切成多张 `.a4-page` 纸张(.cover-page 独占一页),
 * 返回纸张数。测量时临时把 el 当作单张纸排版(宽/内边距一致 → 高度准确)。
 */
function paginateIntoSheets(el: HTMLElement, html: string): number {
  el.innerHTML = html;
  const prevStyle = el.getAttribute('style') || '';
  el.style.width = A4_SHEET_W + 'px';
  el.style.padding = A4_SHEET_PAD;
  el.style.boxSizing = 'border-box';
  el.style.margin = '0 auto';

  const children = Array.from(el.children) as HTMLElement[];
  if (children.length === 0) { el.setAttribute('style', prevStyle); return 1; }

  const groups: HTMLElement[][] = [[]];
  let gi = 0;
  let pageStart = children[0].offsetTop;
  children.forEach((child, idx) => {
    const isCover = !!child.classList && child.classList.contains('cover-page');
    const top = child.offsetTop;
    if (isCover) {
      if (groups[gi].length) { groups.push([]); gi++; }   // 封面前若有内容,先收尾
      groups[gi].push(child);                              // 封面独占本页
      groups.push([]); gi++;                               // 之后另起一页
      pageStart = children[idx + 1] ? children[idx + 1].offsetTop : top;
      return;
    }
    if (top - pageStart >= PAGE_USABLE_H && groups[gi].length) {
      groups.push([]); gi++;
      pageStart = top;
    }
    groups[gi].push(child);
  });

  const realGroups = groups.filter(g => g.length);
  const total = realGroups.length || 1;
  const sheets = realGroups.map((group, i) => {
    const sheet = document.createElement('div');
    sheet.className = 'a4-page';
    group.forEach(n => sheet.appendChild(n)); // 移动节点进纸张
    const footer = document.createElement('div');
    footer.className = 'a4-page-footer';
    footer.setAttribute('contenteditable', 'false');
    footer.textContent = `${i + 1} / ${total}`;
    sheet.appendChild(footer);
    return sheet;
  });

  el.setAttribute('style', prevStyle); // 还原为只读分页容器(透明/无内边距,白底由纸张提供)
  el.replaceChildren(...sheets);
  return total;
}

function Home() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { confirm, ConfirmDialogComponent } = useConfirmDialog();
  const [inputText, setInputText] = useState<string>('');
  const [inputFileName, setInputFileName] = useState<string>('document.txt');
  // 区分内容来源:'paste' = 粘贴文本(空状态 textarea),'file' = 上传文件(文件 chip),null = 空
  const [inputSource, setInputSource] = useState<'paste' | 'file' | null>(null);
  const [uploadedImages, setUploadedImages] = useState<{ dataUrl: string; name: string }[]>([]); // 上传的图片(base64),交后端 OCR
  // 选中的模板:5 个国标模板之一,或单独的「自定义」档案
  const [selectedPreset, setSelectedPreset] = useState<DocPreset | 'CUSTOM'>(DocPreset.ACADEMIC);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [outputText, setOutputText] = useState<string>('');
  const [imageMap, setImageMap] = useState<Record<string, string>>({});
  const [showToast, setShowToast] = useState(false);
  // Directly use outputText for rendering — SSE stream provides natural incremental flow

  // 自定义样式:单独的一份可编辑档案。5 个国标模板始终保持只读默认、绝不被改写。
  // null = 用户还没配置过自定义。
  const [customStyle, setCustomStyle] = useState<StyleConfig | null>(() => {
    try {
      const saved = localStorage.getItem('docuflow_custom_style');
      return saved ? JSON.parse(saved) : null;
    } catch (_) { return null; }
  });
  // 自定义所基于的国标模板:决定 AI 排版行为 + 样式编辑器显示哪些专有字段。
  const [customBase, setCustomBase] = useState<DocPreset>(() => {
    const saved = localStorage.getItem('docuflow_custom_base') as DocPreset | null;
    return saved && (Object.values(DocPreset) as string[]).includes(saved) ? saved : DocPreset.ACADEMIC;
  });

  const [isStyleEditorOpen, setStyleEditorOpen] = useState(false);
  const [aiState, setAiState] = useState<AIState>({
    isThinking: false,
    error: null,
    stopMessage: null,
    progressStep: '',
    progress: 0,
    estimatedSec: null,
    startedAt: null,
  });

  const [showPRD, setShowPRD] = useState(false);
  const [viewMode, setViewMode] = useState<'split' | 'preview'>('preview');
  // 主题(与后台共用 localStorage 键 'docflow_theme';CSS 由 index.css 的 :root[data-doc-theme] 驱动)
  const [themeMode, setThemeMode] = useState<'dark' | 'light' | 'blueviolet' | 'green' | 'coral'>(() => {
    try {
      const v = localStorage.getItem('docflow_theme');
      return (['dark', 'light', 'blueviolet', 'green', 'coral'].includes(v ?? '') ? v : 'light') as 'dark' | 'light' | 'blueviolet' | 'green' | 'coral';
    } catch { return 'light'; }
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-doc-theme', themeMode);
    try { localStorage.setItem('docflow_theme', themeMode); } catch { /* ignore */ }
  }, [themeMode]);
  // 真·分页:默认只读分页(一张张 A4 纸);点「编辑」切到单 div 富文本编辑态
  const [editMode, setEditMode] = useState(false);
  const [downloadHighlight, setDownloadHighlight] = useState(false);
  // P0-4: 完整性提示(后端报告显示截断/保留率低/有非 info 问题时给用户一个可关闭的轻提示)
  const [integrityNotice, setIntegrityNotice] = useState<{ level: 'critical' | 'warning'; text: string; details: string[] } | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [pricingReason, setPricingReason] = useState<'quota' | undefined>(undefined);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [tick, setTick] = useState(0); // 每秒递增,驱动倒计时重渲染

  const { isAuthenticated, user, refreshUser } = useAuth();
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const isProgrammaticScrollRef = useRef(false);

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
  // 流式实时分页的节流(避免逐字重排卡顿/抖动;完成态则立即精确分页)
  const lastPaginateAtRef = useRef(0);
  const paginateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isContentEdited, setIsContentEdited] = useState(false);
  const savedRangeRef = useRef<Range | null>(null);
  // 当前展示/导出用的「干净」内容 HTML(扁平、含 KaTeX/图片,不含 .a4-page 包裹)。
  // 分页(只读视图)与导出都以它为源,避免把分页用的纸张 div 漏进导出。
  const displayHtmlRef = useRef<string>('');

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

  const isCustom = selectedPreset === 'CUSTOM';
  const customBaseConfig = PRESETS.find(p => p.id === customBase)!;
  // 自定义生效样式:已编辑则用 customStyle,否则回退到 base 模板默认
  const effectiveCustomStyle = customStyle ?? customBaseConfig.styleConfig;
  // 自定义是否真的被改过(与 base 默认不同)— 决定是否显示「已自定义」绿点。
  // 仅"打开过编辑器"或"改了又改回去"都不算,避免误标。
  const customModified = !!customStyle && JSON.stringify(customStyle) !== JSON.stringify(customBaseConfig.styleConfig);
  const selectedPresetConfig = isCustom ? null : PRESETS.find(p => p.id === selectedPreset)!;
  const activeStyle = isCustom ? effectiveCustomStyle : selectedPresetConfig!.styleConfig;
  const activePresetConfig = isCustom ? customBaseConfig : selectedPresetConfig!;
  // 送后端的模板 id(自定义 → 沿用其 base 的排版行为)
  const backendPreset: DocPreset = isCustom ? customBase : (selectedPreset as DocPreset);

  // 空状态(大气 hero):还没有生成结果、也没在生成时,中间显示居中大输入区而非空白 A4
  const showHero = !outputText && !aiState.isThinking;

  // 粘贴/文件字数(memo 避免大文本每次 render 重算双正则)+ 与后端 CONTENT_LIMIT 对齐的输入上限
  const inputTextCount = useMemo(() => getTextCount(inputText), [inputText]);
  const pasteCharLimit = user?.subscriptionStatus && user.subscriptionStatus !== 'FREE' ? 2_000_000 : 200_000;

  const handleFileLoaded = (content: string, name: string, upload?: { images?: { dataUrl: string; name: string }[] }) => {
    setInputText(content);
    setInputFileName(name);
    setInputSource('file');
    setUploadedImages(upload?.images ?? []); // 图片上传:交后端 OCR;非图片则清空
    setOutputText('');
    setAiState(prev => ({ ...prev, error: null, progress: 0 }));
  };

  // 空状态里粘贴文本输入:文件名取正文首行(便于区分多个草稿,避免历史里全叫「粘贴文本」),
  // 空白内容视为空(复位文件名/来源),纯空格不算有效输入。
  const handlePasteInput = (value: string) => {
    setInputText(value);
    setUploadedImages([]); // 改为手动输入文本 → 清掉此前上传的图片,避免残留误 OCR
    const trimmed = value.trim();
    setInputSource(trimmed ? 'paste' : null);
    if (trimmed) {
      const firstLine = value.split('\n').map(s => s.trim()).find(Boolean) || '';
      // 取首句(到第一个句末标点)或前 30 字,较短者,避免单行长文被生硬截断
      const sentence = firstLine.split(/[。.!?！？]/)[0].trim();
      const base = (sentence || firstLine).slice(0, 30).replace(/[\\/:*?"<>|]/g, '').trim() || t('home.pasted_filename', '粘贴文本');
      setInputFileName(`${base}.txt`);
    } else {
      setInputFileName('document.txt');
    }
  };

  // 试试示例:一键填入一段结构化样例,降低空状态冷启动门槛(用户看不懂该粘什么时)
  const handleTrySample = () => handlePasteInput(t('home.sample_text', '关于推进部门数字化转型的工作报告\n\n一、背景\n随着业务规模扩大，传统的人工流程已难以满足效率要求，数字化转型势在必行。\n\n二、主要举措\n1. 搭建统一的数据中台，打通各系统数据孤岛。\n2. 引入自动化工具，减少重复性人工操作。\n3. 建立数据安全与权限管理规范。\n\n三、预期成效\n预计可将核心流程处理时间缩短约百分之四十，显著提升整体运营效率。'));

  // 空状态轻量清空(无确认弹窗 —— 粘贴内容重输成本低,且此时无已生成结果可丢失)
  const handleHeroClear = () => {
    setInputText('');
    setInputFileName('document.txt');
    setInputSource(null);
    setOutputText('');
    setAiState(prev => ({ ...prev, error: null, progress: 0 }));
  };

  // 倒计时 ticker — 仅在生成中每秒更新一次
  useEffect(() => {
    if (!aiState.isThinking || aiState.estimatedSec === null) return;
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [aiState.isThinking, aiState.estimatedSec]);

  // 持久化自定义样式 + 其 base 模板(刷新不丢)
  useEffect(() => {
    try {
      if (customStyle) localStorage.setItem('docuflow_custom_style', JSON.stringify(customStyle));
      localStorage.setItem('docuflow_custom_base', customBase);
    } catch (_) { /* 配额满等忽略 */ }
  }, [customStyle, customBase]);


  useEffect(() => {
    if (!shouldAutoScroll || !aiState.isThinking) return;
    // 用 RAF 合并同一帧内的多次 outputText 更新，避免每个 chunk 都触发 scroll
    const raf = requestAnimationFrame(() => {
      const container = previewContainerRef.current;
      if (!container) return;
      // 只有当实际内容高度超过容器可视高度时才跟随滚动，
      // 避免 A4 minHeight 在内容为空时把视口推到底部空白处
      const contentEl = previewContainerRef.current?.querySelector('#preview-content');
      const contentHeight = contentEl ? contentEl.scrollHeight : 0;
      if (contentHeight <= container.clientHeight) return;
      isProgrammaticScrollRef.current = true;
      container.scrollTop = container.scrollHeight;
      requestAnimationFrame(() => { isProgrammaticScrollRef.current = false; });
    });
    return () => cancelAnimationFrame(raf);
  }, [outputText, shouldAutoScroll, aiState.isThinking]);

  const handlePreviewScroll = () => {
    if (isProgrammaticScrollRef.current) return;
    const container = previewContainerRef.current;
    if (!container) return;
    const { scrollTop, scrollHeight, clientHeight } = container;
    const distFromBottom = scrollHeight - scrollTop - clientHeight;
    // 生成期间用更大的阈值（内容在持续增长，底部一直在移动）
    const threshold = aiState.isThinking ? 300 : 80;
    const isNearBottom = distFromBottom <= threshold;
    if (isNearBottom !== shouldAutoScroll) setShouldAutoScroll(isNearBottom);
  };

  const handleClear = async () => {
    const confirmed = await confirm(t('home.confirm_clear_desc', '确定要清空当前所有内容吗？'), {
      title: t('home.confirm_clear_title', '清空内容'),
      variant: 'warning'
    });

    if (confirmed) {
      setInputText('');
      setInputFileName('document.txt');
      setInputSource(null);
      setUploadedImages([]);
      setOutputText('');
      setContentPageCount(1);
      setAiState({ isThinking: false, error: null, progressStep: '', progress: 0, estimatedSec: null, startedAt: null });
    }
  };

  // 返回上传页(点 logo / 新建按钮):生成中不打断;本就空则无动作;有内容则走 handleClear 二次确认
  const handleBackToUpload = () => {
    if (aiState.isThinking) return;
    if (!inputText && !outputText) return;
    handleClear();
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
    if (!inputText.trim() && uploadedImages.length === 0) return; // 纯图片上传时正文为空,也允许生成(走 OCR)
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    // 按输入字数粗估生成时长:~20s/千字(经验值,不含图片处理)
    const charCount = inputText.replace(/\s/g, '').length;
    const estimatedSec = Math.max(15, Math.round(charCount / 1000 * 20));
    setAiState({
      isThinking: true, error: null, stopMessage: null,
      progressStep: t('home.analyzing', '正在分析文档结构...'),
      progress: 0,
      estimatedSec,
      startedAt: Date.now(),
    });
    setOutputText('');
    setImageMap({});
    setIntegrityNotice(null);

    // ── 客户端预处理：在发送给后端之前完成，避免传输大量 base64 图片数据 ──
    // 1. 提取图片：把 <img ...> 替换为 __IMG_N__ 占位符（与后端 imageUtils 逻辑一致）
    //    这样发给后端的 payload 从 10-50MB 降至几十 KB。
    const localImageMap: Record<string, string> = {};
    let localImgIndex = 0;
    const contentStripped = inputText.replace(/<img\s[^>]*>/gi, (match) => {
      const key = `__IMG_${localImgIndex}__`;
      localImageMap[key] = match;
      localImgIndex++;
      return key;
    });
    if (localImgIndex > 0) {
      setImageMap(localImageMap);
      console.log(`[CLIENT_STRIP] Replaced ${localImgIndex} images; payload: ${(inputText.length / 1024).toFixed(0)}KB → ${(contentStripped.length / 1024).toFixed(0)}KB`);
    }

    // 2. 清理 Word TOC 超链接行（<p><a href="#_Toc...">...</a></p>）
    //    目录条目会被 mammoth 转成带 href 的 <a> 段落，AI 收到后可能误当正文格式化。
    // 3. 清理 Word 内部锚点（<a id="_Hlk..."></a>、<a id="_Toc..."></a>）
    const contentForBackend = contentStripped
      .replace(/<p[^>]*>\s*<a\s+href="#_Toc[^"]*"[^>]*>[\s\S]*?<\/a>\s*<\/p>/gi, '')
      .replace(/<a\s+id="[^"]*"[^>]*><\/a>/gi, '');

    setShouldAutoScroll(true); // 每次新生成重置自动滚动
    // 生成开始时立即滚回顶部，避免 A4 minHeight 导致视口停在空白底部
    requestAnimationFrame(() => {
      if (previewContainerRef.current) previewContainerRef.current.scrollTop = 0;
    });
    textBufferRef.current = '';
    if (rafIdRef.current !== null) {
      clearTimeout(rafIdRef.current);
      rafIdRef.current = null;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const genResult = await generateDocumentViaBackend(
        {
          content: contentForBackend,
          preset: backendPreset,
          fileName: inputFileName,
          styleConfig: activeStyle,
          imageInputs: uploadedImages.length ? uploadedImages : undefined, // 图片上传 → 后端视觉模型 OCR
          // 不再让用户选模型:省略 model,后端自动选最优(默认 deepseek)
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
            } else if (displayStatus === 'RECOGNIZING_IMAGES') {
              displayStatus = t('home.status_recognizing_images', '正在识别图片内容...');
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
        setAiState({ isThinking: false, error: null, stopMessage: null, progressStep: t('home.done', '完成'), progress: 0, estimatedSec: null, startedAt: null });
        // P0-4: 据后端完整性报告决定是否给"可能不完整"提示
        const report = genResult?.integrityReport;
        if (report && (report.truncated || report.charRetentionPct < 90 || (report.issues ?? []).some(x => x.severity !== 'info'))) {
          const issues = report.issues ?? [];
          const hasCritical = issues.some(x => x.severity === 'critical');
          // 标题文案:只在「确实截断」或「保留率确实偏低(<90%)」时用对应措辞;
          // 否则用中性"有需核对项",避免保留率~100% 时还显示"内容差异较大(约100%)"这种自相矛盾。
          const text = report.truncated
            ? t('home.integrity_truncated', '生成可能不完整(检测到截断或重复失控),建议重新生成或缩短文档')
            : report.charRetentionPct < 90
              ? t('home.integrity_low_retention', '成稿内容与原文差异较大(约 {{pct}}%),请核对是否有遗漏', { pct: report.charRetentionPct })
              : t('home.integrity_check', '生成结果有需要核对的项(见下),请检查');
          // 明细:列出后端给的非 info 问题说明,让用户知道具体是什么,而非只看一句笼统提示。
          const details = issues.filter(x => x.severity !== 'info').map(x => x.detail).filter(Boolean);
          setIntegrityNotice({ level: hasCritical ? 'critical' : 'warning', text, details });
        }
        setViewMode('preview'); // 生成完成后自动切换到全宽预览模式
        setShowToast(true);
        setTimeout(() => setShowToast(false), 3000);
        setDownloadHighlight(true);
        setTimeout(() => setDownloadHighlight(false), 2500);
        await refreshUser();
      }

    } catch (err: any) {
      if (err.message === 'QUOTA_EXCEEDED') {
        // Clear inline error — the upgrade modal now carries the messaging + CTA
        setAiState({ isThinking: false, error: null, stopMessage: null, progressStep: '', progress: 0, estimatedSec: null, startedAt: null });
        setPricingReason('quota');
        setShowPricingModal(true);
      } else if (err.message === 'LOGIN_REQUIRED') {
        setAiState({ isThinking: false, error: t('home.login_required', "登录已失效,请重新登录"), stopMessage: null, progressStep: '', progress: 0 });
        setTimeout(() => setShowAuthModal(true), 1000);
      } else if (err.message === 'ABORT_ERR' || err.name === 'AbortError') {
        setAiState({ isThinking: false, error: null, stopMessage: t('home.stopped_manually', "已手动停止生成"), progressStep: '', progress: 0 });
      } else {
        console.error("Processing error:", err);
        setAiState({ isThinking: false, error: err.message || t('home.processing_failed', "文档处理失败,请重试。"), stopMessage: null, progressStep: '', progress: 0, estimatedSec: null, startedAt: null });
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
      if (isContentEdited && (displayHtmlRef.current || previewContentRef.current)) {
        // Strip KaTeX-rendered spans — docxGenerator cannot handle KaTeX HTML.
        // 用 displayHtmlRef(干净的已编辑内容,不含 .a4-page 分页包裹)而非分页后的 DOM,
        // 避免把纸张 div / 页脚漏进导出。
        const tmp = document.createElement('div');
        tmp.innerHTML = displayHtmlRef.current || previewContentRef.current!.innerHTML;
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
          // Pass 1: 修复 AI 输出的 src="__IMG_N__" 格式
          docxReadyHtml = docxReadyHtml.replace(/src="(__IMG_\d+__)"/gi, (_m, placeholder) => {
            const stored = imageMap[placeholder];
            if (stored) {
              const srcMatch = stored.match(/src="([^"]*)"/i);
              if (srcMatch) return `src="${srcMatch[1]}"`;
            }
            return _m;
          });
          // Pass 2: 独立 token → 完整 img 标签
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
      // 期刊双栏：重新计算分割点并插入 journal-split 标记
      if (activeStyle.columns && activeStyle.columns > 1) {
        // 扫描用原始 outputText（无 base64）；若用户编辑过则退回 docxReadyHtml（已还原图片）
        const rawHtmlForScan = (isContentEdited ? docxReadyHtml : outputText
          .replace(/```html/gi, '').replace(/```/g, ''))
          .replace(/<hr\b[^>]*class=["'][^"']*journal-split[^"']*["'][^>]*\/?>/gi, '');

        const tmpScan = document.createElement('div');
        tmpScan.innerHTML = rawHtmlForScan;
        const topChildren = Array.from(tmpScan.children);
        const scanMax = Math.min(topChildren.length, 15);
        let lastMetaIdx2 = -1;
        for (let i = 0; i < scanMax; i++) {
          const el = topChildren[i] as HTMLElement;
          const cls = el.className || '';
          // 跳过纯图片段落（只有 img 没有文字）
          const textOnly = (el.textContent?.trim() || '');
          if (!textOnly && el.querySelector('img')) continue;
          const firstLine = textOnly.split('\n')[0].trim();
          if (
            cls.includes('abstract') || cls.includes('keywords') ||
            /^(摘\s*要|关键词|Abstract|Keywords|KEY\s*WORDS|Key\s*words)/i.test(firstLine)
          ) { lastMetaIdx2 = i; }
        }

        // 在最终 HTML 里删除 AI 乱插的 HR，再在正确位置插入
        docxReadyHtml = docxReadyHtml.replace(/<hr\b[^>]*class=["'][^"']*journal-split[^"']*["'][^>]*\/?>/gi, '');
        if (lastMetaIdx2 >= 0) {
          // 用已还原图片的 HTML 做 DOM，在对应位置插 HR
          const tmpFinal = document.createElement('div');
          tmpFinal.innerHTML = docxReadyHtml;
          const finalChildren = Array.from(tmpFinal.children);
          if (lastMetaIdx2 < finalChildren.length - 1) {
            const hr = document.createElement('hr');
            hr.className = 'journal-split';
            finalChildren[lastMetaIdx2].after(hr);
            docxReadyHtml = tmpFinal.innerHTML;
          }
        }
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

  // 编辑只作用于「自定义」这一份档案,国标模板永不被改写
  const handleStyleUpdate = (newConfig: StyleConfig) => {
    setCustomStyle(newConfig);
  };

  // 打开自定义编辑器。base 仅在还没有自定义档案时锁定为当前选中的国标模板
  // (决定继承哪套排版行为 + 编辑器默认值)。不预填 customStyle —— 用户真正改了
  // 某一项才生成档案,避免"只是打开看了一眼"就被标成已自定义。国标模板始终只读。
  const openCustomEditor = () => {
    if (!customStyle && selectedPreset !== 'CUSTOM') {
      setCustomBase(selectedPreset as DocPreset);
    }
    setSelectedPreset('CUSTOM');
    setStyleEditorOpen(true);
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
      // Pass 1: AI 有时输出 <img src="__IMG_N__"> 而不是独立 token
      // 把 src 属性里的占位符替换为真实 base64 src，避免整个 img 标签被塞进 src 属性
      processedText = processedText.replace(/src="(__IMG_\d+__)"/gi, (_m, placeholder) => {
        const stored = imageMap[placeholder];
        if (stored) {
          const srcMatch = stored.match(/src="([^"]*)"/i);
          if (srcMatch) return `src="${srcMatch[1]}"`;
        }
        return _m;
      });
      // Pass 2: 独立的 __IMG_N__ token → 替换为完整 <img> 标签
      processedText = processedText.replace(/__IMG_\d+__/g, (match) => {
        return imageMap[match] || match;
      });
    }

    // 2.5 XSS 净化:此时 processedText 是 AI 原始 HTML(图片已还原为可信 base64,
    //     公式仍是 $...$ 文本,KaTeX 尚未渲染)。剥离 <script>/onerror 等危险内容。
    //     - ALLOWED_URI_REGEXP 放行 data:(base64 图片)否则图片被清空
    //     - ADD_ATTR 保留 id(TOC 锚点 724 行后注入,但已有 id 的标签要保住)+ style(预设/公式占位)
    //     - KaTeX 在净化之后渲染(743 行),本地可信不再净化
    processedText = DOMPurify.sanitize(processedText, {
      ADD_ATTR: ['id', 'style', 'target'],
      ALLOWED_URI_REGEXP: /^(?:data:|https?:|mailto:|#)/i,
    });

    // 3a. Merge consecutive <ol> blocks split by AI (Word auto-numbering safety net)
    // AI sometimes wraps each list item in its own <ol>...</ol>, causing all items to show "1."
    processedText = processedText.replace(/<\/ol>(\s*)<ol>/g, '');

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

  // XSS 净化:.docx 原文预览。inputText 是 FileDropzone 里 mammoth.convertToHtml 的客户端转换产物,
  // 恶意 .docx 可让 mammoth 产出 <img src=x onerror=...> 之类标记,split「对比」视图用
  // dangerouslySetInnerHTML 渲染时会触发 self-XSS。渲染前净化(配置同上方 renderedContent:
  // 放行 data: 图片 / style / table 相关标签 + id 锚点)。注意只净化"用于显示"的派生值,
  // inputText 状态本身保持原样,后端处理需要的 FORMULA_DATA/STRUCTURE_DATA 标记不受影响。
  const sanitizedInputHtml = useMemo(() => {
    if (!inputText || !inputFileName.endsWith('.docx')) return '';
    return sanitizeDocxPreview(inputText);
  }, [inputText, inputFileName]);

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

    // 清空
    if (!renderedContent) {
      setTocItems([]);
      prevTocCountRef.current = 0;
      setContentPageCount(1);
      displayHtmlRef.current = '';
      return;
    }

    // 分页(预览 + 非编辑)→ 切成多张真·A4 纸;生成过程中也实时分页(节流);仅编辑态用扁平单 div
    const paginated = viewMode === 'preview' && !editMode;
    if (paginated) {
      // 以「干净内容」为源:未编辑用 renderedContent,编辑过用捕获的 displayHtmlRef
      if (!isContentEditedRef.current) displayHtmlRef.current = renderedContent;
      const doPaginate = () => {
        const node = previewContentRef.current;
        if (!node) return;
        // 重排会重建 DOM、改变高度 → 先记下滚动位置,排完立刻钉回去,消除"乱跳"。
        // 仅当用户本就贴在底部(shouldAutoScroll)时才跟随到最新内容;否则严格保持原位。
        const container = previewContainerRef.current;
        const prevTop = container ? container.scrollTop : 0;
        const followBottom = !!container && aiState.isThinking && shouldAutoScroll;
        setContentPageCount(paginateIntoSheets(node, displayHtmlRef.current || renderedContent));
        lastPaginateAtRef.current = Date.now();
        if (container) {
          isProgrammaticScrollRef.current = true;
          container.scrollTop = followBottom ? container.scrollHeight : prevTop;
          requestAnimationFrame(() => { isProgrammaticScrollRef.current = false; });
        }
      };
      if (paginateTimerRef.current) { clearTimeout(paginateTimerRef.current); paginateTimerRef.current = null; }
      if (aiState.isThinking) {
        // 流式期间最多每 ~600ms 分一次页(留出测量/重排开销),完成的页保持稳定、只有正在写的最后一页会动
        const since = Date.now() - lastPaginateAtRef.current;
        if (since >= 600) doPaginate();
        else paginateTimerRef.current = setTimeout(doPaginate, 600 - since);
      } else {
        doPaginate(); // 完成态:立即精确分页
      }
    } else {
      if (!isContentEditedRef.current) {
        el.innerHTML = renderedContent;
        displayHtmlRef.current = renderedContent;
      } else if (editMode) {
        el.innerHTML = displayHtmlRef.current || renderedContent; // 进入编辑态:显示已编辑内容
      }
      const totalH = el.scrollHeight + A4_PADDING_PX;
      setContentPageCount(Math.max(1, Math.ceil(totalH / A4_HEIGHT_PX)));
    }

    // TOC 从渲染后的 DOM 提取(分页后 headings 在纸张内,querySelectorAll 仍可命中)
    const headings = Array.from(el.querySelectorAll('h1,h2,h3,h4,h5,h6')) as HTMLElement[];
    const items = headings
      .filter(h => !h.classList.contains('doc-title') && h.textContent?.trim())
      .map((h, i) => {
        if (!h.id) h.id = `toc-h-${i}`;
        return { id: h.id, level: parseInt(h.tagName[1]), text: h.textContent!.trim() };
      });
    const prevCount = prevTocCountRef.current;
    if (items.length > prevCount) {
      const ids = new Set(items.slice(prevCount).map(item => item.id));
      setNewTocIds(ids);
      setTimeout(() => setNewTocIds(new Set()), 700);
    }
    prevTocCountRef.current = items.length;
    setTocItems(items);
  }, [renderedContent, viewMode, editMode, aiState.isThinking]);

  // 图片(base64)解码后高度才确定 → 内容稳定后再分页一次,纠正首次测量偏差
  useEffect(() => {
    const el = previewContentRef.current;
    if (!el || aiState.isThinking || editMode || viewMode !== 'preview' || !renderedContent) return;
    const id = setTimeout(() => {
      const total = paginateIntoSheets(el, displayHtmlRef.current || renderedContent);
      setContentPageCount(total);
    }, 220);
    return () => clearTimeout(id);
  }, [renderedContent, editMode, aiState.isThinking, viewMode]);

  // 进入/退出编辑
  const enterEditMode = () => setEditMode(true);
  const exitEditMode = () => {
    // 捕获编辑后的干净内容(编辑态是扁平单 div,无 .a4-page 包裹),供分页 + 导出
    if (previewContentRef.current) displayHtmlRef.current = previewContentRef.current.innerHTML;
    setEditMode(false);
  };

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
      #preview-content p, #preview-content div:not(.katex-display):not(.math-display):not(.figure-caption):not(.table-caption):not(.doc-title):not(.doc-title-en):not(.author-info):not(.affiliation):not(.abstract-cn):not(.abstract-en):not(.cover-page):not(.doc-issuer):not(.doc-attachment) { margin-top: ${toCssVal(s.spacingBefore)}; margin-bottom: ${toCssVal(s.spacingAfter)}; text-indent: ${s.textIndent}; }
      /* 公文要素：强制无缩进 */
      #preview-content .doc-classification, #preview-content .doc-urgency, #preview-content .doc-ref-number, #preview-content .doc-addressee, #preview-content .doc-signature, #preview-content .doc-date, #preview-content .doc-seal, #preview-content .doc-note, #preview-content .doc-intro { text-indent: 0 !important; }
      /* 表格内部的 div/p 不要缩进 */
      #preview-content td div, #preview-content th div, #preview-content td p, #preview-content th p { text-indent: 0 !important; margin: 0; }

      /* Format Defenses: Protect alignments and lists from global text-indent / margin logic */
      #preview-content [style*="text-align: center"], #preview-content [style*="text-align: right"], #preview-content [align="center"], #preview-content [align="right"], #preview-content center { text-indent: 0 !important; }
      #preview-content [style*="text-align: justify"], #preview-content [align="justify"] { text-align: justify !important; }
      #preview-content ul { list-style-type: disc; list-style-position: inside; padding-left: 2em; margin-top: ${toCssVal(s.spacingBefore)}; margin-bottom: ${toCssVal(s.spacingAfter)}; }
      #preview-content ol { list-style-type: decimal; list-style-position: inside; padding-left: 2em; margin-top: ${toCssVal(s.spacingBefore)}; margin-bottom: ${toCssVal(s.spacingAfter)}; }
      #preview-content li { margin-bottom: 0.5em; text-indent: 0; }
      #preview-content li p, #preview-content li div { margin: 0; text-indent: 0 !important; }
      #preview-content b, #preview-content strong { font-weight: bold; }
      #preview-content i, #preview-content em { font-style: italic; }
      #preview-content h1 { font-family: ${getPreviewFontStack(s.h1Font || s.headingFont)}; font-size: ${s.h1Size}; font-weight: ${s.h1Bold ? 'bold' : 'normal'}; text-align: ${s.h1Align}; margin-top: 1em; margin-bottom: 0.5em; text-indent: ${s.h1Indent}; column-span: all; }
      /* Safety: if AI incorrectly uses <h1> for chapter headings instead of <h2>, render them as h2 style */
      #preview-content h1:not(.doc-title) { font-family: ${getPreviewFontStack(s.h2Font || s.headingFont)}; font-size: ${s.h2Size}; font-weight: ${s.h2Bold ? 'bold' : 'normal'}; text-align: ${s.h2Align}; margin-top: 0.85em; margin-bottom: 0.4em; text-indent: ${s.h2Indent}; column-span: unset; }
      #preview-content h2 { font-family: ${getPreviewFontStack(s.h2Font || s.headingFont)}; font-size: ${s.h2Size}; font-weight: ${s.h2Bold ? 'bold' : 'normal'}; text-align: ${s.h2Align}; margin-top: 0.85em; margin-bottom: 0.4em; text-indent: ${s.h2Indent}; }
      #preview-content h3 { font-family: ${getPreviewFontStack(s.h3Font || s.headingFont)}; font-size: ${s.h3Size}; font-weight: ${s.h3Bold ? 'bold' : 'normal'}; margin-top: 0.7em; margin-bottom: 0.3em; text-indent: ${s.h3Indent}; }
      #preview-content h4 { font-family: ${getPreviewFontStack(s.h4Font || s.headingFont)}; font-size: ${s.h4Size}; font-weight: ${s.h4Bold ? 'bold' : 'normal'}; margin-top: 0.5em; margin-bottom: 0.25em; text-indent: ${s.h4Indent}; }
      ${s.headingNumbering === 'chinese-hierarchical' ? `
      /* GB/T 9704-2012: 一级条目（一、）段前1行(28pt)，段后0；二三级无额外间距 */
      #preview-content h2 { margin-top: 28pt !important; margin-bottom: 0 !important; }
      #preview-content h3 { margin-top: 0 !important; margin-bottom: 0 !important; }
      #preview-content h4, #preview-content h5, #preview-content h6 { margin-top: 0 !important; margin-bottom: 0 !important; }
      ` : ''}
      #preview-content .doc-title { text-indent: 0; font-size: 26pt; text-align: center; margin-bottom: 1em; column-span: all; }
      /* 封面页(报告/论文、出版物):整页居中 */
      #preview-content .cover-page { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; min-height: 900px; padding: 120px 24px; page-break-after: always; column-span: all; }
      #preview-content .cover-page .doc-title { font-size: 30pt; margin-bottom: 1.4em; }
      #preview-content .cover-meta { text-indent: 0 !important; text-align: center; font-size: 15pt; line-height: 2; margin: 0.4em 0; color: #222; }
      /* 真·分页:只读视图下每页是一张独立 A4 白纸(在灰桌面上浮动,纸间留白) */
      #preview-content .a4-page { position: relative; box-sizing: border-box; width: 794px; min-height: 1123px; margin: 0 auto 24px; padding: 80px 90px 56px; background: #fff; border: 1px solid #e5e7eb; box-shadow: 0 1px 8px rgba(0,0,0,0.10); }
      #preview-content .a4-page:last-child { margin-bottom: 8px; }
      #preview-content .a4-page-footer { position: absolute; left: 90px; right: 90px; bottom: 22px; text-align: center; font-size: 10px; color: #c7c7c7; user-select: none; }
      /* 封面在所属纸张内填满整页、垂直居中 */
      #preview-content .a4-page > .cover-page { min-height: 940px; padding: 0; }
      /* 学术期刊专用元素样式 */
      #preview-content .doc-title-en { text-indent: 0; font-size: ${s.englishTitleSize || '14pt'}; font-family: ${getPreviewFontStack(s.englishTitleFont || '"Times New Roman", serif')}; font-weight: bold; text-align: center; margin-top: 0.3em; margin-bottom: 0.5em; column-span: all; }
      #preview-content .author-info { text-indent: 0; font-size: ${s.authorSize || '10.5pt'}; font-family: ${getPreviewFontStack(s.authorFont || '"FangSong", serif')}; text-align: center; margin: 0.3em 0; column-span: all; }
      #preview-content .affiliation { text-indent: 0; font-size: ${s.affiliationSize || '9pt'}; font-family: ${getPreviewFontStack(s.affiliationFont || '"SimSun", serif')}; text-align: center; color: #444; margin: 0.2em 0 0.6em; column-span: all; }
      #preview-content .abstract-cn { text-indent: 0; font-size: ${s.abstractSize || '9pt'}; font-family: ${getPreviewFontStack(s.abstractFont || '"SimSun", serif')}; margin: 0.5em 0; padding: 0 1em; column-span: all; }
      #preview-content .abstract-en { text-indent: 0; font-size: ${s.englishAbstractSize || s.abstractSize || '10.5pt'}; font-family: ${getPreviewFontStack(s.englishAbstractFont || '"Times New Roman", serif')}; margin: 0.5em 0; padding: 0 1em; column-span: all; }
      #preview-content .abstract-cn p, #preview-content .abstract-en p { text-indent: 2em; margin: 0; }
      #preview-content .keywords { text-indent: 0; font-size: ${s.abstractSize || '9pt'}; font-family: ${getPreviewFontStack(s.abstractFont || '"SimSun", serif')}; margin-bottom: 1em; padding: 0 1em; column-span: all; }
      ${s.columns && s.columns > 1 ? `
      /* 期刊 doc-title 使用标准二号 (22pt)，而非公文的 26pt */
      #preview-content .doc-title { font-size: 22pt !important; font-family: ${getPreviewFontStack(s.h1Font || s.headingFont)}; }
      ` : ''}
      /* 商务公文专用要素样式 */
      #preview-content .doc-issuer { text-align: center; font-family: "SimHei", sans-serif; font-size: 22pt; font-weight: bold; color: #cc0000; letter-spacing: 0.2em; margin: 0.5em 0 0.3em; text-indent: 0; }
      #preview-content .doc-issuer-name { display: block; }
      #preview-content .doc-ref-number { text-align: center; font-size: 14pt; color: #555; margin: 0.2em 0 0.5em; text-indent: 0; }
      #preview-content .doc-classification { text-align: left; font-size: 14pt; font-weight: bold; color: #cc0000; text-indent: 0; }
      #preview-content .doc-urgency { text-align: left; font-size: 14pt; font-weight: bold; color: #cc0000; text-indent: 0; }
      #preview-content .doc-addressee { font-size: ${s.baseSize}; font-weight: bold; text-indent: 0; margin-top: 1em; margin-bottom: 0.5em; }
      #preview-content .doc-intro { text-indent: 2em; }
      #preview-content .doc-attachment { margin-top: 1.5em; border-left: 3px solid #ccc; padding-left: 1em; font-size: ${s.baseSize}; }
      #preview-content .doc-attachment p { text-indent: 0; }
      #preview-content .doc-signature { text-align: right; font-size: ${s.baseSize}; font-weight: bold; margin-top: 2em; text-indent: 0; }
      #preview-content .doc-date { text-align: right; font-size: ${s.baseSize}; margin-top: 0.3em; text-indent: 0; }
      #preview-content .doc-seal { text-align: right; font-size: ${s.baseSize}; color: #cc0000; text-indent: 0; }
      #preview-content .doc-note { font-size: 12pt; color: #666; margin-top: 1em; text-indent: 0; }
      #preview-content hr.doc-divider { border: none; border-bottom: 3px solid #cc0000; margin: 0.4em 0 0.6em; }
      #preview-content table { width: 100%; border-collapse: collapse; margin: 1em 0; font-family: ${getPreviewFontStack(s.tableFont)}; font-size: ${s.tableSize}; }
      #preview-content th, #preview-content td { border: 1px solid #e5e5e5; padding: 8px 12px; text-align: left; text-indent: 0; }
      #preview-content td p, #preview-content th p { text-indent: 0; margin: 0; }
      #preview-content td li, #preview-content th li { text-indent: 0; }
      #preview-content th { background-color: #f9fafb; font-weight: 600; }
      #preview-content .table-caption, #preview-content caption { text-align: ${s.tableCaptionAlign}; font-family: ${getPreviewFontStack(s.tableCaptionFont)}; font-size: ${s.tableCaptionSize}; font-weight: 600; margin-bottom: 8px; display: block; }
      #preview-content .figure-caption { text-align: ${s.figureAlign || 'center'}; font-family: ${getPreviewFontStack(s.figureFont || s.fontFamily)}; font-size: ${s.figureSize || '9pt'}; font-weight: 600; margin-top: 12px; margin-bottom: 24px; }
      #preview-content img { max-width: 100%; height: auto; display: block; margin: 8px auto; text-indent: 0; }
      /* 公文内超链接不显示为蓝色，继承父元素颜色 */
      #preview-content .doc-issuer a, #preview-content .doc-ref-number a, #preview-content .doc-classification a, #preview-content .doc-urgency a, #preview-content .doc-addressee a, #preview-content .doc-signature a, #preview-content .doc-date a, #preview-content .doc-seal a, #preview-content .doc-note a { color: inherit !important; text-decoration: none !important; }
      
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
            <button
              type="button"
              onClick={handleBackToUpload}
              title={t('home.back_home', '返回首页')}
              className="flex items-center gap-2.5 group focus:outline-none"
            >
              <img
                src="/icon.svg"
                alt="DocFlow AI"
                className="w-8 h-8 rounded-lg"
                draggable={false}
              />
              <span className="text-lg font-semibold text-gray-900 group-hover:text-gray-600 transition-colors">DocFlow AI</span>
            </button>
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
              themeMode={themeMode}
              onThemeChange={setThemeMode}
            />
          </div>
        </div>
      </header>

      <main className="w-full px-4 md:px-6 lg:px-8 pt-4 md:pt-6 pb-0">
        {showHero ? (
          /* ───────── 空状态:大气居中输入区(粘贴文本 / 拖文件 二合一) ───────── */
          <div className="flex items-start md:items-center justify-center min-h-[calc(100vh-120px)] py-8 md:py-4">
            <div className="w-full max-w-2xl mx-auto flex flex-col items-center px-2">
              <div className="text-xs text-gray-400 tracking-wide mb-3.5">{t('home.hero_eyebrow', 'AI 智能排版 · 一键导出 Word')}</div>
              <h1 className="text-2xl md:text-[28px] font-semibold text-gray-900 mb-2 text-center">{t('home.hero_title', '把文字变成精排文档')}</h1>
              <p className="text-sm text-gray-500 mb-6 text-center">{t('home.hero_subtitle', '粘贴文字，或拖入 Word / txt，AI 自动排版')}</p>

              {/* 输入面板 */}
              {inputSource === 'file' ? (
                <div className="w-full bg-white border border-gray-200 rounded-2xl p-4">
                  <div className="flex items-center justify-between bg-gray-50 border border-gray-200 rounded-xl px-4 py-3.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 bg-white border border-gray-200 rounded-lg flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate" title={inputFileName}>{inputFileName}</p>
                        <p className="text-xs text-gray-400">
                          {uploadedImages.length > 0
                            ? t('home.image_upload_hint', '图片 · 由 AI 识别文字排版')
                            : `${getTextCount(inputText).toLocaleString()} ${t('home.chars', '字')}`}
                        </p>
                      </div>
                    </div>
                    <button onClick={handleHeroClear} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </button>
                  </div>
                </div>
              ) : (
                <HeroInput
                  value={inputText}
                  count={inputTextCount}
                  maxLength={pasteCharLimit}
                  userTier={user?.subscriptionStatus}
                  onPasteChange={handlePasteInput}
                  onClear={handleHeroClear}
                  onFileLoaded={handleFileLoaded}
                  onTrySample={handleTrySample}
                />
              )}

              {/* 模板 chips:5 个国标模板(只读默认)+ 自定义(可调) */}
              <div className="flex flex-wrap gap-2 justify-center mt-6 max-w-2xl">
                {VISIBLE_PRESETS.map(p => {
                  const titleKey = `home.preset_${p.id.toLowerCase().replace('-', '_')}`;
                  const selected = selectedPreset === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedPreset(p.id)}
                      aria-pressed={selected}
                      className={`text-[13px] px-4 py-1.5 rounded-full border transition-colors inline-flex items-center gap-1.5 ${
                        selected
                          ? 'bg-gray-900 text-white border-gray-900'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {t(titleKey, p.title)}
                      {selected && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                    </button>
                  );
                })}
                {/* 自定义:左半选用 + 右半铅笔调样式 */}
                <div className={`inline-flex items-center rounded-full border overflow-hidden transition-colors ${isCustom ? 'border-gray-900' : 'border-gray-200'}`}>
                  <button
                    onClick={() => setSelectedPreset('CUSTOM')}
                    aria-pressed={isCustom}
                    className={`text-[13px] pl-4 pr-2.5 py-1.5 inline-flex items-center gap-1.5 transition-colors ${isCustom ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                  >
                    {t('home.custom', '自定义')}
                    {(isCustom || customModified) && <span title={customModified ? t('home.customized', '已自定义') : undefined} className={`w-1.5 h-1.5 rounded-full ${isCustom ? 'bg-emerald-400' : 'bg-emerald-500'}`} />}
                  </button>
                  <button
                    type="button"
                    onClick={openCustomEditor}
                    title={t('home.edit_style', '调整样式')}
                    className={`self-stretch px-2.5 inline-flex items-center border-l transition-colors ${isCustom ? 'bg-gray-900 border-white/20 text-white/70 hover:text-white' : 'bg-white border-gray-200 text-gray-400 hover:text-gray-700'}`}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  </button>
                </div>
              </div>

              {/* 开始排版 */}
              <div className="flex justify-center mt-6">
                <button
                  onClick={handleProcess}
                  disabled={!inputText.trim() && uploadedImages.length === 0}
                  className="flex items-center gap-2 text-sm font-medium text-white bg-gray-900 hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed px-7 py-2.5 rounded-lg transition-colors"
                >
                  {t('home.hero_generate', '开始排版')}
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </button>
              </div>

              {/* 信任条 */}
              <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 mt-6 pt-5 border-t border-gray-100 w-full max-w-lg text-xs text-gray-400">
                <span className="inline-flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M9 12l2 2 4-4" /></svg>
                  {t('home.trust_compliance', '公文 / 毕业论文国标排版')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
                  {t('home.trust_privacy', '不保存你的文档')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                  {t('home.trust_export', '导出可编辑 Word 文件')}
                </span>
              </div>

              {inputText.trim() && (
                <p className="text-[10px] text-gray-300 mt-2">
                  {typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌘' : 'Ctrl'}+Enter
                </p>
              )}
              {/* 失败/中止反馈:hero 是早失败(413/网络/早期停止)的落地页,必须在此可见,否则用户以为按钮失效 */}
              {(aiState.error || aiState.stopMessage) && (
                <div className={`mt-4 w-full max-w-md text-sm px-4 py-2.5 rounded-lg border text-center ${aiState.error ? 'bg-red-50 text-red-600 border-red-100' : 'bg-amber-50 text-amber-700 border-amber-100'}`}>
                  {aiState.error || aiState.stopMessage}
                </div>
              )}
            </div>
          </div>
        ) : (
        <div ref={workspaceRef} className="flex flex-col md:flex-row gap-4 md:gap-6 h-auto md:h-[calc(100vh-88px)]">

          {/* Left Panel(已隐藏:控件上移到预览顶部栏,预览全宽) */}
          {import.meta.env.VITE_SHOW_LEGACY_SIDEBAR === 'true' && (
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
                      <p className="text-xs text-gray-400">
                        {uploadedImages.length > 0
                          ? t('home.image_upload_hint', '图片 · 由 AI 识别文字排版')
                          : `${getTextCount(inputText).toLocaleString()} ${t('home.chars', '字')}`}
                      </p>
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
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 bg-gray-900 text-white rounded-md flex items-center justify-center text-xs font-bold">2</div>
                <h2 className="text-sm font-semibold text-gray-900">{t('home.select_preset', '选择模板')}</h2>
              </div>

              <div className="-mx-1 px-1">
                <div className="grid grid-cols-2 gap-2">
                  {VISIBLE_PRESETS.map(preset => (
                    <PresetCard
                      key={`${preset.id}-${i18n.language}`}
                      config={preset}
                      isSelected={selectedPreset === preset.id}
                      onSelect={setSelectedPreset}
                    />
                  ))}
                  {/* 自定义卡:点选用,铅笔调样式 */}
                  <div
                    onClick={() => setSelectedPreset('CUSTOM')}
                    className={`relative p-2.5 rounded-xl cursor-pointer transition-all duration-200 border group select-none flex items-center gap-2.5 ${isCustom ? 'bg-emerald-50 border-emerald-500 shadow-sm' : 'bg-white border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'}`}
                  >
                    {isCustom && (
                      <div className="absolute top-0 right-0 p-[1px] bg-emerald-500 rounded-bl-lg rounded-tr-lg">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      </div>
                    )}
                    <div className={`p-2 rounded-lg flex-shrink-0 flex items-center justify-center ${isCustom ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-500 group-hover:bg-gray-200 group-hover:text-gray-700'}`}>
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="4" y1="21" x2="4" y2="14" /><line x1="4" y1="10" x2="4" y2="3" /><line x1="12" y1="21" x2="12" y2="12" /><line x1="12" y1="8" x2="12" y2="3" /><line x1="20" y1="21" x2="20" y2="16" /><line x1="20" y1="12" x2="20" y2="3" /><line x1="1" y1="14" x2="7" y2="14" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="17" y1="16" x2="23" y2="16" /></svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className={`font-medium text-xs truncate flex items-center gap-1 ${isCustom ? 'text-emerald-900 font-semibold' : 'text-gray-700'}`}>
                        {t('home.custom', '自定义')}
                        {customModified && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />}
                      </h3>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openCustomEditor(); }}
                      title={t('home.edit_style', '调整样式')}
                      className={`flex-shrink-0 p-1 rounded-md transition-colors ${isCustom ? 'text-emerald-700 hover:bg-emerald-100' : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100'}`}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Step 3: Generate */}
            <div className={`bg-white border border-gray-200 rounded-xl p-4 flex-shrink-0 transition-opacity duration-300 ${aiState.isThinking ? 'opacity-60' : 'opacity-100'}`}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 bg-gray-900 text-white rounded-md flex items-center justify-center text-xs font-bold">3</div>
                <h2 className="text-sm font-semibold text-gray-900">{t('home.start_generate', '开始生成')}</h2>
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
                      disabled={!inputText && uploadedImages.length === 0}
                      className={`w-full py-3 rounded-xl font-medium text-sm flex items-center justify-center gap-2 transition-all ${!inputText && uploadedImages.length === 0
                        ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                        : 'bg-gray-900 text-white hover:bg-gray-800 shadow-sm'
                        }`}
                    >
                      {t('home.start_process', '开始智能重排')}
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    </button>
                    {(inputText || uploadedImages.length > 0) && (
                      <p className="text-center text-[10px] text-gray-300 mt-1.5">
                        {typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌘' : 'Ctrl'}+Enter
                      </p>
                    )}
                  </>
                )}

                {aiState.isThinking && (
                  <div className="mt-3 flex flex-col items-center gap-1.5">
                    <div className="flex items-center justify-center gap-2 text-xs text-gray-500">
                      <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>{aiState.progressStep}</span>
                    </div>
                    {aiState.estimatedSec !== null && aiState.startedAt !== null && tick >= 0 && (() => {
                      const elapsed = Math.floor((Date.now() - aiState.startedAt!) / 1000);
                      const remaining = Math.max(0, aiState.estimatedSec! - elapsed);
                      return remaining > 0 ? (
                        <span className="text-[10px] text-gray-400">
                          {t('home.eta', '预计还需约 {{n}} 秒', { n: remaining })}
                        </span>
                      ) : (
                        <span className="text-[10px] text-gray-400">{t('home.eta_soon', '即将完成...')}</span>
                      );
                    })()}
                  </div>
                )}

                {aiState.error && (
                  <div className="mt-3 p-3 bg-red-50 border border-red-100 rounded-lg flex items-center justify-between gap-3">
                    <p className="text-xs text-red-600 flex-1 min-w-0">{aiState.error}</p>
                    {(inputText || uploadedImages.length > 0) && (
                      <button
                        onClick={handleProcess}
                        disabled={aiState.isThinking}
                        className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-red-200 text-red-600 text-xs font-medium rounded-lg hover:bg-red-50 hover:border-red-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                      >
                        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="23 4 23 10 17 10"></polyline>
                          <polyline points="1 20 1 14 7 14"></polyline>
                          <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                        </svg>
                        {t('home.retry_generate', '重新生成')}
                      </button>
                    )}
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
          )}

          {/* Right Panel - Preview(预览为主,全宽) */}
          <div className="flex-1 flex flex-col min-w-0 bg-white border border-gray-200 rounded-xl overflow-hidden shadow-[0_0_15px_rgba(0,0,0,0.02)]">
            {/* 顶部控制栏:文件 / 模板 / 自定义 / 重新生成·停止 / 视图 / 保存下载 —— 控件收顶,预览为主 */}
            <div className="px-4 py-2.5 border-b border-gray-100 bg-gray-50/50 flex flex-wrap items-center gap-x-3 gap-y-2">
              {/* 文件 */}
              {inputText && (
                <div className="flex items-center gap-1.5 text-xs text-gray-600 min-w-0 max-w-[220px]">
                  <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                  <span className="truncate" title={inputFileName}>{inputFileName}</span>
                </div>
              )}

              {/* 模板 chips:国标只读 + 自定义可调 */}
              <div className={`flex items-center gap-1.5 flex-wrap ${aiState.isThinking ? 'opacity-50 pointer-events-none' : ''}`}>
                {VISIBLE_PRESETS.map(p => {
                  const sel = selectedPreset === p.id;
                  return (
                    <button
                      key={p.id}
                      onClick={() => setSelectedPreset(p.id)}
                      aria-pressed={sel}
                      className={`text-xs px-2.5 py-1 rounded-full border transition-colors inline-flex items-center gap-1 ${sel ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'}`}
                    >
                      {t(`home.preset_${p.id.toLowerCase().replace('-', '_')}`, p.title)}
                      {sel && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />}
                    </button>
                  );
                })}
                {/* 自定义:左半选用 + 右半铅笔调样式 */}
                <div className={`inline-flex items-center rounded-full border overflow-hidden transition-colors ${isCustom ? 'border-gray-900' : 'border-gray-200'}`}>
                  <button
                    onClick={() => setSelectedPreset('CUSTOM')}
                    aria-pressed={isCustom}
                    className={`text-xs pl-2.5 pr-2 py-1 inline-flex items-center gap-1 transition-colors ${isCustom ? 'bg-gray-900 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                  >
                    {t('home.custom', '自定义')}
                    {(isCustom || customModified) && <span title={customModified ? t('home.customized', '已自定义') : undefined} className={`w-1.5 h-1.5 rounded-full ${isCustom ? 'bg-emerald-400' : 'bg-emerald-500'}`} />}
                  </button>
                  <button
                    type="button"
                    onClick={openCustomEditor}
                    title={t('home.edit_style', '调整样式')}
                    className={`self-stretch px-1.5 inline-flex items-center border-l transition-colors ${isCustom ? 'bg-gray-900 border-white/20 text-white/70 hover:text-white' : 'bg-white border-gray-200 text-gray-400 hover:text-gray-700'}`}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                  </button>
                </div>
              </div>

              {/* 重新生成 / 停止 + 进度 */}
              {aiState.isThinking ? (
                <div className="flex items-center gap-2 min-w-0">
                  <button onClick={handleStop} className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors flex-shrink-0">
                    <span className="relative flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" /><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" /></span>
                    {t('home.stop_generation', '停止生成')}
                  </button>
                  <span className="text-xs text-gray-400 truncate">{aiState.progressStep}{aiState.progress > 0 ? ` · ${aiState.progress}%` : ''}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* 新建文档:清空当前回到上传页(与重新生成同组) */}
                  <button
                    onClick={handleClear}
                    title={t('home.new_doc_hint', '新建文档（清空当前内容）')}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 bg-white border border-gray-200 hover:border-gray-300 rounded-lg transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                    {t('home.new_doc', '新建')}
                  </button>
                  <button
                    onClick={handleProcess}
                    disabled={!inputText}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                    {t('home.retry_generate', '重新生成')}
                  </button>
                </div>
              )}

              {/* 右侧:视图切换 + 保存/下载 */}
              <div className="ml-auto flex items-center gap-2">
                <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg p-0.5">
                  <button onClick={() => setViewMode('preview')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === 'preview' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900'}`}>{t('home.preview_view', '结果预览')}</button>
                  <button onClick={() => setViewMode('split')} className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${viewMode === 'split' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-900'}`}>{t('home.split_view', '原文对比')}</button>
                </div>
                {outputText && !aiState.isThinking && (
                  <>
                    {viewMode === 'preview' && (
                      <button
                        onClick={editMode ? exitEditMode : enterEditMode}
                        title={editMode ? t('home.done_edit', '完成编辑') : t('home.edit', '编辑内容')}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${editMode ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:text-gray-900'}`}
                      >
                        {editMode ? (
                          <><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>{t('home.done_edit', '完成')}</>
                        ) : (
                          <><svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>{t('home.edit', '编辑')}</>
                        )}
                      </button>
                    )}
                    <button
                      onClick={() => { handleDownload(); setDownloadHighlight(false); }}
                      className={`flex items-center gap-1.5 bg-gray-900 text-white px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-gray-800 transition-all shadow-sm ${downloadHighlight ? 'ring-2 ring-offset-2 ring-green-400 scale-105' : ''}`}
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                      {t('home.download_docx', '下载 .docx')}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* 失败 / 停止反馈条 */}
            {aiState.error && (
              <div className="px-4 py-2 bg-red-50 border-b border-red-100 flex items-center justify-between gap-3">
                <p className="text-xs text-red-600 flex-1 min-w-0">{aiState.error}</p>
                {inputText && !aiState.isThinking && (
                  <button onClick={handleProcess} className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1 bg-white border border-red-200 text-red-600 text-xs font-medium rounded-lg hover:bg-red-50">
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></svg>
                    {t('home.retry_generate', '重新生成')}
                  </button>
                )}
              </div>
            )}
            {aiState.stopMessage && !aiState.error && (
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                <p className="text-xs text-gray-500">{aiState.stopMessage}</p>
              </div>
            )}
            {/* P0-4 完整性提示条:按严重度配色(critical=红 / warning=琥珀),并列出具体问题明细 */}
            {integrityNotice && !aiState.isThinking && (() => {
              const crit = integrityNotice.level === 'critical';
              return (
                <div className={`px-4 py-2 border-b flex items-start justify-between gap-3 ${crit ? 'bg-red-50 border-red-100' : 'bg-amber-50 border-amber-100'}`}>
                  <div className="flex items-start gap-2 min-w-0">
                    <span className={`flex-shrink-0 ${crit ? 'text-red-600' : 'text-amber-600'}`}>{crit ? '⛔' : '⚠'}</span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-xs ${crit ? 'text-red-700' : 'text-amber-700'}`}>{integrityNotice.text}</p>
                      {integrityNotice.details.length > 0 && (
                        <ul className={`mt-1 space-y-0.5 text-[11px] ${crit ? 'text-red-600/80' : 'text-amber-600/80'}`}>
                          {integrityNotice.details.map((d, i) => (
                            <li key={i} className="truncate before:content-['·_']">{d}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                  <button onClick={() => setIntegrityNotice(null)} title={t('home.dismiss', '关闭')} className={`flex-shrink-0 text-xs leading-none ${crit ? 'text-red-500 hover:text-red-700' : 'text-amber-500 hover:text-amber-700'}`}>✕</button>
                </div>
              );
            })()}

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
                        dangerouslySetInnerHTML={{ __html: sanitizedInputHtml }}
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
                    {/* Rich editor toolbar — 仅编辑态显示(只读分页态内容不可编辑) */}
                    {outputText && !aiState.isThinking && viewMode === 'preview' && editMode && (
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
                    <span className="text-xs text-gray-500">
                      {isCustom
                        ? `${t('home.custom', '自定义')} · ${t(`home.preset_${customBase.toLowerCase().replace('-', '_')}`, customBaseConfig.title)}`
                        : t(`home.preset_${selectedPreset.toLowerCase().replace('-', '_')}`, activePresetConfig.title)}
                    </span>
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
                    className={`flex-1 overflow-auto ${viewMode === 'preview' ? 'bg-[#f0f0f0] pt-6 px-6 pb-2' : 'bg-white p-8'}`}
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
                          !editMode ? (
                            /* 真·分页:灰桌面 + 多张独立 A4 纸(生成中也实时分页,由 paginateIntoSheets 填充 #preview-content) */
                            <div
                              id="preview-content"
                              ref={previewContentRef}
                              className="relative outline-none"
                            />
                          ) : (
                            /* 编辑 / 流式:单张白纸 */
                            <div
                              className="mx-auto bg-white border border-gray-200 mb-2 relative shadow-sm flex flex-col"
                              style={{ maxWidth: '794px', width: '100%', minHeight: '1123px', padding: '80px 90px 40px' }}
                            >
                              {/* 视觉分页线层(仅流式/编辑的扁平视图;只读态用真·纸张) */}
                              {contentPageCount > 1 && (
                                <div className="absolute inset-0 pointer-events-none select-none z-0" aria-hidden="true">
                                  {Array.from({ length: contentPageCount - 1 }).map((_, i) => (
                                    <div
                                      key={i}
                                      className="absolute left-0 right-0 flex items-center gap-2 px-6"
                                      style={{ top: (i + 1) * A4_HEIGHT_PX }}
                                    >
                                      <div className="flex-1 border-t border-dashed border-gray-200" />
                                      <span className="text-[10px] text-gray-300 tabular-nums whitespace-nowrap">
                                        {t('home.page_n', '第 {{n}} 页', { n: i + 2 })}
                                      </span>
                                      <div className="flex-1 border-t border-dashed border-gray-200" />
                                    </div>
                                  ))}
                                </div>
                              )}
                              <div
                                id="preview-content"
                                ref={previewContentRef}
                                contentEditable={editMode && !aiState.isThinking}
                                suppressContentEditableWarning
                                spellCheck={false}
                                onInput={handleContentEdit}
                                onKeyUp={updateActiveFormats}
                                onMouseUp={updateActiveFormats}
                                className="outline-none min-h-[500px] relative z-10"
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
                              {/* Formula rendering hint — overlaid at bottom of A4 paper, takes no layout space */}
                              {aiState.isThinking && hasFormulas && (
                                <div className="absolute bottom-14 left-0 right-0 flex justify-center pointer-events-none select-none">
                                  <div className="flex items-center gap-1.5 px-3 py-1 bg-white/80 border border-amber-100 rounded-full shadow-sm backdrop-blur-sm" style={{ animation: 'fadeInUp 0.4s ease' }}>
                                    <svg className="w-3 h-3 text-amber-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                      <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                                    </svg>
                                    <span className="text-xs text-gray-400">{t('home.formula_rendering_hint', '公式将在生成完成后自动渲染')}</span>
                                  </div>
                                </div>
                              )}
                            </div>
                          )
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
                              <div style={{ position: 'sticky', bottom: 8 }} className="flex justify-center pointer-events-none select-none">
                                <div className="flex items-center gap-1.5 px-3 py-1 bg-white/80 border border-amber-100 rounded-full shadow-sm backdrop-blur-sm" style={{ animation: 'fadeInUp 0.4s ease' }}>
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
                      /* 等待开始：骨架纸 + 进度，呈现"文档正在排版"的感受 */
                      <div className="h-full flex flex-col items-center justify-center gap-5 py-6">
                        {/* 骨架 A4 纸：标题 + 段落占位行，逐行脉冲动画（去掉整卡的扫光效果） */}
                        <div className="w-[300px] max-w-[78%] bg-white border border-gray-200 rounded-sm shadow-sm px-7 py-6 relative overflow-hidden">
                          <div className="h-4 w-2/3 mx-auto bg-gray-200 rounded mb-6 animate-pulse" />
                          <div className="h-2.5 w-2/5 bg-gray-200 rounded mb-3 animate-pulse" />
                          {[0.95, 0.88, 0.6].map((w, i) => (
                            <div key={`a${i}`} className="h-2 bg-gray-100 rounded mb-2.5 animate-pulse" style={{ width: `${w * 100}%`, animationDelay: `${i * 150}ms` }} />
                          ))}
                          <div className="h-2.5 w-2/5 bg-gray-200 rounded mb-3 mt-6 animate-pulse" style={{ animationDelay: '300ms' }} />
                          {[0.9, 0.5].map((w, i) => (
                            <div key={`b${i}`} className="h-2 bg-gray-100 rounded mb-2.5 animate-pulse" style={{ width: `${w * 100}%`, animationDelay: `${(i + 3) * 150}ms` }} />
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
        )}
      </main>

      <StyleEditor
        isOpen={isStyleEditorOpen}
        onClose={() => setStyleEditorOpen(false)}
        config={activeStyle}
        onUpdate={handleStyleUpdate}
        presetTitle={isCustom
          ? `${t('home.custom', '自定义')} · ${t(`home.preset_${customBase.toLowerCase().replace('-', '_')}`, customBaseConfig.title)}`
          : t(`home.preset_${selectedPreset.toLowerCase().replace('-', '_')}`, activePresetConfig.title)}
        presetId={activePresetConfig.id}
        defaultConfig={activePresetConfig.styleConfig}
      />
      <ProductRequirements isOpen={showPRD} onClose={() => setShowPRD(false)} />
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} />
      <PricingModal
        isOpen={showPricingModal}
        onClose={() => {
          setShowPricingModal(false);
          setPricingReason(undefined);
        }}
        reason={pricingReason}
      />
      <UserProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
      />

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

      {/* 极简 footer (固定右下角)。用户协议/隐私政策只在登录弹窗展示(AuthModal 的同意条款里),主页面不再重复。
          这里仅保留 ICP 备案号(法律要求),且仅在配置 VITE_ICP_BEIAN 后才渲染。 */}
      {import.meta.env.VITE_ICP_BEIAN && (
        <div className="fixed bottom-2 right-4 text-[10px] text-gray-400 z-30 flex items-center gap-1.5 pointer-events-auto">
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noreferrer" className="hover:text-gray-600 transition-colors">{import.meta.env.VITE_ICP_BEIAN}</a>
        </div>
      )}
    </div>
  );
}

export default Home;
