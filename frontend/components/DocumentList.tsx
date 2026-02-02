import React, { useEffect, useState } from 'react';
import { getUserDocuments, deleteDocument } from '../services/backendApiService';

interface Document {
    id: string;
    title: string;
    preset: string;
    wordCount: number;
    createdAt: string;
}

export function DocumentList() {
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

    const handleDelete = async (id: string) => {
        if (!confirm('确定要删除这个文档吗?')) return;
        try {
            await deleteDocument(id);
            loadDocuments(); // 刷新列表
        } catch (err) {
            alert('删除失败');
        }
    };

    const getPresetName = (preset: string) => {
        const names: Record<string, string> = {
            'corporate': '企业公文',
            'academic': '学术论文',
            'academic-journal': '期刊论文',
            'creative': '创意写作',
            'minimalist': '极简风格'
        };
        return names[preset] || preset;
    };

    if (loading && documents.length === 0) return <div className="loading">加载中...</div>;
    if (error) return <div className="error">{error}</div>;
    if (documents.length === 0) return <div className="empty">暂无文档历史</div>;

    return (
        <div className="document-list">
            <h3>文档历史</h3>
            <div className="list-container">
                {documents.map(doc => (
                    <div key={doc.id} className="doc-item">
                        <div className="doc-icon">📄</div>
                        <div className="doc-info">
                            <div className="doc-title">{doc.title}</div>
                            <div className="doc-meta">
                                <span>{getPresetName(doc.preset)}</span>
                                <span className="separator">•</span>
                                <span>{doc.wordCount} 字</span>
                                <span className="separator">•</span>
                                <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                            </div>
                        </div>
                        <div className="doc-actions">
                            <button className="icon-btn delete" onClick={() => handleDelete(doc.id)} title="删除">
                                ✕
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
