
import React, { useState, useEffect, useRef } from 'react';
import { FileDropzone } from './components/FileDropzone';
import { PresetCard } from './components/PresetCard';
import { ProductRequirements } from './components/ProductRequirements';
import { StyleEditor } from './components/StyleEditor';
import { AuthModal } from './components/AuthModal';
import { PricingModal } from './components/PricingModal';
import { UserInfo } from './components/UserInfo';
import { UserProfileModal } from './components/UserProfileModal';
import { restructureDocument } from './services/geminiService';
import { generateDocumentViaBackend } from './services/backendApiService';
import { generateDocx } from './utils/docxGenerator';
import { useAuth } from './contexts/AuthContext';
import { PRESETS } from './constants';
import { DocPreset, AIState, StyleConfig } from './types';
import katex from 'katex';

function App() {
  const [inputText, setInputText] = useState<string>('');
  const [inputFileName, setInputFileName] = useState<string>('document.txt');
  const [selectedPreset, setSelectedPreset] = useState<DocPreset>(DocPreset.ACADEMIC);
  const [outputText, setOutputText] = useState<string>('');

  // Independent style state for user customization
  const [currentStyles, setCurrentStyles] = useState<Record<DocPreset, StyleConfig>>(() => {
    const initial: any = {};
    PRESETS.forEach(p => initial[p.id] = { ...p.styleConfig });
    return initial;
  });

  const [isStyleEditorOpen, setStyleEditorOpen] = useState(false);

  const [aiState, setAiState] = useState<AIState>({
    isThinking: false,
    error: null,
    progressStep: '',
    progress: 0
  });

  const [showPRD, setShowPRD] = useState(false);
  const [viewMode, setViewMode] = useState<'split' | 'preview'>('split');

  // 认证和支付模态框状态
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);

  // 获取认证状态
  const { isAuthenticated, user, refreshUser } = useAuth();

  // Auto-scroll logic references
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);

  // Abort Controller for stopping generation
  const abortControllerRef = useRef<AbortController | null>(null);

  const hasApiKey = !!process.env.API_KEY;
  const activeStyle = currentStyles[selectedPreset];
  const activePresetConfig = PRESETS.find(p => p.id === selectedPreset)!;

  const handleFileLoaded = (content: string, name: string) => {
    setInputText(content);
    setInputFileName(name);
    setOutputText('');
    setAiState(prev => ({ ...prev, error: null, progress: 0 }));
  };

  // Auto-scroll effect: Triggered when outputText changes
  useEffect(() => {
    if (shouldAutoScroll && previewContainerRef.current) {
      const el = previewContainerRef.current;
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
  }, [outputText, shouldAutoScroll]);

  const handlePreviewScroll = () => {
    if (previewContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = previewContainerRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight <= 80;
      if (isAtBottom !== shouldAutoScroll) {
        setShouldAutoScroll(isAtBottom);
      }
    }
  };

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setAiState(prev => ({
        ...prev,
        isThinking: false,
        error: "已手动停止生成",
        progressStep: "已停止",
        progress: 0
      }));
    }
  };

  const handleProcess = async () => {
    if (!inputText) return;

    // 检查是否已登录
    if (!isAuthenticated) {
      setShowAuthModal(true);
      return;
    }

    setOutputText('');
    setShouldAutoScroll(true);
    setAiState({ isThinking: true, error: null, progressStep: 'AI 引擎启动中...', progress: 0 });

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const initialProgressTimer = setInterval(() => {
      setAiState(prev => {
        if (prev.progress >= 90) return prev;
        let increment = prev.progress < 30 ? 5 : prev.progress < 60 ? 2 : 0.5;
        return {
          ...prev,
          progress: prev.progress + increment,
          progressStep: prev.progress > 40 ? '正在构建排版结构...' : '正在分析文档语义...'
        };
      });
    }, 200);

    try {
      await generateDocumentViaBackend(
        {
          content: inputText,
          preset: selectedPreset,
          fileName: inputFileName,
          styleConfig: activeStyle
        },
        (partialText) => {
          if (partialText.length > 0 && outputText.length === 0) {
            clearInterval(initialProgressTimer);
          }
          if (abortControllerRef.current === null) return;
          setOutputText(partialText);
        },
        controller.signal
      );

      clearInterval(initialProgressTimer);
      if (abortControllerRef.current !== null) {
        setAiState(prev => ({ ...prev, progress: 100, progressStep: '排版生成完毕' }));
        await new Promise(r => setTimeout(r, 400));
        setAiState({ isThinking: false, error: null, progressStep: '完成', progress: 0 });

        // 刷新用户信息以更新额度
        await refreshUser();
      }

    } catch (err: any) {
      clearInterval(initialProgressTimer);

      // 处理额度用尽错误
      if (err.message === 'QUOTA_EXCEEDED') {
        setAiState({
          isThinking: false,
          error: "今日额度已用尽,升级 Pro 享受无限生成",
          progressStep: '',
          progress: 0
        });
        // 显示升级提示
        setTimeout(() => setShowPricingModal(true), 1000);
      }
      // 处理登录失效错误
      else if (err.message === 'LOGIN_REQUIRED') {
        setAiState({
          isThinking: false,
          error: "登录已失效,请重新登录",
          progressStep: '',
          progress: 0
        });
        setTimeout(() => setShowAuthModal(true), 1000);
      }
      // 处理中止错误
      else if (err.message === 'ABORT_ERR' || err.name === 'AbortError') {
        setAiState({ isThinking: false, error: "已手动停止生成", progressStep: '', progress: 0 });
      }
      // 其他错误
      else {
        console.error("Processing error:", err);
        setAiState({ isThinking: false, error: err.message || "文档处理失败,请重试。", progressStep: '', progress: 0 });
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
      const blob = await generateDocx(outputText, activeStyle);
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
      alert("导出失败，请重试");
    }
  };

  const handleStyleUpdate = (newConfig: StyleConfig) => {
    setCurrentStyles(prev => ({
      ...prev,
      [selectedPreset]: newConfig
    }));
  };

  // --- CSS Helper Functions ---
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
      // Approximate 1 line ≈ 1.5em in standard browser rendering
      return `calc(${parseFloat(val)} * 1.5em)`;
    }
    return val;
  };

  // Transform raw LaTeX ($$ ... $$) into rendered HTML for preview using KaTeX
  const getRenderedContent = () => {
    if (!outputText) return '';

    // Replace $$...$$ with KaTeX rendered string
    return outputText.replace(/\$\$([\s\S]*?)\$\$/g, (match, tex) => {
      try {
        // Decode simple entities that might have been encoded in HTML (e.g. <, >) inside formula
        const cleanTex = tex.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

        return katex.renderToString(cleanTex, {
          throwOnError: false,
          displayMode: false, // Force inline display to maintain text flow in preview
          output: 'html'
        });
      } catch (e) {
        // Fallback to raw text if rendering fails
        return match;
      }
    });
  };

  // Generate dynamic styles for the preview window
  const generatePreviewStyles = () => {
    const s = activeStyle;
    return `
      #preview-content {
        font-family: ${getPreviewFontStack(s.fontFamily)};
        font-size: ${s.baseSize};
        line-height: ${s.lineHeight};
        color: #000000;
        text-align: ${s.bodyAlign};
        /* Multi-column support for Academic Journal */
        ${s.columns && s.columns > 1 ? `column-count: ${s.columns}; column-gap: 2em;` : ''}
      }

      /* Basic Resets */
      #preview-content p {
        margin-top: ${toCssVal(s.spacingBefore)};
        margin-bottom: ${toCssVal(s.spacingAfter)};
        text-indent: ${s.textIndent};
      }
      #preview-content b, #preview-content strong { font-weight: bold; }
      #preview-content i, #preview-content em { font-style: italic; }

      /* Headings */
      #preview-content h1 {
        font-family: ${getPreviewFontStack(s.h1Font || s.headingFont)};
        font-size: ${s.h1Size};
        font-weight: ${s.h1Bold ? 'bold' : 'normal'};
        font-style: ${s.h1Italic ? 'italic' : 'normal'};
        text-align: ${s.h1Align};
        margin-top: ${toCssVal(s.spacingBefore)};
        margin-bottom: ${toCssVal(s.spacingAfter)};
        text-indent: ${s.h1Indent};
        page-break-after: avoid;
        column-span: all; /* Ensure H1 spans columns */
      }
      #preview-content h2 {
        font-family: ${getPreviewFontStack(s.h2Font || s.headingFont)};
        font-size: ${s.h2Size};
        font-weight: ${s.h2Bold ? 'bold' : 'normal'};
        font-style: ${s.h2Italic ? 'italic' : 'normal'};
        text-align: ${s.h2Align};
        margin-top: ${toCssVal(s.spacingBefore)};
        margin-bottom: ${toCssVal(s.spacingAfter)};
        text-indent: ${s.h2Indent};
        page-break-after: avoid;
      }
      #preview-content h3 {
        font-family: ${getPreviewFontStack(s.h3Font || s.headingFont)};
        font-size: ${s.h3Size};
        font-weight: ${s.h3Bold ? 'bold' : 'normal'};
        font-style: ${s.h3Italic ? 'italic' : 'normal'};
        margin-top: ${toCssVal(s.spacingBefore)};
        margin-bottom: ${toCssVal(s.spacingAfter)};
        text-indent: ${s.h3Indent};
      }
      #preview-content h4 {
        font-family: ${getPreviewFontStack(s.h4Font || s.headingFont)};
        font-size: ${s.h4Size};
        font-weight: ${s.h4Bold ? 'bold' : 'normal'};
        font-style: ${s.h4Italic ? 'italic' : 'normal'};
        margin-top: ${toCssVal(s.spacingBefore)};
        margin-bottom: ${toCssVal(s.spacingAfter)};
        text-indent: ${s.h4Indent};
      }
      
      /* Special Classes */
      #preview-content .doc-title {
        font-size: 26pt; 
        text-align: center;
        margin-bottom: 1em;
        column-span: all;
      }
      #preview-content .doc-title-en {
         font-family: ${getPreviewFontStack(s.englishTitleFont || 'Times New Roman')};
         font-size: ${s.englishTitleSize || '14pt'};
         text-align: center;
         font-weight: bold;
         column-span: all;
      }
      #preview-content .author-info {
         font-family: ${getPreviewFontStack(s.authorFont || s.fontFamily)};
         font-size: ${s.authorSize || '14pt'};
         text-align: center;
         text-indent: 0;
         column-span: all;
      }
      #preview-content .affiliation {
         font-family: ${getPreviewFontStack(s.affiliationFont || s.fontFamily)};
         font-size: ${s.affiliationSize || '9pt'};
         text-align: center;
         text-indent: 0;
         column-span: all;
      }
      #preview-content .abstract-cn, #preview-content .abstract-en {
         padding: 0 1em;
         margin: 1em 0;
         text-indent: 0;
         column-span: all;
      }

      /* Tables */
      #preview-content table {
        width: 100%;
        border-collapse: collapse;
        margin: 1em 0;
        font-family: ${getPreviewFontStack(s.tableFont)};
        font-size: ${s.tableSize};
        text-indent: 0; 
        column-break-inside: avoid;
        break-inside: avoid;
      }
      #preview-content th, #preview-content td {
        border: 1px solid #d4d4d8; 
        padding: 4px 8px;
        text-align: left;
      }
      #preview-content th {
        background-color: #f4f4f5;
        font-weight: bold;
      }
      
      /* Table Caption Fix: Handle both P class and CAPTION tag */
      #preview-content .table-caption, #preview-content caption {
         text-align: ${s.tableCaptionAlign};
         font-family: ${getPreviewFontStack(s.tableCaptionFont)};
         font-size: ${s.tableCaptionSize};
         font-weight: bold;
         margin-bottom: 4px;
         text-indent: 0;
         display: block;
         width: 100%; /* Force width to prevent vertical squashing in flex/column layouts */
         caption-side: top;
      }

      /* Equations (Borderless Tables) */
      #preview-content table.no-border, 
      #preview-content table.no-border td, 
      #preview-content table.no-border th {
          border: none !important;
          background: transparent !important;
          padding: 1px 0; 
      }
      
      /* Figures */
      #preview-content .image-placeholder {
          background: #f4f4f5;
          color: #71717a;
          padding: 2em;
          text-align: center;
          margin: 1em 0;
          border: 1px dashed #d4d4d8;
          font-family: ${getPreviewFontStack(s.figureFont)};
          font-size: ${s.figureSize};
      }

      /* KaTeX Adjustments */
      .katex { font-size: 1.1em; }
    `;
  };

  return (
    <div className="flex flex-col h-screen bg-zinc-50 text-zinc-900 font-sans selection:bg-indigo-500/20 selection:text-indigo-900">

      {/* Navigation */}
      <nav className="flex-none glass border-b border-zinc-200/50 px-6 py-4 flex items-center justify-between z-20 sticky top-0">
        <div className="flex items-center gap-3">
          <div className="bg-zinc-900 text-white p-2.5 rounded-xl shadow-lg shadow-zinc-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-zinc-900">DocFlow AI <span className="text-indigo-600 font-extrabold ml-1">智排</span></h1>
            <p className="text-[10px] text-zinc-400 font-medium tracking-widest uppercase mt-0.5">Intelligent Document Restructuring</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <button
            onClick={() => setShowPRD(true)}
            className="text-xs font-semibold text-zinc-500 hover:text-indigo-600 transition-colors uppercase tracking-wider"
          >
            产品使用说明
          </button>
          <div className="h-4 w-px bg-zinc-300"></div>
          <UserInfo
            onOpenPricing={() => setShowPricingModal(true)}
            onOpenAuth={() => setShowAuthModal(true)}
            onOpenProfile={() => setShowProfileModal(true)}
          />
        </div>
      </nav>

      <main className="flex-1 flex overflow-hidden relative">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-50/40 via-transparent to-emerald-50/40 pointer-events-none"></div>

        {/* Left Sidebar: Controls */}
        <div className="w-1/3 min-w-[380px] max-w-[480px] bg-white/60 backdrop-blur-md border-r border-zinc-200/60 overflow-y-auto p-8 flex flex-col gap-8 z-10">

          {/* Section 1: Upload */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-900 text-white text-xs font-bold">1</span>
              <h2 className="text-sm font-bold text-zinc-900 tracking-wide">导入源文档</h2>
            </div>
            <FileDropzone onFileLoaded={handleFileLoaded} />
            {inputText && (
              <div className="mt-4 flex items-center justify-between text-sm bg-white p-3 rounded-xl border border-zinc-200 shadow-sm animate-in fade-in slide-in-from-top-2">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                  </div>
                  <span className="truncate max-w-[180px] text-zinc-700 font-medium">
                    {inputFileName}
                  </span>
                </div>
                <span className="text-xs font-mono text-zinc-400 bg-zinc-50 px-2 py-1 rounded-md">{inputText.length} 字符</span>
              </div>
            )}
          </section>

          {/* Section 2: Presets */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-zinc-900 text-white text-xs font-bold">2</span>
                <h2 className="text-sm font-bold text-zinc-900 tracking-wide">选择排版预设</h2>
              </div>
              <button
                onClick={() => setStyleEditorOpen(true)}
                className="text-xs bg-indigo-50 text-indigo-600 font-bold hover:bg-indigo-100 hover:text-indigo-800 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all shadow-sm border border-indigo-100"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
                排版参数
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {PRESETS.map(preset => (
                <PresetCard
                  key={preset.id}
                  config={preset}
                  isSelected={selectedPreset === preset.id}
                  onSelect={setSelectedPreset}
                />
              ))}
            </div>
          </section>

          {/* Action */}
          <section className="pt-6 mt-auto sticky bottom-0 pb-6">
            {aiState.isThinking ? (
              <button
                onClick={handleStop}
                className="w-full py-4 rounded-2xl font-bold text-lg shadow-xl shadow-red-200/50 flex items-center justify-center gap-2 transition-all duration-300 bg-white border-2 border-red-100 text-red-500 hover:bg-red-50 hover:border-red-200 group active:scale-[0.98]"
              >
                <div className="flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
                  <span>停止生成</span>
                </div>
              </button>
            ) : (
              <button
                onClick={handleProcess}
                disabled={!inputText}
                className={`w-full py-4 rounded-2xl font-bold text-lg shadow-xl shadow-indigo-200/50 flex items-center justify-center gap-2 transition-all duration-300 transform active:scale-[0.98]
                     ${!inputText
                    ? 'bg-zinc-100 text-zinc-400 cursor-not-allowed shadow-none border border-zinc-200'
                    : 'bg-zinc-900 text-white hover:bg-zinc-800 hover:-translate-y-1'
                  }
                   `}
              >
                <span>开始智能重排</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline></svg>
              </button>
            )}

            {aiState.isThinking && (
              <div className="mt-3 flex items-center justify-center gap-2 text-xs text-zinc-400 animate-pulse">
                <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>{aiState.progressStep} ({Math.round(aiState.progress)}%)</span>
              </div>
            )}

            {aiState.error && (
              <p className="text-red-500 text-xs font-medium text-center mt-3 animate-pulse">{aiState.error}</p>
            )}
          </section>
        </div>

        {/* Right Area: Preview */}
        <div className="flex-1 flex flex-col relative z-0">

          {/* Toolbar */}
          <div className="h-16 px-8 flex items-center justify-between">
            <div className="flex p-1 bg-zinc-200/50 rounded-lg backdrop-blur-sm">
              <button
                onClick={() => setViewMode('split')}
                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${viewMode === 'split' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-800'}`}
              >
                分屏对比
              </button>
              <button
                onClick={() => setViewMode('preview')}
                className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${viewMode === 'preview' ? 'bg-white shadow-sm text-zinc-900' : 'text-zinc-500 hover:text-zinc-800'}`}
              >
                仅看结果
              </button>
            </div>

            {outputText && !aiState.isThinking && (
              <button
                onClick={handleDownload}
                className="flex items-center gap-2 text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-sm border border-indigo-100"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                下载 .docx 文档
              </button>
            )}
          </div>

          {/* Workspace */}
          <div className="flex-1 overflow-hidden px-8 pb-8 pt-2 flex gap-6">

            {/* Original Text (If Split) */}
            {(viewMode === 'split' && inputText) && (
              <div className="flex-1 flex flex-col h-full bg-white/80 backdrop-blur rounded-2xl shadow-sm border border-zinc-200 overflow-hidden group hover:shadow-md transition-shadow">
                <div className="px-5 py-3 bg-zinc-50/80 border-b border-zinc-100 text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-zinc-300"></span>
                  原始文稿
                </div>
                <div className="flex-1 overflow-auto p-8 text-sm text-zinc-600 leading-relaxed">
                  {inputFileName.endsWith('.docx') ? (
                    <div
                      dangerouslySetInnerHTML={{ __html: inputText }}
                      className="
                            text-sm text-zinc-600 leading-relaxed
                            [&_table]:w-full [&_table]:border-collapse [&_table]:mb-4 
                            [&_th]:border [&_th]:border-zinc-300 [&_th]:p-2 [&_th]:bg-zinc-100 [&_th]:text-sm [&_th]:font-bold
                            [&_td]:border [&_td]:border-zinc-300 [&_td]:p-2 [&_td]:text-sm 
                         "
                    />
                  ) : (
                    <div className="font-mono whitespace-pre-wrap">
                      {inputText}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Formatted Output */}
            <div className={`${(viewMode === 'split' && inputText) ? 'flex-1' : 'w-full max-w-4xl mx-auto'} flex flex-col h-full bg-white rounded-2xl shadow-xl shadow-zinc-200/50 border border-zinc-200 overflow-hidden ring-1 ring-zinc-100`}>
              <div className="px-5 py-3 bg-white border-b border-zinc-100 text-xs font-bold text-zinc-400 uppercase tracking-widest flex justify-between items-center z-10">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></span>
                  <span>智能排版结果</span>
                </div>
                {selectedPreset && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-400">样式:</span>
                    <span className={`text-[10px] px-2 py-1 rounded-md font-bold bg-${activePresetConfig.color}-50 text-${activePresetConfig.color}-600`}>
                      {activePresetConfig.title}
                      {activeStyle.headingNumbering !== 'none' && ` • ${activeStyle.headingNumbering === 'chinese-hierarchical' ? '公文编号' : '数字编号'}`}
                    </span>
                  </div>
                )}
              </div>

              {/* Dynamically Generated CSS based on Config */}
              <style>{generatePreviewStyles()}</style>

              <div
                className="flex-1 overflow-auto p-8 sm:p-14 max-w-none bg-white relative scroll-smooth"
                ref={previewContainerRef}
                onScroll={handlePreviewScroll}
              >
                {/* Streaming State or Empty State or Result */}
                {outputText ? (
                  <>
                    <div id="preview-content" dangerouslySetInnerHTML={{ __html: getRenderedContent() }} />
                    {aiState.isThinking && (
                      <div className="mt-4 flex items-center justify-center gap-2 text-indigo-600 animate-pulse py-4">
                        <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full"></span>
                        <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full animation-delay-200"></span>
                        <span className="w-1.5 h-1.5 bg-indigo-600 rounded-full animation-delay-400"></span>
                      </div>
                    )}
                  </>
                ) : aiState.isThinking ? (
                  <div className="h-full flex flex-col items-center justify-center z-20">
                    <div className="relative w-16 h-16">
                      <div className="absolute inset-0 bg-indigo-100 rounded-full animate-ping opacity-75"></div>
                      <svg className="absolute inset-0 animate-spin h-16 w-16 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center z-10">
                        <span className="text-[10px] font-bold text-indigo-800">{Math.round(aiState.progress)}%</span>
                      </div>
                    </div>
                    <div className="mt-8 text-center space-y-2">
                      <h3 className="text-xl font-bold text-zinc-800 animate-pulse">{aiState.progressStep}</h3>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-zinc-300 select-none">
                    <div className="bg-zinc-50 p-6 rounded-full mb-6">
                      <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-300"><rect x="4" y="2" width="16" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12" y2="18.01"></line><line x1="8" y1="18" x2="8" y2="18.01"></line><line x1="16" y1="18" x2="16" y2="18.01"></line><line x1="8" y1="6" x2="16" y2="6"></line><line x1="8" y1="10" x2="16" y2="10"></line><line x1="8" y1="14" x2="16" y2="14"></line></svg>
                    </div>
                    <p className="text-lg font-medium text-zinc-400">准备就绪</p>
                    <p className="text-sm mt-2 text-zinc-400/80">上传文档并选择预设模式以开始</p>
                  </div>
                )}
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
        presetTitle={activePresetConfig.title}
      />
      <ProductRequirements isOpen={showPRD} onClose={() => setShowPRD(false)} />

      {/* 认证模态框 */}
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
      />

      {/* 支付模态框 */}
      <PricingModal
        isOpen={showPricingModal}
        onClose={() => setShowPricingModal(false)}
      />

      {/* 用户中心模态框 */}
      <UserProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
      />
    </div>
  );
}

export default App;
