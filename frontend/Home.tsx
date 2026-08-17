
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
import { InviteModal } from './components/InviteModal';
import { UserProfileModal } from './components/UserProfileModal';
import { useConfirmDialog } from './components/ConfirmDialog';
import { generateDocumentViaBackend, convertVectorImagesViaBackend } from './services/backendApiService';
import { generateDocx } from './utils/docxGenerator';
import { sanitizeDocxPreview } from './utils/sanitizeHtml';
import { useAuth } from './contexts/AuthContext';
// useTypewriter removed: SSE stream is already incremental, no need for secondary typing animation
import { PRESETS, VISIBLE_PRESETS } from './constants';
import { DocPreset, AIState, StyleConfig } from './types';
import { A4_SHEET_W, A4_SHEET_H, DEFAULT_MARGINS_PX, cssLenToPx, marginsPxOf } from './utils/pageMetrics';
import { generatePreviewStyles } from './utils/previewStyles';
import { EDITOR_FONTS, EDITOR_FONT_SIZES } from './utils/editorFonts';
import katex from 'katex';
import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';

const getTextCount = (html: string) => {
  return html.replace(/<[^>]+>/g, '').replace(/\s/g, '').length;
};

// A4 page dimensions at 96 dpi (297mm × 96 / 25.4 ≈ 1122px)
const A4_HEIGHT_PX = 1122;

// ── 真·分页:把一段干净 HTML 按高度切成多张 A4 纸 ──
// 度量常量与页边距换算已移到 utils/pageMetrics.ts(previewStyles.ts 也要用,放这里会成环),
// 这里 re-export 以保持既有 import 路径不变。
export { PAGE_USABLE_H, cssLenToPx, marginsPxOf } from './utils/pageMetrics';



/**
 * 把 html 写入 el,按顶层块的真实高度贪心切成多张 `.a4-page` 纸张(.cover-page 独占一页),
 * 返回纸张数。测量时临时把 el 当作单张纸排版(宽/内边距一致 → 高度准确)。
 * @param bodyColumns 学术期刊等多栏预设的正文栏数(默认 1 = 不分栏)。测量时正文仍按单栏
 *   高度走(offsetTop 反映的是分栏前的单栏流,不受后续 CSS column-count 影响),但多栏渲染
 *   后同样内容占用的纸面高度会缩短为约 1/栏数——故 journal-split 分隔线之后的正文按栏数放大
 *   可用高度阈值,否则每页会因"按单栏高度算满、按多栏渲染变很短"而大量留白、多分出很多页。
 *   篇首信息(标题/作者/摘要等,column-span:all)不受影响,仍按单栏高度计。
 */
export function paginateIntoSheets(
  el: HTMLElement,
  html: string,
  bodyColumns: number = 1,
  margins: { top: number; right: number; bottom: number; left: number } = DEFAULT_MARGINS_PX,
): number {
  // 可用高度必须与渲染用的 .a4-page 内边距同源,否则"按 A 测量、按 B 渲染"必然溢出
  const PAGE_USABLE_H = Math.max(200, A4_SHEET_H - margins.top - margins.bottom);
  el.innerHTML = html;
  const prevStyle = el.getAttribute('style') || '';
  el.style.width = A4_SHEET_W + 'px';
  el.style.padding = `${margins.top}px ${margins.right}px ${margins.bottom}px ${margins.left}px`;
  el.style.boxSizing = 'border-box';
  el.style.margin = '0 auto';

  const children = Array.from(el.children) as HTMLElement[];
  if (children.length === 0) { el.setAttribute('style', prevStyle); return 1; }

  const groups: HTMLElement[][] = [[]];
  let gi = 0;
  let pageStart = children[0].offsetTop;
  let inColumnBody = false; // 过了 journal-split 分隔线 → 之后的正文按栏数放大可用高度
  children.forEach((child, idx) => {
    const isCover = !!child.classList && child.classList.contains('cover-page');
    const isJournalSplit = child.tagName === 'HR' && child.classList.contains('journal-split');
    const top = child.offsetTop;
    if (isCover) {
      if (groups[gi].length) { groups.push([]); gi++; }   // 封面前若有内容,先收尾
      groups[gi].push(child);                              // 封面独占本页
      groups.push([]); gi++;                               // 之后另起一页
      pageStart = children[idx + 1] ? children[idx + 1].offsetTop : top;
      return;
    }
    const usableH = inColumnBody ? PAGE_USABLE_H * bodyColumns : PAGE_USABLE_H;
    // 块高优先用「到下一块起点的距离」(含外边距,反映真实流高),末块退回 offsetHeight
    const nextTop = children[idx + 1] ? children[idx + 1].offsetTop : null;
    const blockH = nextTop != null && nextTop > top ? nextTop - top : (child.offsetHeight || 0);
    // 只看起点会让「起点在页内、终点越界」的块整体留在本页 → 纸张被撑高
    // (真实文档实测:A4 应 1123px 却渲染成 1183px,即用户看到的"预览页比 A4 长")。
    // 故起点越界或终点越界都提前分页;单块本身高过整页时无法再拆,只能独占一页。
    const overflows = (top - pageStart >= usableH) || (top - pageStart + blockH > usableH);
    if (overflows && groups[gi].length) {
      groups.push([]); gi++;
      pageStart = top;
    }
    groups[gi].push(child);
    if (isJournalSplit) inColumnBody = true;
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
  // 生成工作台的实时动态:阶段 key(驱动步骤时间线)+ 已排版字数(SSE 增量节流统计)+ 计时
  const [genStage, setGenStage] = useState<'parse' | 'generate' | 'verify' | 'finalize'>('parse');
  const [liveChars, setLiveChars] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const lastStatsAtRef = useRef(0);
  useEffect(() => {
    if (!aiState.isThinking) return;
    setElapsedSec(0);
    const t0 = Date.now();
    const id = setInterval(() => setElapsedSec(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [aiState.isThinking]);
  // 显示用百分比按阶段封顶:单块文档 current/total=1/1 会让 AI 排版一开始就报 100%,
  // 而校验/补回还没跑 —— 满格绿条+100% 却迟迟不出稿,观感即"卡死"。
  const stageCap = genStage === 'generate' ? 90 : genStage === 'verify' ? 96 : genStage === 'finalize' ? 99 : 15;
  const displayPct = aiState.isThinking ? Math.min(aiState.progress, stageCap) : aiState.progress;
  // 工作台活动日志流:阶段变化逐条追加(带耗时戳),让"AI 在干活"逐行可见
  const [genLog, setGenLog] = useState<{ t: string; text: string }[]>([]);
  const [docStats, setDocStats] = useState<{ paras: number; tables: number; imgs: number } | null>(null);
  // 交付质检摘要(正向的完成卡,替代"只有出问题才说话"):无警告时展示
  const [deliveryDigest, setDeliveryDigest] = useState<string | null>(null);
  const genStartRef = useRef(0);
  const lastLogStatusRef = useRef('');
  const genLogRef = useRef<HTMLDivElement | null>(null);
  const pushGenLog = (text: string) => {
    const sec = Math.max(0, Math.floor((Date.now() - genStartRef.current) / 1000));
    const stamp = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
    setGenLog(prev => (prev.length > 0 && prev[prev.length - 1].text === text ? prev : [...prev.slice(-30), { t: stamp, text }]));
  };
  useEffect(() => {
    genLogRef.current?.scrollTo({ top: genLogRef.current.scrollHeight });
  }, [genLog]);
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
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [pricingReason, setPricingReason] = useState<'quota' | undefined>(undefined);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [tick, setTick] = useState(0); // 每秒递增,驱动倒计时重渲染

  const { isAuthenticated, user, refreshUser, wechatError } = useAuth();
  // 扫码失败(二维码过期、票据失效等)回跳后自动把登录框弹回来。
  // 不这么做的话用户扫完只看到页面刷新一下、毫无反应,会以为是产品坏了。
  React.useEffect(() => {
    if (wechatError) setShowAuthModal(true);
  }, [wechatError]);

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
  // textBufferRef 存后端已发来的最新全文。生成期间不渲染它(见 handleProcess 中的说明):
  // 中途文本可能因块重试而作废,且成稿需先经确定性修正 + 交付前完整校验,
  // 校验通过后由完成分支一次性写入 outputText。这里只作为兜底缓冲。
  const textBufferRef = useRef<string>('');

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
      // EMF/WMF 矢量图浏览器渲染不了(碎图标)→ 送服务端 ImageMagick 转 PNG。
      // 与生成并行进行,转换结果合并进 imageMap,交付换图时用的就是能显示的版本。
      const vectorEntries: Record<string, string> = {};
      for (const [k, v] of Object.entries(localImageMap)) {
        if (/data:image\/x-(emf|wmf)/i.test(v)) vectorEntries[k] = v;
      }
      if (Object.keys(vectorEntries).length > 0) {
        void convertVectorImagesViaBackend(vectorEntries).then((converted) => {
          const failed = Object.keys(vectorEntries).filter(k => !converted[k]);
          if (Object.keys(converted).length === 0 && failed.length === 0) return;
          setImageMap(prev => {
            const next = { ...prev, ...converted };
            // 服务器转不了的(Linux 版 ImageMagick 无 EMF 解码器,且未装 LibreOffice):
            // 用一层 <span> 包住原图 —— 浏览器画不出图时由这层给出说明,而原始 <img>
            // 原封不动留在内容里,导出的 Word 仍是真图(Word 原生支持 EMF/WMF)。
            // 必须做在数据层:分页会重建 DOM,靠 JS 打标记的做法会被抹掉(实测踩过);
            // 且 ::after 在 <img> 这类替换元素上不渲染,说明文字只能挂在外层元素上。
            for (const k of failed) {
              const tag = prev[k] ?? vectorEntries[k];
              if (tag && !tag.includes('vector-img-fallback')) {
                next[k] = `<span class="vector-img-fallback">${tag}</span>`;
              }
            }
            return next;
          });
          console.log(`[VECTOR_IMG] converted=${Object.keys(converted).length} unrenderable=${failed.length}`);
        });
      }
    }

    // 2. 清理 Word TOC 超链接行（<p><a href="#_Toc...">...</a></p>）
    //    目录条目会被 mammoth 转成带 href 的 <a> 段落，AI 收到后可能误当正文格式化。
    // 3. 清理 Word 内部锚点（<a id="_Hlk..."></a>、<a id="_Toc..."></a>）
    const contentForBackend = contentStripped
      .replace(/<p[^>]*>\s*<a\s+href="#_Toc[^"]*"[^>]*>[\s\S]*?<\/a>\s*<\/p>/gi, '')
      .replace(/<a\s+id="[^"]*"[^>]*><\/a>/gi, '');

    setGenStage('parse');
    setLiveChars(0);
    lastStatsAtRef.current = 0;
    // 活动日志:开场先报文档底细(数字比口号有说服力)
    genStartRef.current = Date.now();
    lastLogStatusRef.current = '';
    setGenLog([]);
    setDeliveryDigest(null);
    {
      const tables = (contentForBackend.match(/<table\b/gi) ?? []).length;
      const imgs = (contentForBackend.match(/__IMG_\d+__/g) ?? []).length;
      const paras = /<p\b/i.test(contentForBackend)
        ? (contentForBackend.match(/<p\b/gi) ?? []).length
        : contentForBackend.split(/\r?\n/).filter(s => s.trim()).length;
      setDocStats({ paras, tables, imgs });
      pushGenLog(t('home.log_parsed', '已解析文档:{{paras}} 段 · {{tables}} 张表格 · {{imgs}} 张图片', { paras, tables, imgs }));
      if (tables > 0) pushGenLog(t('home.log_tables_frozen', '表格已冻结保护,将与原文一字不差', { count: tables }));
      if (imgs > 0) pushGenLog(t('home.log_images_kept', '图片已登记托管({{count}} 张),生成后原位回填', { count: imgs }));
    }
    setShouldAutoScroll(true); // 每次新生成重置自动滚动
    // 生成开始时立即滚回顶部，避免 A4 minHeight 导致视口停在空白底部
    requestAnimationFrame(() => {
      if (previewContainerRef.current) previewContainerRef.current.scrollTop = 0;
    });
    textBufferRef.current = '';
    // 【交付前完整校验】不再把生成中的文字实时刷到预览区:
    //   1. 流式中途的文本可能是错的 —— 某一块校验失败重试时,已经刷出去的字撤不回来,
    //      只有最后那次完整替换(SSE 的 {text})才是权威成稿;
    //   2. 成稿要先经过 postProcess 确定性修正 + verifyBeforeDelivery 逐项核对,
    //      核对通过(或带明确提示)才交付,中途半成品不应展示给用户。
    // 生成期间只展示阶段进度骨架屏,outputText 保持为空,由完成分支一次性写入。

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
            // 工作台步骤时间线的阶段推导
            const st = progressData.status;
            setGenStage(st === 'VERIFYING' || st === 'PROCESSING_IMAGES' ? 'verify' : st === 'FINALIZING' ? 'finalize' : 'generate');
            const pct = Math.round((progressData.current / progressData.total) * 100);
            const remaining = progressData.estimatedRemainingSeconds
              ? t('home.estimated_time', ' (预计剩余 {{seconds}} 秒)', { seconds: Math.ceil(progressData.estimatedRemainingSeconds) })
              : '';

            // 后端 7 种 status 全部映射为中文阶段提示。此前 VERIFYING / PROCESSING_IMAGES /
            // FINALIZING 没有分支,会把原始英文 token 直接显示给用户。
            // 兜底 ''：后端每个 progress 事件都带 status,但少一个字段就会让下面的
            // startsWith 抛错、整条生成中断 —— 状态提示不值得为它赔掉一次生成。
            let displayStatus = progressData.status ?? '';
            if (displayStatus === 'GENERATING') {
              displayStatus = t('home.status_generating', '正在智能排版...');
            } else if (displayStatus === 'RECOGNIZING_IMAGES') {
              displayStatus = t('home.status_recognizing_images', '正在识别图片内容...');
            } else if (displayStatus === 'VERIFYING') {
              displayStatus = t('home.status_verifying', '正在校验完整性...');
            } else if (displayStatus === 'PROCESSING_IMAGES') {
              displayStatus = t('home.status_processing_images', '正在整理图表...');
            } else if (displayStatus === 'FINALIZING') {
              displayStatus = t('home.status_finalizing', '正在生成成稿...');
            } else if (displayStatus.startsWith('PARTIAL_GENERATING|')) {
              const [, cur, tot] = displayStatus.split('|');
              displayStatus = t('home.status_partial_generating', '正在生成第 {{cur}}/{{tot}} 部分...', { cur, tot });
            } else if (displayStatus.startsWith('PART_COMPLETE|')) {
              const [, cur, tot] = displayStatus.split('|');
              displayStatus = t('home.status_part_complete', '第 {{cur}}/{{tot}} 部分完成', { cur, tot });
            } else if (displayStatus.startsWith('RETRYING|')) {
              const [, part, attempt] = displayStatus.split('|');
              displayStatus = t('home.status_retrying', '第 {{part}} 部分质量未达标,正在重新生成(第 {{attempt}} 次)...', { part, attempt });
            }

            setAiState(prev => ({
              ...prev,
              progress: Math.max(prev.progress, pct),
              progressStep: `${displayStatus}${remaining}`
            }));
            // 活动日志:状态每次变化追加一行(ping 会重复同状态,靠 lastLogStatusRef 去重)
            if (st !== lastLogStatusRef.current) {
              lastLogStatusRef.current = st;
              pushGenLog(displayStatus);
            }
          }
          // 生成期间只更新缓冲区,不渲染(见 handleProcess 顶部说明)。
          textBufferRef.current = partialText;
          // 工作台实时指标:已排版字数(节流 300ms,避免每个 token 都触发渲染)
          if (partialText) {
            const nowTs = Date.now();
            if (nowTs - lastStatsAtRef.current > 300) {
              lastStatsAtRef.current = nowTs;
              setLiveChars(partialText.replace(/<[^>]+>/g, '').replace(/\s+/g, '').length);
            }
          }
        },
        controller.signal
      );

      // Generation complete
      if (abortControllerRef.current !== null) {
        setAiState(prev => ({ ...prev, progress: 100, progressStep: t('home.generation_complete', '排版生成完毕') }));
        // 校验通过的权威成稿一次性交付(genResult.html 即 SSE 的 {text},已经过
        // postProcess 确定性修正与 verifyBeforeDelivery 逐项核对)。
        setOutputText(genResult?.html ?? textBufferRef.current);
        // Brief pause for React to finish rendering, then trigger KaTeX (runs when isThinking=false)
        setAiState(prev => ({ ...prev, progressStep: t('home.rendering', '正在应用排版格式...') }));
        await new Promise(r => setTimeout(r, 300));
        setAiState({ isThinking: false, error: null, stopMessage: null, progressStep: t('home.done', '完成'), progress: 0, estimatedSec: null, startedAt: null });
        // P0-4: 据后端完整性报告决定是否给"可能不完整"提示
        pushGenLog(t('home.log_delivered', '交付前校验完成,成稿已交付'));
        const report = genResult?.integrityReport;
        // 正向质检摘要:校验干净时也要"说话"——用数字告诉用户我们核对过什么
        if (report && !(report.truncated || report.charRetentionPct < 90 || (report.issues ?? []).some(x => x.severity !== 'info'))) {
          const fixes = (report.issues ?? []).length;
          const parts = [
            t('home.digest_retention', '内容完整性 {{pct}}%', { pct: Math.min(report.charRetentionPct, 100) }),
            docStats?.tables ? t('home.digest_tables', '{{count}} 张表格原样保真', { count: docStats.tables }) : '',
            fixes > 0 ? t('home.digest_fixes', '自动修复 {{count}} 处', { count: fixes }) : '',
          ].filter(Boolean).join(' · ');
          setDeliveryDigest(`${t('home.digest_prefix', '交付前校验通过')} · ${parts}`);
        }
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
        // 仍在编辑态时以「实时 DOM」为准:displayHtmlRef 只在退出编辑时才刷新,
        // 用户改完不退出、直接点下载的话,读到的是进入编辑态那一刻的快照 —— 改动全丢(实测)。
        // 编辑态的 DOM 本就是扁平的(无 .a4-page 包裹),直接读安全。
        const liveHtml = editMode && previewContentRef.current
          ? previewContentRef.current.innerHTML
          : (displayHtmlRef.current || previewContentRef.current?.innerHTML || '');
        const tmp = document.createElement('div');
        tmp.innerHTML = liveHtml;
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
    // 每次输入都把可编辑面的内容捕获进 displayHtmlRef(分页与导出的数据源)。
    // 只靠「退出编辑时捕获」盖不住对比模式:那个视图直接可编辑、没有退出动作,
    // 切回预览时 React 把它整个卸载,改动无声丢失(实测)。
    // 同步捕获而非防抖:防抖窗口内切走视图照样丢,而序列化一份典型文档 <1ms。
    const surface = previewContentRef.current;
    if (surface && surface.getAttribute('contenteditable') === 'true') {
      displayHtmlRef.current = surface.innerHTML;
    }
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

  // 局部改字体/字号。浏览器的 execCommand('fontSize') 只认 1~7 这七档旧式尺寸,
  // 给不了「小四 / 12pt」这种真实字号,所以先用 size=7 打一个标记,再把标记换成
  // 带真实 pt 的 <span> —— 导出侧(getRichTextRuns)认的正是这个行内样式。
  const execInlineStyle = useCallback((prop: 'fontFamily' | 'fontSize', value: string) => {
    const selection = window.getSelection();
    if (savedRangeRef.current && selection) {
      selection.removeAllRanges();
      selection.addRange(savedRangeRef.current);
    }
    const root = previewContentRef.current;
    if (!root || selection?.isCollapsed) { previewContentRef.current?.focus(); return; }

    if (prop === 'fontFamily') {
      document.execCommand('styleWithCSS', false, 'true');
      document.execCommand('fontName', false, value);
      // 必须复位:styleWithCSS 是全局开关,留着 true 的话,之后点加粗产出的是
      // <span style="font-weight:bold"> 而非 <b> —— 导出侧按标签识别,加粗会静默丢失。
      document.execCommand('styleWithCSS', false, 'false');
    } else {
      document.execCommand('styleWithCSS', false, 'false');
      document.execCommand('fontSize', false, '7');           // 只作标记,下一步换成真实字号
      root.querySelectorAll('font[size="7"]').forEach((f) => {
        const span = document.createElement('span');
        span.style.fontSize = value;
        while (f.firstChild) span.appendChild(f.firstChild);
        f.replaceWith(span);
      });
    }
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
    //     - ADD_URI_SAFE_ATTR 是关键:自定义 ALLOWED_URI_REGEXP 会被 DOMPurify 用来校验
    //       【所有非 URI 安全属性】的值,rowspan="12" 的值不匹配该正则就被整个剥掉
    //       (class/id/style 只因在内置 URI-safe 名单里才幸存)。真实文档实测:后端全程
    //       保住 17 处 rowspan,净化后归零 → 合并单元格表格整体左移错位。
    processedText = DOMPurify.sanitize(processedText, {
      ADD_ATTR: ['id', 'style', 'target'],
      ADD_URI_SAFE_ATTR: ['rowspan', 'colspan', 'scope', 'headers', 'start', 'width', 'height', 'align', 'valign', 'dir', 'lang', 'type'],
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

    // 分页(预览 + 非编辑 + 已生成完毕)→ 切成多张真·A4 纸。
    // 流式生成中不走昂贵的真分页(paginateIntoSheets 要测量 offsetTop 重排,只能限流到 ~600ms/次,
    // 导致可见内容每 600ms 才刷一次 = 一坨一坨);改用下面 else 分支的便宜扁平渲染逐帧刷 = 平滑打字。
    const paginated = viewMode === 'preview' && !editMode && !aiState.isThinking;
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
        setContentPageCount(paginateIntoSheets(node, displayHtmlRef.current || renderedContent, activeStyle.columns || 1, marginsPxOf(activeStyle.pageMargins)));
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
      // 流式扁平渲染:重排前记下滚动位置,写完立刻钉回;贴底(shouldAutoScroll)时跟随最新内容。
      const container = previewContainerRef.current;
      const prevTop = container ? container.scrollTop : 0;
      const followBottom = !!container && aiState.isThinking && shouldAutoScroll;
      if (!isContentEditedRef.current) {
        el.innerHTML = renderedContent;
        displayHtmlRef.current = renderedContent;
      } else if (editMode) {
        el.innerHTML = displayHtmlRef.current || renderedContent; // 进入编辑态:显示已编辑内容
      }
      // 页数估算要用这张纸真实的上下边距,不能用写死的常量 ——
      // 纸的内边距已改为跟随预设,两者对不上会让编辑态的分页虚线位置整体偏移。
      const mgNow = marginsPxOf(activeStyle.pageMargins);
      const totalH = el.scrollHeight + mgNow.top + mgNow.bottom;
      setContentPageCount(Math.max(1, Math.ceil(totalH / A4_HEIGHT_PX)));
      if (container && aiState.isThinking) {
        isProgrammaticScrollRef.current = true;
        container.scrollTop = followBottom ? container.scrollHeight : prevTop;
        requestAnimationFrame(() => { isProgrammaticScrollRef.current = false; });
      }
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

  // 图片(base64)解码后高度才确定 → 等全部图片真正解码完再重分页,并验证页高收敛。
  // 此前固定 220ms 重排一次:对几十张大图远远不够,首次按 0 高度测量把几十个块塞进
  // 同一页,解码后单页高达 5 万 px(真实文档实测 35 页里 18 页超高)。
  useEffect(() => {
    const el = previewContentRef.current;
    if (!el || aiState.isThinking || editMode || viewMode !== 'preview' || !renderedContent) return;
    let cancelled = false;
    const id = setTimeout(() => {
      void (async () => {
        for (let round = 0; round < 3; round += 1) {
          const imgs = Array.from(el.querySelectorAll('img')) as HTMLImageElement[];
          await Promise.allSettled(imgs.map((im) => (typeof im.decode === 'function' ? im.decode().catch(() => { /* 解码失败按 0 高处理 */ }) : Promise.resolve())));
          if (cancelled || !previewContentRef.current) return;
          const total = paginateIntoSheets(el, displayHtmlRef.current || renderedContent, activeStyle.columns || 1, marginsPxOf(activeStyle.pageMargins));
          setContentPageCount(total);
          // 页高收敛校验:重排后若仍有明显超高页(测量时又有新图未解码),再来一轮
          const stillBad = Array.from(el.querySelectorAll('.a4-page'))
            .some((p) => (p as HTMLElement).getBoundingClientRect().height > 1123 * 1.3);
          if (!stillBad) break;
        }
      })();
    }, 220);
    return () => { cancelled = true; clearTimeout(id); };
  }, [renderedContent, editMode, aiState.isThinking, viewMode]);

  // 注:此处原有一个「扫描 DOM 给裂图打标记类」的副作用,已删除 ——
  // 分页会 el.innerHTML=… 重建整棵 DOM,标记类随即被抹掉(实测:线上仍是裂图图标);
  // 且 ::after 在 <img> 这类替换元素上不渲染,说明文字根本出不来。
  // 改为数据层方案:转换失败的矢量图在 imageMap 里就包上 .vector-img-fallback 外层
  // (见上方 convertVectorImagesViaBackend 回调),不受重建影响,也不动导出用的原图。

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
                alt="DocFlow"
                className="w-8 h-8 rounded-lg"
                draggable={false}
              />
              <span className="text-lg font-semibold text-gray-900 group-hover:text-gray-600 transition-colors">DocFlow</span>
            </button>
          </div>

          <div className="flex items-center gap-4">
            {/* 邀请入口:放在顶栏最显眼处,用主色实心底,与旁边的次要按钮拉开层级 */}
            <button
              onClick={() => setShowInviteModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-500 hover:bg-emerald-600 rounded-full transition-colors shadow-sm"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                <circle cx="9" cy="7" r="4"></circle>
                <line x1="19" y1="8" x2="19" y2="14"></line>
                <line x1="22" y1="11" x2="16" y2="11"></line>
              </svg>
              邀请好友得次数
            </button>
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
                  <span className="text-xs text-gray-400 truncate">{aiState.progressStep}{displayPct > 0 ? ` · ${displayPct}%` : ''}</span>
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
            {/* 正向质检摘要:校验干净时的完成卡(绿),让"我们核对过"成为加分项而非只有坏消息 */}
            {deliveryDigest && !integrityNotice && !aiState.isThinking && (
              <div className="px-4 py-2 bg-emerald-50 border-b border-emerald-100 flex items-center gap-2">
                <svg className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                <p className="text-xs text-emerald-700 min-w-0 truncate">{deliveryDigest}</p>
                <button onClick={() => setDeliveryDigest(null)} className="ml-auto text-emerald-400 hover:text-emerald-600 text-sm leading-none flex-shrink-0" aria-label={t('common.close', '关闭')}>×</button>
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
                  <div className="df-compare-paper bg-white flex-1 overflow-auto p-6 text-sm text-gray-600 leading-relaxed custom-scrollbar">
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
                          {/* 字体 / 字号:改选中那一段,不动整篇预设。选空时不生效(execInlineStyle 里已挡) */}
                          <select
                            onMouseDown={() => { const sel = window.getSelection(); savedRangeRef.current = (sel && sel.rangeCount > 0) ? sel.getRangeAt(0).cloneRange() : null; }}
                            onChange={(e) => { if (e.target.value) { execInlineStyle('fontFamily', e.target.value); e.target.value = ''; } }}
                            value=""
                            className="text-xs px-1.5 py-1 bg-transparent border border-transparent rounded text-gray-500 hover:bg-white hover:border-gray-200 outline-none cursor-pointer font-medium max-w-[5.5rem]"
                            title={t('home.font_family', '字体(改选中部分)')}
                          >
                            <option value="">{t('home.font_family_short', '字体')}</option>
                            {EDITOR_FONTS.map((f) => (
                              <option key={f.value} value={f.value}>{f.label}</option>
                            ))}
                          </select>
                          <select
                            onMouseDown={() => { const sel = window.getSelection(); savedRangeRef.current = (sel && sel.rangeCount > 0) ? sel.getRangeAt(0).cloneRange() : null; }}
                            onChange={(e) => { if (e.target.value) { execInlineStyle('fontSize', e.target.value); e.target.value = ''; } }}
                            value=""
                            className="text-xs px-1.5 py-1 bg-transparent border border-transparent rounded text-gray-500 hover:bg-white hover:border-gray-200 outline-none cursor-pointer font-medium max-w-[5rem]"
                            title={t('home.font_size', '字号(改选中部分)')}
                          >
                            <option value="">{t('home.font_size_short', '字号')}</option>
                            {EDITOR_FONT_SIZES.map((s) => (
                              <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
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

                <style>{generatePreviewStyles(activeStyle, viewMode === 'preview' && !editMode)}</style>

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
                    className={`flex-1 overflow-auto ${viewMode === 'preview' ? 'bg-[#f0f0f0] pt-6 px-6 pb-2' : 'df-compare-paper bg-white p-8'}`}
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
                          !editMode && !aiState.isThinking ? (
                            /* 生成完毕的只读态:真·分页,灰桌面 + 多张独立 A4 纸(paginateIntoSheets 填充 #preview-content) */
                            // key 必须与编辑态那支不同:两支的根都是 <div>、位置也相同,不给 key 的话
                            // React 会复用同一个 DOM 节点。而纸张内容是我们用 innerHTML 直接写进去的,
                            // 不在 React 的虚拟树里 —— 复用时旧的 .a4-page 全部留在原地,再叠上编辑态
                            // 自己的子节点,页面上就出现两份内容(实测:点"编辑"后内容重复)。
                            <div
                              key="preview-readonly"
                              id="preview-content"
                              ref={previewContentRef}
                              className="relative outline-none"
                            />
                          ) : (
                            /* 编辑态 / 流式生成中:单张白纸(流式期间逐帧便宜渲染=平滑打字,不做昂贵分页) */
                            <div
                              key="preview-editing"
                              className="mx-auto bg-white border border-gray-200 mb-2 relative shadow-sm flex flex-col"
                              // 内边距必须与只读态的 .a4-page 同源(都取预设页边距)。此前写死
                              // 80/90/40px,而公文预设是上 3.7cm≈140px、左 2.8cm≈106px —— 编辑时
                              // 版心比实际宽一大截,断行位置和分页线全是错的,一退出编辑又跳一次。
                              style={{
                                maxWidth: `${A4_SHEET_W}px`, width: '100%', minHeight: `${A4_SHEET_H}px`,
                                paddingTop: marginsPxOf(activeStyle.pageMargins).top,
                                paddingRight: marginsPxOf(activeStyle.pageMargins).right,
                                paddingBottom: marginsPxOf(activeStyle.pageMargins).bottom,
                                paddingLeft: marginsPxOf(activeStyle.pageMargins).left,
                              }}
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
                                  <span className="text-xs text-gray-300 tracking-wide">DocFlow</span>
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
                              key="preview-compare"
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
                      /* 生成等待:排版引擎工作台 —— 步骤时间线 + 实时指标,让"AI 在干活"可见 */
                      (() => {
                        const steps = [
                          { key: 'parse', label: t('home.step_parse', '解析文档结构') },
                          { key: 'freeze', label: t('home.step_freeze', '表格 · 图片原样保护') },
                          { key: 'generate', label: t('home.step_ai', 'AI 智能排版') },
                          { key: 'verify', label: t('home.step_verify', '逐句校验 · 缺失自动补回') },
                          { key: 'finalize', label: t('home.step_final', '成稿整理交付') },
                        ];
                        const activeIdx = genStage === 'parse' ? 0 : genStage === 'generate' ? 2 : genStage === 'verify' ? 3 : 4;
                        const mm = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
                        const ss = String(elapsedSec % 60).padStart(2, '0');
                        return (
                          <div className="h-full flex items-center justify-center py-6">
                            <div className="w-[380px] max-w-[92%] bg-white border border-gray-200 rounded-2xl shadow-sm px-7 py-6">
                              {/* 头部:呼吸光点 + 计时器 */}
                              <div className="flex items-center gap-2.5 mb-5">
                                <span className="relative flex h-2.5 w-2.5">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
                                </span>
                                <span className="text-sm font-semibold text-gray-800">{t('home.engine_working', 'DocFlow 排版引擎工作中')}</span>
                                <span className="ml-auto text-xs text-gray-400 font-mono tabular-nums">{mm}:{ss}</span>
                              </div>
                              {/* 步骤时间线 */}
                              <div>
                                {steps.map((s, i) => {
                                  const done = i < activeIdx;
                                  const active = i === activeIdx;
                                  return (
                                    <div key={s.key} className="flex gap-3">
                                      <div className="flex flex-col items-center">
                                        {done ? (
                                          <span className="w-5 h-5 flex-shrink-0 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                                            <svg className="w-3 h-3 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                                          </span>
                                        ) : active ? (
                                          <span className="w-5 h-5 flex-shrink-0 rounded-full border-2 border-gray-200 border-t-gray-700 animate-spin" />
                                        ) : (
                                          <span className="w-5 h-5 flex-shrink-0 rounded-full border border-gray-200 bg-gray-50" />
                                        )}
                                        {i < steps.length - 1 && (
                                          <span className="w-px flex-1 min-h-[12px]" style={{ backgroundColor: done ? '#a7f3d0' : '#eeeeee' }} />
                                        )}
                                      </div>
                                      <div className="pb-3 min-w-0 flex-1">
                                        <p className={`text-[13px] leading-5 ${active ? 'text-gray-900 font-medium' : done ? 'text-gray-500' : 'text-gray-300'}`}>{s.label}</p>
                                        {active && (
                                          <p className="text-xs text-gray-400 mt-0.5 truncate">
                                            {aiState.progressStep || t('home.processing_doc', '正在处理文档...')}
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                              {/* 活动日志流:逐行滚动的引擎动作记录 */}
                              {genLog.length > 0 && (
                                <div ref={genLogRef} className="mt-1 mb-2 max-h-[96px] overflow-y-auto rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                                  {genLog.map((l, i) => (
                                    <p key={i} className={`text-[11px] leading-[18px] flex gap-1.5 ${i === genLog.length - 1 ? 'text-gray-700' : 'text-gray-400'}`}>
                                      <span className="font-mono tabular-nums text-gray-300 flex-shrink-0">{l.t}</span>
                                      <span className="min-w-0">{l.text}</span>
                                    </p>
                                  ))}
                                </div>
                              )}
                              {/* 实时指标 */}
                              <div className="mt-1 pt-4 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                                <span>
                                  {t('home.live_chars', '已排版')}{' '}
                                  <span className="font-mono tabular-nums text-gray-800 font-medium">{liveChars.toLocaleString()}</span>{' '}
                                  {t('home.live_chars_unit', '字')}
                                </span>
                                <span className="font-mono tabular-nums">{displayPct > 0 ? `${displayPct}%` : ''}</span>
                              </div>
                              <div className="mt-2 h-1 bg-gray-100 rounded-full overflow-hidden relative">
                                {displayPct > 0 ? (
                                  <div
                                    className="h-full rounded-full transition-all duration-500 bg-gray-500"
                                    style={{ width: `${displayPct}%` }}
                                  />
                                ) : (
                                  <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-gray-400 to-transparent animate-[shimmer_1.5s_ease-in-out_infinite]" />
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })()
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
      <InviteModal
        open={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        isAuthenticated={isAuthenticated}
        onRequireLogin={() => { setShowInviteModal(false); setShowAuthModal(true); }}
      />
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
