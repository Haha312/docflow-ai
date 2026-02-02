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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>

        <div className="modal-header">
          <div className="avatar-placeholder">
            {user.email.charAt(0).toUpperCase()}
          </div>
          <h2>用户中心</h2>
          <div className="user-email">{user.email}</div>
        </div>

        <div className="tabs-container">
          <button
            className={`tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            个人资料
          </button>
          <button
            className={`tab-btn ${activeTab === 'documents' ? 'active' : ''}`}
            onClick={() => setActiveTab('documents')}
          >
            文档历史
          </button>
          <button
            className={`tab-btn ${activeTab === 'orders' ? 'active' : ''}`}
            onClick={() => setActiveTab('orders')}
          >
            订单记录
          </button>
        </div>

        <div className="modal-body custom-scrollbar">
          {activeTab === 'profile' && (
            <div className="profile-section">
              <div className="info-card">
                <div className="card-row">
                  <span className="label">当前会员</span>
                  <span className={`status-badge ${user.subscriptionStatus === 'PRO' ? 'pro' : 'free'}`}>
                    {user.subscriptionStatus === 'PRO' ? 'Pro 专业版' : '免费版'}
                  </span>
                </div>

                {user.subscriptionStatus === 'FREE' && (
                  <div className="card-row">
                    <span className="label">今日额度</span>
                    <span className="quota-text">{remainingQuota} / 3 次</span>
                  </div>
                )}

                {user.subscriptionEndDate && (
                  <div className="card-row">
                    <span className="label">有效期至</span>
                    <span className="value">{new Date(user.subscriptionEndDate).toLocaleDateString()}</span>
                  </div>
                )}
              </div>

              <button className="logout-btn" onClick={() => { logout(); onClose(); }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                退出登录
              </button>
            </div>
          )}

          {activeTab === 'documents' && (
            <div className="list-wrapper">
              <DocumentList />
            </div>
          )}
          {activeTab === 'orders' && (
            <div className="list-wrapper">
              <OrderHistory />
            </div>
          )}
        </div>
      </div>

      <style>{`
                .modal-overlay {
                    position: fixed;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(0, 0, 0, 0.4);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    z-index: 1000;
                    backdrop-filter: blur(4px);
                    animation: fadeIn 0.2s ease-out;
                }

                .modal-content {
                    background: white;
                    border-radius: 28px;
                    width: 90%;
                    max-width: 560px;
                    height: 80vh; 
                    max-height: 700px;
                    display: flex;
                    flex-direction: column;
                    position: relative;
                    box-shadow: 0 24px 48px rgba(0, 0, 0, 0.12);
                    overflow: hidden;
                    animation: scaleIn 0.2s ease-out;
                }

                .modal-close {
                    position: absolute;
                    top: 1.5rem;
                    right: 1.5rem;
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    border: none;
                    background: transparent;
                    color: #444746;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: background 0.2s;
                    z-index: 10;
                }
                .modal-close:hover {
                    background: #f0f4f9;
                }

                .modal-header {
                    padding: 2.5rem 2rem 1.5rem;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    background: white;
                    flex-shrink: 0;
                }

                .avatar-placeholder {
                    width: 64px;
                    height: 64px;
                    border-radius: 50%;
                    background: #0b57d0;
                    color: white;
                    font-size: 1.75rem;
                    font-weight: 500;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-bottom: 1rem;
                    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                }

                .modal-header h2 {
                    margin: 0;
                    font-size: 1.5rem;
                    color: #1f1f1f;
                    font-weight: 400;
                }

                .user-email {
                    color: #444746;
                    font-size: 0.9rem;
                    margin-top: 0.25rem;
                }

                .tabs-container {
                    display: flex;
                    padding: 0 1.5rem;
                    justify-content: center;
                    gap: 0.5rem;
                    border-bottom: 1px solid #e0e3e1;
                    flex-shrink: 0;
                }

                .tab-btn {
                    padding: 0.75rem 1.25rem;
                    border: none;
                    background: transparent;
                    font-size: 0.9rem;
                    font-weight: 500;
                    color: #444746;
                    cursor: pointer;
                    border-bottom: 3px solid transparent;
                    transition: all 0.2s;
                    border-radius: 8px 8px 0 0;
                }

                .tab-btn:hover {
                    background: #f0f4f9;
                }

                .tab-btn.active {
                    color: #0b57d0;
                    border-bottom-color: #0b57d0;
                }

                .modal-body {
                    flex: 1;
                    padding: 2rem;
                    overflow-y: auto;
                    background: #f8f9fa;
                }

                .profile-section {
                    max-width: 400px;
                    margin: 0 auto;
                }

                .info-card {
                    background: white;
                    border-radius: 16px;
                    padding: 1.5rem;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                    margin-bottom: 2rem;
                }

                .card-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 0.75rem 0;
                    border-bottom: 1px solid #f0f0f0;
                }
                .card-row:last-child {
                    border-bottom: none;
                }

                .label {
                    color: #444746;
                    font-size: 0.9rem;
                }

                .status-badge {
                    padding: 4px 12px;
                    border-radius: 100px;
                    font-size: 0.85rem;
                    font-weight: 500;
                }
                .status-badge.pro {
                    background: #d3e3fd;
                    color: #041e49;
                }
                .status-badge.free {
                    background: #e3e3e3;
                    color: #1f1f1f;
                }

                .value, .quota-text {
                    color: #1f1f1f;
                    font-weight: 500;
                }

                .logout-btn {
                    width: 100%;
                    padding: 0.875rem;
                    background: white;
                    color: #b3261e;
                    border: 1px solid #f2f2f2;
                    border-radius: 100px;
                    font-size: 0.95rem;
                    font-weight: 500;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    transition: all 0.2s;
                }
                .logout-btn:hover {
                    background: #fff8f8;
                    border-color: #fce8e6;
                }

                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes scaleIn {
                    from { transform: scale(0.95); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
            `}</style>
    </div>
  );
}
