import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { OrderHistory } from './OrderHistory';
import { DocumentList, OpenableDocument } from './DocumentList';
import { cancelSubscription, getUserUsage } from '../services/backendApiService';
import { authService } from '../services/authService';
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

type AccountAction = 'pwd' | 'email' | 'delete' | null;

export function UserProfileModal({ isOpen, onClose, onOpenDocument }: UserProfileModalProps) {
  const { user, remainingQuota, logout, refreshUser } = useAuth();
  const toast = useToast();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'profile' | 'documents' | 'orders'>('profile');

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

  // 账户管理 (修改密码 / 邮箱 / 删除)
  const [activeAction, setActiveAction] = useState<AccountAction>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState('');
  // 密码表单
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  // 邮箱表单
  const [emailPwd, setEmailPwd] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [emailStep, setEmailStep] = useState<'request' | 'confirm'>('request');
  // 删除账号表单
  const [deletePwd, setDeletePwd] = useState('');
  const [deleteConfirm, setDeleteConfirm] = useState('');

  const resetAccountForms = () => {
    setActiveAction(null);
    setActionError('');
    setOldPwd(''); setNewPwd('');
    setEmailPwd(''); setNewEmail(''); setEmailCode(''); setEmailStep('request');
    setDeletePwd(''); setDeleteConfirm('');
  };

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

  const handleChangePassword = async () => {
    setActionLoading(true);
    setActionError('');
    try {
      await authService.changePassword(oldPwd, newPwd);
      toast.success(t('profile.password_changed', '密码已修改'));
      resetAccountForms();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : t('errors.change_password_failed', '密码修改失败'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleRequestEmailCode = async () => {
    setActionLoading(true);
    setActionError('');
    try {
      await authService.requestEmailChange(emailPwd, newEmail);
      toast.info(t('profile.email_code_sent', '验证码已发送到新邮箱'));
      setEmailStep('confirm');
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : t('errors.change_email_failed', '邮箱修改失败'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmEmailChange = async () => {
    setActionLoading(true);
    setActionError('');
    try {
      await authService.confirmEmailChange(emailCode);
      await refreshUser();
      toast.success(t('profile.email_changed', '邮箱已更新'));
      resetAccountForms();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : t('errors.change_email_failed', '邮箱修改失败'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    setActionLoading(true);
    setActionError('');
    try {
      await authService.deleteAccount(deletePwd);
      toast.success(t('profile.account_deleted', '账号已删除'));
      // 直接 logout(authService.deleteAccount 已 clearToken)+ 关闭 modal
      // logout() 会把 AuthContext 的 user 设 null, 主页面自动重渲染
      logout();
      onClose();
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : t('errors.delete_account_failed', '账号删除失败'));
      setActionLoading(false);
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

                {user.subscriptionEndDate && (() => {
                  const endDate = new Date(user.subscriptionEndDate);
                  const msLeft = endDate.getTime() - Date.now();
                  const daysLeft = Math.max(0, Math.ceil(msLeft / 86400000));
                  const isExpiringSoon = daysLeft > 0 && daysLeft <= 7;
                  return (
                    <div className="flex justify-between items-center py-2">
                      <span className="text-sm text-gray-500">{t('profile.valid_until')}</span>
                      <span className={`text-sm font-medium ${isExpiringSoon ? 'text-red-600' : 'text-gray-900'}`}>
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
              </div>

              {/* 本月用量统计 */}
              {monthlyCount !== null && (
                <div className="bg-white rounded-xl border border-gray-200 p-4">
                  <p className="text-xs text-gray-400 mb-3">{t('profile.this_month_usage', '本月用量')}</p>
                  <div className="flex gap-4">
                    <div className="flex-1 text-center bg-gray-50 rounded-lg py-3">
                      <div className="text-2xl font-bold text-gray-900">{monthlyCount}</div>
                      <div className="text-xs text-gray-500 mt-0.5">{t('profile.generation_count', '次生成')}</div>
                    </div>
                    <div className="flex-1 text-center bg-gray-50 rounded-lg py-3">
                      <div className="text-2xl font-bold text-gray-900">
                        {totalTokens && totalTokens > 1000
                          ? `${(totalTokens / 1000).toFixed(1)}k`
                          : (totalTokens ?? 0)}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">{t('profile.tokens_used', 'tokens 消耗')}</div>
                    </div>
                  </div>
                </div>
              )}

              {/* 账户管理 (修改密码 / 修改邮箱 / 删除账号) */}
              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
                <p className="text-xs text-gray-400 mb-2">{t('profile.account_management', '账户管理')}</p>

                {/* 修改密码 */}
                {activeAction !== 'pwd' ? (
                  <button
                    onClick={() => { resetAccountForms(); setActiveAction('pwd'); }}
                    className="w-full text-left text-sm text-gray-700 hover:text-gray-900 transition-colors py-1.5"
                  >
                    {t('profile.change_password', '修改密码')}
                  </button>
                ) : (
                  <div className="space-y-2 py-1">
                    <input
                      type="password"
                      placeholder={t('profile.old_password', '当前密码')}
                      value={oldPwd}
                      onChange={(e) => setOldPwd(e.target.value)}
                      disabled={actionLoading}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                    />
                    <input
                      type="password"
                      placeholder={t('profile.new_password_min', '新密码 (至少 6 位)')}
                      value={newPwd}
                      onChange={(e) => setNewPwd(e.target.value)}
                      disabled={actionLoading}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                    />
                    {actionError && <p className="text-xs text-red-600">{actionError}</p>}
                    <div className="flex gap-2 pt-1">
                      <button disabled={actionLoading} onClick={resetAccountForms} className="flex-1 py-2 bg-gray-50 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-100 disabled:opacity-50">
                        {t('common.cancel', '取消')}
                      </button>
                      <button
                        disabled={actionLoading || !oldPwd || newPwd.length < 6}
                        onClick={handleChangePassword}
                        className="flex-1 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
                      >
                        {actionLoading ? t('common.processing', '处理中...') : t('common.confirm', '确定')}
                      </button>
                    </div>
                  </div>
                )}

                {/* 修改邮箱 */}
                {activeAction !== 'email' ? (
                  <button
                    onClick={() => { resetAccountForms(); setActiveAction('email'); }}
                    className="w-full text-left text-sm text-gray-700 hover:text-gray-900 transition-colors py-1.5 border-t border-gray-100"
                  >
                    {t('profile.change_email', '修改邮箱')}
                  </button>
                ) : (
                  <div className="space-y-2 py-1 border-t border-gray-100 pt-3">
                    {emailStep === 'request' ? (
                      <>
                        <input
                          type="password"
                          placeholder={t('profile.current_password', '当前密码')}
                          value={emailPwd}
                          onChange={(e) => setEmailPwd(e.target.value)}
                          disabled={actionLoading}
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                        />
                        <input
                          type="email"
                          placeholder={t('profile.new_email', '新邮箱地址')}
                          value={newEmail}
                          onChange={(e) => setNewEmail(e.target.value)}
                          disabled={actionLoading}
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                        />
                        {actionError && <p className="text-xs text-red-600">{actionError}</p>}
                        <div className="flex gap-2 pt-1">
                          <button disabled={actionLoading} onClick={resetAccountForms} className="flex-1 py-2 bg-gray-50 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-100 disabled:opacity-50">
                            {t('common.cancel', '取消')}
                          </button>
                          <button
                            disabled={actionLoading || !emailPwd || !newEmail.includes('@')}
                            onClick={handleRequestEmailCode}
                            className="flex-1 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
                          >
                            {actionLoading ? t('common.processing', '处理中...') : t('profile.send_code_to_new_email', '发送验证码')}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="text-xs text-gray-500">{t('profile.code_sent_to', '验证码已发到 {{email}}', { email: newEmail })}</p>
                        <input
                          type="text"
                          placeholder={t('auth.email_code_placeholder', '输入6位验证码')}
                          value={emailCode}
                          onChange={(e) => setEmailCode(e.target.value)}
                          disabled={actionLoading}
                          maxLength={6}
                          className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
                        />
                        {actionError && <p className="text-xs text-red-600">{actionError}</p>}
                        <div className="flex gap-2 pt-1">
                          <button disabled={actionLoading} onClick={resetAccountForms} className="flex-1 py-2 bg-gray-50 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-100 disabled:opacity-50">
                            {t('common.cancel', '取消')}
                          </button>
                          <button
                            disabled={actionLoading || emailCode.length !== 6}
                            onClick={handleConfirmEmailChange}
                            className="flex-1 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium hover:bg-gray-800 disabled:opacity-50"
                          >
                            {actionLoading ? t('common.processing', '处理中...') : t('common.confirm', '确定')}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* 删除账号 */}
                {activeAction !== 'delete' ? (
                  <button
                    onClick={() => { resetAccountForms(); setActiveAction('delete'); }}
                    className="w-full text-left text-sm text-red-600 hover:text-red-700 transition-colors py-1.5 border-t border-gray-100"
                  >
                    {t('profile.delete_account', '删除账号')}
                  </button>
                ) : (
                  <div className="space-y-2 py-1 border-t border-gray-100 pt-3">
                    <p className="text-sm text-red-600 font-medium">{t('profile.delete_account_warning', '此操作不可撤销!所有文档、订单、使用记录将被永久删除。')}</p>
                    <input
                      type="password"
                      placeholder={t('profile.current_password', '当前密码')}
                      value={deletePwd}
                      onChange={(e) => setDeletePwd(e.target.value)}
                      disabled={actionLoading}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                    <input
                      type="text"
                      placeholder={t('profile.delete_confirm_placeholder', '输入 DELETE 确认')}
                      value={deleteConfirm}
                      onChange={(e) => setDeleteConfirm(e.target.value)}
                      disabled={actionLoading}
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                    {actionError && <p className="text-xs text-red-600">{actionError}</p>}
                    <div className="flex gap-2 pt-1">
                      <button disabled={actionLoading} onClick={resetAccountForms} className="flex-1 py-2 bg-gray-50 border border-gray-200 text-gray-600 rounded-lg text-sm hover:bg-gray-100 disabled:opacity-50">
                        {t('common.cancel', '取消')}
                      </button>
                      <button
                        disabled={actionLoading || !deletePwd || deleteConfirm !== 'DELETE'}
                        onClick={handleDeleteAccount}
                        className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
                      >
                        {actionLoading ? t('common.processing', '处理中...') : t('profile.delete_account_confirm', '永久删除账号')}
                      </button>
                    </div>
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
