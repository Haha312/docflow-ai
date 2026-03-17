import React from 'react';
import { useTranslation } from 'react-i18next';

export function PaymentCancel() {
  const { t } = useTranslation();
  const handleBackToApp = () => {
    window.location.href = '/';
  };

  const handleRetry = () => {
    window.location.href = '/?upgrade=true';
  };

  return (
    <div className="payment-result-page">
      <div className="result-card cancel">
        <div className="icon-circle cancel">
          <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
          </svg>
        </div>

        <h1>{t('pricing.payment_cancelled', '支付已取消')}</h1>
        <p className="subtitle">{t('pricing.return_to_upgrade', '你可以随时返回继续升级')}</p>

        <div className="info-box">
          <p>{t('pricing.pro_benefits', '💡 升级 Pro 会员可以享受:')}</p>
          <ul>
            <li>✅ {t('pricing.benefit_unlimited', '无限次文档生成')}</li>
            <li>✅ {t('pricing.benefit_presets', '所有预设模板')}</li>
            <li>✅ {t('pricing.benefit_custom_style', '自定义样式配置')}</li>
            <li>✅ {t('pricing.benefit_priority_support', '优先客服支持')}</li>
          </ul>
        </div>

        <div className="button-group">
          <button className="retry-button" onClick={handleRetry}>
            {t('pricing.upgrade_again', '重新升级')}
          </button>
          <button className="back-button" onClick={handleBackToApp}>
            {t('pricing.back_to_app_btn', '返回应用')}
          </button>
        </div>
      </div>

      <style>{`
        .payment-result-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #6b7280 0%, #374151 100%);
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

        .icon-circle.cancel {
          background: #ef4444;
          color: white;
        }

        h1 {
          font-size: 2rem;
          font-weight: 700;
          color: #111;
          margin: 0 0 8px 0;
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
          text-align: left;
        }

        .info-box p {
          font-weight: 600;
          color: #111;
          margin-bottom: 16px;
        }

        .info-box ul {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .info-box li {
          padding: 8px 0;
          color: #374151;
        }

        .button-group {
          display: flex;
          gap: 12px;
        }

        .retry-button,
        .back-button {
          flex: 1;
          padding: 14px;
          border: none;
          border-radius: 8px;
          font-size: 1rem;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.2s;
        }

        .retry-button {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }

        .back-button {
          background: #f3f4f6;
          color: #374151;
        }

        .retry-button:hover,
        .back-button:hover {
          transform: translateY(-2px);
        }
      `}</style>
    </div>
  );
}
