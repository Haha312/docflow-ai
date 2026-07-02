import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { OrderHistory } from './OrderHistory';
import { cancelSubscription, getUserUsage } from '../services/backendApiService';
import { useTranslation } from 'react-i18next';
import { AccountTone, UserAvatar } from './UserAvatar';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function UserProfileModal({ isOpen, onClose }: UserProfileModalProps) {
  const { user, remainingQuota, logout, refreshUser } = useAuth();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'profile' | 'orders'>('profile');

  // 本月用量统计
  const [monthlyCount, setMonthlyCount] = useState<number | null>(null);
  const [totalTokens, setTotalTokens] = useState<number | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    getUserUsage(200).then((logs) => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthly = logs.filter(
        (l) => l.actionType === 'generate_document' && new Date(l.createdAt) >= monthStart
      );
      setMonthlyCount(monthly.length);
      setTotalTokens(monthly.reduce((sum, l) => sum + (l.tokenUsage ?? 0), 0));
    }).catch(() => {/* 静默失败,不影响主功能 */});
  }, [isOpen]);
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

  const isAdmin = Boolean(user.isAdmin);
  const isPro = user.subscriptionStatus !== 'FREE';
  const tierQuotaTotal = user.subscriptionStatus === 'ULTRA' ? 1000 :
    user.subscriptionStatus === 'PRO' ? 200 :
      user.subscriptionStatus === 'PLUS' ? 50 : 3;
  const tierLabel = isAdmin ? t('nav.dashboard', '管理员') :
    user.subscriptionStatus === 'ULTRA' ? t('admin.tier_ultra_label') :
    user.subscriptionStatus === 'PRO' ? t('admin.tier_pro_label') :
      user.subscriptionStatus === 'PLUS' ? t('admin.tier_plus_label') : t('admin.tier_free_label');
  const accountTone: AccountTone = isAdmin ? 'admin' : isPro ? 'paid' : 'free';
  const quotaExplain = user.subscriptionStatus === 'FREE'
      ? t('profile.quota_free_explain', '免费版仅保留少量体验次数，升级会员后按月获得新的生成额度。')
      : t('profile.quota_paid_explain', '会员额度按自然月统计，显示为本月剩余次数 / 本月总次数。');

  return (
    <div className="prism-modal profile-modal fixed inset-0 z-50 flex items-center justify-center px-4">
      <button
        type="button"
        className="profile-backdrop absolute inset-0"
        onClick={onClose}
        aria-label={t('common.close', '关闭')}
      />

      <div className="profile-panel relative z-10 w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden flex flex-col text-sm" style={{ maxHeight: '70vh' }}>
        {/* Header */}
        <div className="profile-header px-6 pt-5 pb-0">
          <button
            onClick={onClose}
            className="profile-close absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full transition-colors"
            aria-label={t('common.close', '关闭')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>

          <div className="flex items-center gap-4 mb-6">
            <UserAvatar tone={accountTone} size="lg" />
            <div>
              <h2 className="profile-title text-xl font-medium">{t('profile.title')}</h2>
              <p className="profile-subtitle text-sm mt-0.5">{user.phone ? `${user.phone.slice(0, 3)}****${user.phone.slice(-4)}` : (user.email || '')}</p>
            </div>
          </div>

          {/* Tabs - Simple Underline Style */}
          <div className="profile-tabs flex gap-6">
            {[
              { key: 'profile', label: t('profile.tab_profile') },
              { key: 'orders', label: t('profile.tab_orders') }
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as any)}
                className={`profile-tab pb-3 text-sm font-medium transition-colors relative ${activeTab === tab.key ? 'is-active' : ''}`}
              >
                {tab.label}
                {activeTab === tab.key && (
                  <div className="profile-tab-indicator absolute bottom-0 left-0 right-0 h-0.5 rounded-t-full" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="profile-body flex-1 overflow-y-auto p-6">
          {activeTab === 'profile' && (
            <div className="space-y-4">
              <div className="profile-section rounded-xl p-4">
                <div className="profile-row flex justify-between items-center py-2">
                  <span className="profile-label text-sm">{t('profile.current_tier')}</span>
                  <span className="user-tier-pill text-sm font-medium px-2.5 py-0.5 rounded-full" data-account-tone={accountTone}>
                    {tierLabel}
                  </span>
                </div>

                {isAdmin ? (
                  <div className="profile-row flex justify-between items-center py-2">
                    <span className="profile-label text-sm">{t('profile.quota')}</span>
                    <span className="profile-value text-sm font-medium">{t('nav.quota_unlimited', '不限次数')}</span>
                  </div>
                ) : user.subscriptionStatus === 'FREE' ? (
                  <div className="profile-row flex justify-between items-center py-2">
                    <span className="profile-label text-sm">{t('profile.remaining_free_quota')}</span>
                    <span className="profile-value text-sm font-medium">{remainingQuota} {t('profile.times')}</span>
                  </div>
                ) : (
                  <div className="profile-row flex justify-between items-center py-2">
                    <span className="profile-label text-sm">{t('profile.period_remaining_quota')}</span>
                    <span className="profile-value text-sm font-medium">
                      {remainingQuota} / {tierQuotaTotal} {t('profile.times')}
                    </span>
                  </div>
                )}

                {user.subscriptionEndDate && (() => {
                  const endDate = new Date(user.subscriptionEndDate);
                  const msLeft = endDate.getTime() - Date.now();
                  const daysLeft = Math.max(0, Math.ceil(msLeft / 86400000));
                  const isExpiringSoon = daysLeft > 0 && daysLeft <= 7;
                  return (
                    <div className="profile-row flex justify-between items-center py-2">
                      <span className="profile-label text-sm">{t('profile.valid_until')}</span>
                      <span className={`profile-value text-sm font-medium ${isExpiringSoon ? 'is-danger' : ''}`}>
                        {endDate.toLocaleDateString()}
                        {daysLeft > 0 && (
                          <span className="ml-2 text-xs">
                            ({t('profile.days_left', '剩余 {{n}} 天', { n: daysLeft })})
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })()}

                {!isAdmin && (
                  <div className="profile-quota-note mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed">
                    {quotaExplain}
                  </div>
                )}
              </div>

              {/* 本月用量统计 */}
              {monthlyCount !== null && (
                <div className="profile-section rounded-xl p-4">
                  <p className="profile-label text-xs mb-3">{t('profile.this_month_usage', '本月用量')}</p>
                  <div className="flex gap-4">
                    <div className="profile-stat flex-1 text-center rounded-lg py-3">
                      <div className="profile-stat-value text-2xl font-bold">{monthlyCount}</div>
                      <div className="profile-stat-label text-xs mt-0.5">{t('profile.generation_count', '次生成')}</div>
                    </div>
                    <div className="profile-stat flex-1 text-center rounded-lg py-3">
                      <div className="profile-stat-value text-2xl font-bold">
                        {totalTokens && totalTokens > 1000
                          ? `${(totalTokens / 1000).toFixed(1)}k`
                          : (totalTokens ?? 0)}
                      </div>
                      <div className="profile-stat-label text-xs mt-0.5">{t('profile.tokens_used', 'tokens 消耗')}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* Cancel subscription (only for paid users) */}
              {isPro && (
                <div className="profile-section rounded-xl p-4">
                  {confirmCancel ? (
                    <>
                      <p className="profile-note text-sm mb-3">
                        {t('profile.cancel_warning', '取消订阅后账号立即降级为免费版,本月剩余权益将作废。如需退款剩余天数请联系客服。')}
                      </p>
                      {cancelError && (
                        <p className="text-sm text-red-600 mb-3">{cancelError}</p>
                      )}
                      <div className="flex gap-2">
                        <button
                          disabled={isCancelling}
                          onClick={() => { setConfirmCancel(false); setCancelError(''); }}
                          className="profile-secondary-btn flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
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
                      className="profile-danger-link w-full text-left text-sm transition-colors"
                    >
                      {t('profile.cancel_subscription', '取消订阅')}
                      <span className="profile-danger-hint text-xs ml-2">{t('profile.cancel_subscription_hint', '(立即降级,放弃剩余天数)')}</span>
                    </button>
                  )}
                </div>
              )}

              {confirmLogout ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => setConfirmLogout(false)}
                    className="profile-secondary-btn flex-1 py-2.5 rounded-xl text-sm font-medium transition-colors"
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
                  className="profile-logout-btn w-full py-3 rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2"
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

          {activeTab === 'orders' && <OrderHistory />}
        </div>
      </div>
    </div>
  );
}
