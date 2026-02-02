import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';

interface UserInfoProps {
  onOpenPricing: () => void;
  onOpenAuth: () => void;
  onOpenProfile: () => void;
}

export function UserInfo({ onOpenPricing, onOpenAuth, onOpenProfile }: UserInfoProps) {
  const { user, isAuthenticated, isLoading, remainingQuota, logout } = useAuth();
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (isLoading) {
    return <div className="h-9 w-24 bg-zinc-200 animate-pulse rounded-lg"></div>;
  }

  if (!isAuthenticated || !user) {
    return (
      <button
        onClick={onOpenAuth}
        className="text-sm font-semibold text-zinc-600 hover:text-zinc-900 transition-colors"
      >
        登录 / 注册
      </button>
    );
  }

  const isPro = user.subscriptionStatus === 'PRO';

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="flex items-center gap-3 hover:bg-zinc-100 rounded-lg p-1.5 pr-3 transition-colors"
      >
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white font-bold text-xs shadow-sm">
          {user.email.charAt(0).toUpperCase()}
        </div>
        <div className="flex flex-col items-start">
          <span className="text-xs font-medium text-zinc-900 max-w-[120px] truncate">
            {user.email}
          </span>
          <div className="flex items-center gap-1.5">
            {isPro ? (
              <span className="text-[10px] bg-gradient-to-r from-indigo-500 to-purple-600 text-white px-1.5 py-0.5 rounded font-bold shadow-sm">
                PRO
              </span>
            ) : (
              <span className="text-[10px] text-zinc-500 font-medium">
                免费版 · 剩余: {remainingQuota}
              </span>
            )}
          </div>
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`text-zinc-400 transition-transform duration-200 ${showMenu ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      {showMenu && (
        <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-xl border border-zinc-100 py-1.5 z-50 animate-in fade-in zoom-in-95 duration-200">
          <div className="px-3 py-2 border-b border-zinc-100 mb-1">
            <p className="text-xs text-zinc-500 mb-1">当前套餐</p>
            <div className="flex items-center justify-between">
              <span className={`text-sm font-bold ${isPro ? 'text-indigo-600' : 'text-zinc-700'}`}>
                {isPro ? 'Pro 专业版' : 'Free 免费版'}
              </span>
              {!isPro && (
                <button
                  onClick={() => {
                    setShowMenu(false);
                    onOpenPricing();
                  }}
                  className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full font-bold hover:bg-indigo-100 transition-colors"
                >
                  升级
                </button>
              )}
            </div>
          </div>

          <button
            onClick={() => {
              setShowMenu(false);
              onOpenProfile();
            }}
            className="w-full text-left px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
            用户中心
          </button>

          {!isPro && (
            <button
              onClick={() => {
                setShowMenu(false);
                onOpenPricing();
              }}
              className="w-full text-left px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900 transition-colors flex items-center gap-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a4.5 4.5 0 0 0-4.5 4.5v0A4.5 4.5 0 0 0 9.5 14H14.5a4.5 4.5 0 0 1 4.5 4.5v0a4.5 4.5 0 0 1-4.5 4.5H9"></path></svg>
              升级套餐
            </button>
          )}

          <div className="h-px bg-zinc-100 my-1"></div>

          <button
            onClick={() => {
              setShowMenu(false);
              logout();
            }}
            className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
