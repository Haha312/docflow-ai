import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export function PaymentSuccess() {
  const { refreshUser, user } = useAuth();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 刷新用户信息以获取最新的会员状态
    refreshUser().finally(() => setLoading(false));
  }, [refreshUser]);

  const handleBackToApp = () => {
    window.location.href = '/';
  };

  if (loading) {
    return (
      <div className="payment-result-page">
        <div className="result-card">
          <div className="loading-spinner"></div>
          <h2>正在确认支付状态...</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="payment-result-page">
      <div className="result-card success">
        <div className="icon-circle success">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>

        <h1>支付成功!</h1>
        <h2 className="mt-6 text-3xl font-extrabold text-gray-900">欢迎加入 DocFlow AI Pro 会员</h2>

        <div className="info-box">
          <div className="info-item">
            <span className="label">会员状态</span>
            <span className="value pro">⭐ Pro</span>
          </div>
          {user?.subscriptionEndDate && (
            <div className="info-item">
              <span className="label">到期时间</span>
              <span className="value">
                {new Date(user.subscriptionEndDate).toLocaleDateString('zh-CN')}
              </span>
            </div>
          )}
        </div>

        <div className="benefits">
          <h3>你现在可以享受:</h3>
          <ul>
            <li>✅ 无限次文档生成</li>
            <li>✅ 所有预设模板</li>
            <li>✅ 自定义样式配置</li>
            <li>✅ 优先客服支持</li>
          </ul>
        </div>

        <button className="back-button" onClick={handleBackToApp}>
          开始使用
        </button>
      </div>

      <style>{`
        .payment-result-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 20px;
        }

        .result-card {
          background: white;
          border-radius: 16px;
          padding: 48px;
          max-width: 500px;
          width: 100%;
          text-align: center;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        }

        .icon-circle {
          width: 96px;
          height: 96px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          margin: 0 auto 24px;
        }

        .icon-circle.success {
          background: #22c55e;
          color: white;
        }

        .loading-spinner {
          width: 48px;
          height: 48px;
          border: 4px solid #e5e7eb;
          border-top-color: #667eea;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 24px;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        h1 {
          font-size: 2rem;
          font-weight: 700;
          color: #111;
          margin: 0 0 8px 0;
        }

        h2 {
          font-size: 1.5rem;
          color: #666;
          margin: 0;
        }

        .subtitle {
          font-size: 1.125rem;
          color: #666;
          margin-bottom: 32px;
        }

        .info-box {
          background: #f9fafb;
          border-radius: 12px;
          padding: 24px;
          margin-bottom: 32px;
        }

        .info-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 0;
        }

        .info-item:not(:last-child) {
          border-bottom: 1px solid #e5e7eb;
        }

        .label {
          color: #6b7280;
          font-size: 0.875rem;
        }

        .value {
          font-weight: 600;
          color: #111;
        }

        .value.pro {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 4px 12px;
          border-radius: 6px;
          font-size: 0.875rem;
        }

        .benefits {
          text-align: left;
          margin-bottom: 32px;
        }

        .benefits h3 {
          font-size: 1rem;
          font-weight: 600;
          color: #111;
          margin-bottom: 16px;
        }

        .benefits ul {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .benefits li {
          padding: 8px 0;
          color: #374151;
        }

        .back-button {
          width: 100%;
          padding: 14px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 8px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.2s;
        }

        .back-button:hover {
          transform: translateY(-2px);
        }
      `}</style>
    </div>
  );
}
