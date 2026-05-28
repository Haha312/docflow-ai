import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { OrderHistory } from './OrderHistory';
import { DocumentList, OpenableDocument } from './DocumentList';
import { cancelSubscription } from '../services/backendApiService';
import { useTranslation } from 'react-i18next';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * 父组件提供时,文档历史列表会显示"打开"按钮;点击后此回调被触发,
   * 同时 Modal 自动关闭(把控制权交回主页面)。
   */
  onOpenDocument?: (doc: OpenableDocument) => void;
}

export function UserProfileModal({ isOpen, onClose, onOpenDocument }: UserProfileModalProps) {
  const { user, remainingQuota, logout, refreshUser } = useAuth();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'profile' | 'documents' | 'orders'>('profile');
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState('');

  const handleCancelSubscription = async () => {
    setIsCancelling(true);
    setCancelError('');
    try {
      await cancelSubscription();
      await refreshUser();
      setConfirmCancel(false);
    } catch (e: any) {
      setCancelError(e.message || t('profile.cancel_failed', '取消订阅失败,请重试'));
    } finally {
      setIsCancelling(false);
    }
  };

  if (!isOpen || !user) return null;

  const isPro = user.subscriptionStatus !== 'FREE';
  const tierLabel = user.subscriptionStatus === 'ULTRA' ? t('admin.tier_ultra_label') :
    user.subscriptionStatus === 'PRO' ? t('admin.tier_pro_label') :
      user.subscriptionStatus === 'PLUS' ? t('admin.tier_plus_label') : t('admin.tier_free_label');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative z-10 w-full max-w-2xl bg-white rounded-xl shadow-xl overflow-hidden flex flex-col text-sm border border-gray-100" style={{ maxHeight: '70vh' }}>
        {/* Header */}
        <div className="px-6 pt-5 pb-0">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>

          <div className="flex items-center gap-4 mb-6">
            <div className="w-14 h-14 rounded-full bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-700 font-medium text-xl">
              {(user.email.charAt(0) || '?').toUpperCase()}
            </div>
            <div>
              <h2 className="text-xl font-medium text-gray-900">{t('profile.title')}</h2>
              <p className="text-sm text-gray-500 mt-0.5">{user.email}</p>
            </div>
          </div>

          {/* Tabs - Simple Underline Style */}
          <div className="flex gap-6 border-b border-gray-200">
            {[
              { key: 'profile', label: t('profile.tab_profile') },
              { key: 'documents', label: t('profile.tab_documents') },
              { key: 'orders', label: t('profile.tab_orders') }
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`pb-3 text-sm font-medium transition-colors relative ${activeTab === tab.key
                  ? 'text-gray-900'
                  : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                {tab.label}
                {activeTab === tab.key && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-900 rounded-t-full" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-gray-50">
          {activeTab === 'profile' && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex justify-between items-center py-2 border-b border-gray-100">
                  <span className="text-sm text-gray-500">{t('profile.current_tier')}</span>
                  <span className={`text-sm font-medium px-2.5 py-0.5 rounded-full ${isPro ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
                    {tierLabel}
                  </span>
                </div>

                {user.subscriptionStatus === 'FREE' && (
                  <div className="flex justify-between items-center py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">{t('profile.remaining_free_quota')}</span>
                    <span className="text-sm font-medium text-gray-900">{remainingQuota} {t('profile.times')}</span>
                  </div>
                )}

                {user.subscriptionEndDate && (
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-gray-500">{t('profile.valid_until')}</span>
                    <span className="text-sm font-medium text-gray-900">
                      {new Date(user.subscriptionEndDate).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>

              {/* Cancel subscription (only for paid users) */}
              {isPro && (
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  {confirmCancel ? (
                    <>
                      <p className="text-sm text-gray-700 mb-3">
                        {t('profile.cancel_warning', '取消订阅后账号立即降级为免费版,本月剩余权益将作废。如需退款剩余天数请联系客服。')}
                      </p>
                      {cancelError && (
                        <p className="text-sm text-red-600 mb-3">{cancelError}</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          disabled={isCancelling}
                          onClick={() => { setConfirmCancel(false); setCancelError(''); }}
                          className="flex-1 py-2.5 bg-gray-50 border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-100 transition-colors disabled:opacity-50"
                        >
                          {t('common.cancel', '取消')}
                        </button>
                        <button
                          disabled={isCancelling}
                          onClick={handleCancelSubscription}
                          className="flex-1 py-2.5 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
                        >
                          {isCancelling ? t('common.processing', '处理中...') : t('profile.cancel_confirm', '确认取消订阅')}
                        </button>
                      </div>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmCancel(true)}
                      className="w-full text-left text-sm text-gray-600 hover:text-red-600 transition-colors"
                    >
                      {t('profile.cancel_subscription', '取消订阅')}
                      <span className="text-xs text-gray-400 ml-2">{t('profile.cancel_subscription_hint', '(立即降级,放弃剩余天数)')}</span>
                    </button>
                  )}
                </div>
              )}

              {confirmLogout ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmLogout(false)}
                    className="flex-1 py-2.5 bg-white border border-gray-200 text-gray-600 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    {t('common.cancel', '取消')}
                  </button>
                  <button
                    onClick={() => { logout(); onClose(); }}
                    className="flex-1 py-2.5 bg-red-500 text-white rounded-xl text-sm font-medium hover:bg-red-600 transition-colors"
                  >
                    {t('profile.logout_confirm', '确认退出')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmLogout(true)}
                  className="w-full py-3 bg-white border border-gray-200 text-red-600 rounded-xl text-sm font-medium hover:bg-red-50 hover:border-red-100 transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                    <polyline points="16 17 21 12 16 7"></polyline>
                    <line x1="21" y1="12" x2="9" y2="12"></line>
                  </svg>
                  {t('profile.logout')}
                </button>
              )}
            </div>
          )}

          {activeTab === 'documents' && (
            <DocumentList
              onOpenDocument={onOpenDocument ? (doc) => { onOpenDocument(doc); onClose(); } : undefined}
            />
          )}
          {activeTab === 'orders' && <OrderHistory />}
        </div>
      </div>
    </div>
  );
}
