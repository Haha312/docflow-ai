import React, { useEffect, useState } from 'react';
import { getUserDocuments, deleteDocument, getDocument } from '../services/backendApiService';
import { useConfirmDialog } from './ConfirmDialog';
import { generateDocx } from '../utils/docxGenerator';
import { PRESETS } from '../constants';
import { StyleConfig } from '../types';
import { useTranslation } from 'react-i18next';

interface Document {
  id: string;
  title: string;
  preset: string;
  wordCount: number;
  createdAt: string;
}

export interface OpenableDocument {
  id: string;
  title: string;
  content: string;
  preset: string;
  wordCount?: number | null;
}

interface DocumentListProps {
  /**
   * 父组件提供时,文档列表会显示"打开"按钮 — 点击会拉取文档完整内容并通过此回调传回。
   * 用于把历史文档加载回主编辑器。
   */
  onOpenDocument?: (doc: OpenableDocument) => void;
}

export function DocumentList({ onOpenDocument }: DocumentListProps = {}) {
  const { confirm, ConfirmDialogComponent } = useConfirmDialog();
  const { t } = useTranslation();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [openingId, setOpeningId] = useState<string | null>(null);

  useEffect(() => {
    loadDocuments();
  }, [page]);

  const loadDocuments = async () => {
    try {
      setLoading(true);
      const data = await getUserDocuments(page);
      setDocuments(data.list);
      setTotal(data.pagination.total);
    } catch (err: any) {
      setError(t('profile.fetch_doc_failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (doc: Document) => {
    try {
      // 1. Fetch full document content (including HTML)
      const fullDoc = await getDocument(doc.id);
      if (!fullDoc || !fullDoc.content) {
        alert(t('profile.doc_empty'));
        return;
      }

      // 2. Find matching style config or use default
      const presetConfig = PRESETS.find(p => p.id === doc.preset);
      // Fallback to Academic if preset not found or removed
      const styleConfig: StyleConfig = presetConfig ? presetConfig.styleConfig : PRESETS[0].styleConfig;

      // 3. Generate Blob
      const blob = await generateDocx(fullDoc.content, styleConfig);

      // 4. Trigger Download
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${doc.title || 'document'}.docx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

    } catch (err) {
      console.error('Download failed', err);
      alert(t('profile.download_failed'));
    }
  };

  const handleOpen = async (doc: Document) => {
    if (!onOpenDocument || openingId) return;
    setOpeningId(doc.id);
    try {
      const full = await getDocument(doc.id);
      onOpenDocument({
        id: full.id,
        title: full.title,
        content: full.content,
        preset: full.preset,
        wordCount: full.wordCount,
      });
    } catch (err) {
      console.error('Open document failed', err);
      setError(t('profile.open_failed', '无法打开文档,请稍后重试'));
    } finally {
      setOpeningId(null);
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirm(t('profile.delete_confirm'), {
      title: t('profile.delete_doc'),
      variant: 'danger'
    });

    if (!confirmed) return;

    try {
      await deleteDocument(id);
      loadDocuments(); // 刷新列表
    } catch (err) {
      alert(t('profile.delete_failed'));
    }
  };

  const getPresetName = (preset: string) => {
    const normalizedPreset = (preset || '').toLowerCase();
    const names: Record<string, string> = {
      'corporate': t('home.preset_corporate', '企业公文'),
      'academic': t('home.preset_academic', '报告 / 论文'),
      'academic_journal': t('home.preset_academic_journal', '学术期刊'),
      'creative': t('home.preset_creative', '出版物'),
      'minimalist': t('home.preset_minimalist', '极简风格')
    };
    return names[normalizedPreset] || preset;
  };

  if (loading && documents.length === 0) return <div className="loading">{t('profile.loading')}</div>;
  if (error) return <div className="error">{error}</div>;
  if (documents.length === 0) return <div className="empty">{t('profile.no_doc_history')}</div>;

  return (
    <div className="document-list">
      {ConfirmDialogComponent}
      <h3>{t('profile.tab_documents')}</h3>
      <div className="list-container">
        {documents.map(doc => (
          <div key={doc.id} className="doc-item">
            <div className="doc-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-500">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
                <line x1="16" y1="13" x2="8" y2="13"></line>
                <line x1="16" y1="17" x2="8" y2="17"></line>
                <polyline points="10 9 9 9 8 9"></polyline>
              </svg>
            </div>
            <div className="doc-info">
              <div className="doc-title">{doc.title}</div>
              <div className="doc-meta">
                <span>{getPresetName(doc.preset)}</span>
                <span className="separator">•</span>
                <span>{doc.wordCount > 1000000 ? t('profile.stats_invalid') : t('profile.word_count', { count: doc.wordCount.toLocaleString() })}</span>
                <span className="separator">•</span>
                <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="doc-actions">
              {onOpenDocument && (
                <button
                  className="icon-btn open"
                  onClick={() => handleOpen(doc)}
                  disabled={openingId === doc.id}
                  title={t('profile.open_document', '打开')}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                    <polyline points="15 3 21 3 21 9"></polyline>
                    <line x1="10" y1="14" x2="21" y2="3"></line>
                  </svg>
                </button>
              )}
              <button
                className="icon-btn download"
                onClick={() => handleDownload(doc)}
                title={t('profile.download_docx')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="7 10 12 15 17 10"></polyline>
                  <line x1="12" y1="15" x2="12" y2="3"></line>
                </svg>
              </button>
              <button
                className="icon-btn delete"
                onClick={() => handleDelete(doc.id)}
                title={t('profile.delete')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {total > 20 && (
        <div className="pagination">
          <button
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            className="page-btn"
          >
            {t('admin.prev_page', '上一页')}
          </button>
          <span className="page-info">
            {t('admin.page_info', { page, total: Math.ceil(total / 20) })}
          </span>
          <button
            disabled={page >= Math.ceil(total / 20)}
            onClick={() => setPage(p => p + 1)}
            className="page-btn"
          >
            {t('admin.next_page', '下一页')}
          </button>
        </div>
      )}

      <style>{`
        .document-list {
          margin-top: 1rem;
        }

        h3 {
          font-size: 1.1rem;
          margin-bottom: 1rem;
          color: #333;
        }

        .list-container {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .doc-item {
          display: flex;
          align-items: center;
          gap: 1rem;
          padding: 1rem;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          transition: all 0.2s;
        }

        .doc-item:hover {
          border-color: #4a90e2;
          box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }

        .doc-icon {
          font-size: 1.5rem;
          width: 40px;
          height: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f3f4f6;
          border-radius: 8px;
        }

        .doc-info {
          flex: 1;
        }

        .doc-title {
          font-weight: 500;
          color: #111;
          margin-bottom: 0.25rem;
        }

        .doc-meta {
          font-size: 0.8rem;
          color: #6b7280;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        .separator {
          color: #d1d5db;
        }

        .icon-btn {
          border: none;
          background: none;
          cursor: pointer;
          padding: 8px;
          border-radius: 4px;
          color: #9ca3af;
          transition: all 0.2s;
        }

        .icon-btn:hover {
          background: #f3f4f6;
        }

        .icon-btn.delete:hover {
          background: #fee2e2;
          color: #dc2626;
        }

        .icon-btn.open:hover {
          background: #dbeafe;
          color: #2563eb;
        }

        .icon-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .loading, .error, .empty {
          padding: 2rem;
          text-align: center;
          color: #6b7280;
        }

        .error {
          color: #dc2626;
        }

        .pagination {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 1rem;
          margin-top: 1rem;
          padding-top: 0.75rem;
          border-top: 1px solid #e5e7eb;
        }

        .page-btn {
          padding: 6px 16px;
          font-size: 0.8rem;
          font-weight: 500;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          background: white;
          color: #374151;
          cursor: pointer;
          transition: all 0.2s;
        }

        .page-btn:hover:not(:disabled) {
          background: #f9fafb;
          border-color: #d1d5db;
        }

        .page-btn:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }

        .page-info {
          font-size: 0.8rem;
          color: #6b7280;
        }
      `}</style>
    </div>
  );
}
