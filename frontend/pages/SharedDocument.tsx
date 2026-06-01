import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { getSharedDocument } from '../services/backendApiService';

interface SharedDoc {
  id: string;
  title: string;
  content: string;
  preset: string;
  wordCount?: number | null;
  createdAt: string;
}

export function SharedDocument() {
  const { t } = useTranslation();
  const { token } = useParams<{ token: string }>();
  const [doc, setDoc] = useState<SharedDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) {
      setError(t('shared.invalid_link', '分享链接无效'));
      setLoading(false);
      return;
    }
    getSharedDocument(token)
      .then(setDoc)
      .catch((e: Error) => setError(e.message || t('shared.expired', '链接已失效')))
      .finally(() => setLoading(false));
  }, [token, t]);

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="text-sm text-zinc-500">{t('common.loading', '加载中...')}</div>
      </div>
    );
  }

  if (error || !doc) {
    return (
      <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center px-4 text-center">
        <div className="w-16 h-16 bg-zinc-100 rounded-2xl flex items-center justify-center mb-6">
          <svg className="w-8 h-8 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h1 className="text-xl font-bold text-zinc-900 mb-2">{t('shared.unavailable_title', '无法访问')}</h1>
        <p className="text-sm text-zinc-500 mb-6 max-w-sm">{error}</p>
        <Link to="/" className="px-5 py-2.5 bg-zinc-900 text-white text-sm font-medium rounded-xl hover:bg-zinc-800">
          {t('not_found.go_home', '回到首页')}
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-100">
      {/* 顶部 banner */}
      <div className="bg-white border-b border-zinc-200">
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-zinc-900">{doc.title}</h1>
            <p className="text-xs text-zinc-400 mt-0.5">
              {new Date(doc.createdAt).toLocaleDateString()}
              {doc.wordCount ? ` · ${doc.wordCount.toLocaleString()} ${t('shared.words', '字')}` : ''}
            </p>
          </div>
          <Link
            to="/"
            className="text-xs px-3 py-1.5 bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition-colors"
          >
            {t('shared.create_your_own', '我也要做一份 →')}
          </Link>
        </div>
      </div>

      {/* 内容 A4 容器 */}
      <div className="py-8 px-4">
        <div
          className="max-w-3xl mx-auto bg-white shadow-sm rounded-lg p-12 prose prose-zinc max-w-none"
          dangerouslySetInnerHTML={{ __html: doc.content }}
        />
      </div>

      {/* 底部水印 */}
      <div className="text-center py-6 text-xs text-zinc-400">
        {t('shared.powered_by', '由 DocFlow AI 生成')} · <Link to="/" className="hover:text-zinc-700 underline">docuflow.ai</Link>
      </div>
    </div>
  );
}

export default SharedDocument;
