import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { OrderHistory } from './OrderHistory';
import { DocumentList } from './DocumentList';

interface UserProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function UserProfileModal({ isOpen, onClose }: UserProfileModalProps) {
  const { user, remainingQuota, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'profile' | 'documents' | 'orders'>('profile');

  if (!isOpen || !user) return null;

  const isPro = user.subscriptionStatus === 'PRO' || user.subscriptionStatus === 'TEAM';
  const tierLabel = user.subscriptionStatus === 'TEAM' ? '团队版' :
    user.subscriptionStatus === 'PRO' ? 'Pro 专业版' : '免费版';

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
              {user.email.charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-xl font-medium text-gray-900">用户中心</h2>
              <p className="text-sm text-gray-500 mt-0.5">{user.email}</p>
            </div>
          </div>

          {/* Tabs - Simple Underline Style */}
          <div className="flex gap-6 border-b border-gray-200">
            {[
              { key: 'profile', label: '个人资料' },
              { key: 'documents', label: '文档历史' },
              { key: 'orders', label: '订单记录' }
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
                  <span className="text-sm text-gray-500">当前会员</span>
                  <span className={`text-sm font-medium px-2.5 py-0.5 rounded-full ${user.subscriptionStatus === 'TEAM' ? 'bg-gray-900 text-white' :
                    isPro ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'
                    }`}>
                    {tierLabel}
                  </span>
                </div>

                {user.subscriptionStatus === 'FREE' && (
                  <div className="flex justify-between items-center py-2 border-b border-gray-100">
                    <span className="text-sm text-gray-500">今日额度</span>
                    <span className="text-sm font-medium text-gray-900">{remainingQuota} / 3 次</span>
                  </div>
                )}

                {user.subscriptionEndDate && (
                  <div className="flex justify-between items-center py-2">
                    <span className="text-sm text-gray-500">有效期至</span>
                    <span className="text-sm font-medium text-gray-900">
                      {new Date(user.subscriptionEndDate).toLocaleDateString()}
                    </span>
                  </div>
                )}
              </div>

              <button
                onClick={() => { logout(); onClose(); }}
                className="w-full py-3 bg-white border border-gray-200 text-red-600 rounded-xl text-sm font-medium hover:bg-red-50 hover:border-red-100 transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                  <polyline points="16 17 21 12 16 7"></polyline>
                  <line x1="21" y1="12" x2="9" y2="12"></line>
                </svg>
                退出登录
              </button>
            </div>
          )}

          {activeTab === 'documents' && <DocumentList />}
          {activeTab === 'orders' && <OrderHistory />}
        </div>
      </div>
    </div>
  );
}
