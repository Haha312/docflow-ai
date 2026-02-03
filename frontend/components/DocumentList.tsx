import React, { useEffect, useState } from 'react';
import { getUserDocuments, deleteDocument, getDocument } from '../services/backendApiService';
import { useConfirmDialog } from './ConfirmDialog';
import { generateDocx } from '../utils/docxGenerator';
import { PRESETS } from '../constants';
import { StyleConfig } from '../types';

interface Document {
  id: string;
  title: string;
  preset: string;
  wordCount: number;
  createdAt: string;
}

export function DocumentList() {
  const { confirm, ConfirmDialogComponent } = useConfirmDialog();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

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
      setError('无法获取文档历史');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async (doc: Document) => {
    try {
      // 1. Fetch full document content (including HTML)
      const fullDoc = await getDocument(doc.id);
      if (!fullDoc || !fullDoc.content) {
        alert('文档内容为空');
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
      alert('下载失败，请稍后重试');
    }
  };

  const handleDelete = async (id: string) => {
    const confirmed = await confirm('确定要删除这个文档吗？', {
      title: '删除文档',
      variant: 'danger'
    });

    if (!confirmed) return;

    try {
      await deleteDocument(id);
      loadDocuments(); // 刷新列表
    } catch (err) {
      alert('删除失败');
    }
  };

  const getPresetName = (preset: string) => {
    const normalizedPreset = (preset || '').toLowerCase();
    const names: Record<string, string> = {
      'corporate': '企业公文',
      'academic': '学术论文',
      'academic-journal': '期刊论文',
      'creative': '创意写作',
      'minimalist': '极简风格'
    };
    return names[normalizedPreset] || preset;
  };

  if (loading && documents.length === 0) return <div className="loading">加载中...</div>;
  if (error) return <div className="error">{error}</div>;
  if (documents.length === 0) return <div className="empty">暂无文档历史</div>;

  return (
    <div className="document-list">
      {ConfirmDialogComponent}
      <h3>文档历史</h3>
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
                <span>{doc.wordCount > 1000000 ? '统计失效 (旧数据)' : `${doc.wordCount.toLocaleString()} 字`}</span>
                <span className="separator">•</span>
                <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
            <div className="doc-actions">
              <button
                className="icon-btn download"
                onClick={() => handleDownload(doc)}
                title="下载 DOCX"
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
                title="删除"
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

        .loading, .error, .empty {
          padding: 2rem;
          text-align: center;
          color: #6b7280;
        }

        .error {
          color: #dc2626;
        }
      `}</style>
    </div>
  );
}
