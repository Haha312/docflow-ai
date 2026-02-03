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
    return <div className="h-8 w-20 bg-gray-100 animate-pulse rounded-lg"></div>;
  }

  if (!isAuthenticated || !user) {
    return (
      <button
        onClick={onOpenAuth}
        className="text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
      >
        登录
      </button>
    );
  }

  const isPro = user.subscriptionStatus === 'PRO' || user.subscriptionStatus === 'TEAM';
  const tierLabel = user.subscriptionStatus === 'TEAM' ? 'Team' :
    user.subscriptionStatus === 'PRO' ? 'Pro' : 'Free';

  const getTierColor = (status: string) => {
    if (status === 'TEAM') return 'text-purple-600';
    if (status === 'PRO') return 'text-amber-600';
    return 'text-gray-400';
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="group flex items-center gap-3 pl-1 pr-3 py-1 bg-white hover:bg-gray-50 border border-transparent hover:border-gray-200 rounded-full transition-all duration-200 hover:shadow-sm"
      >
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-gray-700 to-black flex items-center justify-center text-white font-medium text-sm shadow-md ring-2 ring-white ring-offset-1 ring-offset-gray-50 group-hover:scale-105 transition-transform duration-200">
          {user.email.charAt(0).toUpperCase()}
        </div>
        <div className="hidden sm:flex flex-col items-start gap-0.5">
          <span className="text-xs font-semibold text-gray-700 max-w-[100px] truncate leading-none">
            {user.email.split('@')[0]}
          </span>
          <span className={`text-[10px] font-bold tracking-wide uppercase leading-none ${getTierColor(user.subscriptionStatus)}`}>
            {tierLabel}
          </span>
        </div>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`text-gray-400 transition-transform ${showMenu ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      {showMenu && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50">
          <div className="px-3 py-2 border-b border-gray-100">
            <p className="text-xs text-gray-500">{user.email}</p>
            <div className="flex items-center justify-between mt-1">
              <span className={`text-sm font-bold ${getTierColor(user.subscriptionStatus)}`}>
                {tierLabel}
              </span>
              {!isPro && (
                <span className="text-xs text-gray-400">剩余: {remainingQuota}</span>
              )}
            </div>
          </div>

          <button
            onClick={() => { setShowMenu(false); onOpenProfile(); }}
            className="w-full text-left px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            用户中心
          </button>

          {!isPro && (
            <button
              onClick={() => { setShowMenu(false); onOpenPricing(); }}
              className="w-full text-left px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
              升级套餐
            </button>
          )}

          <div className="h-px bg-gray-100 my-1"></div>

          <button
            onClick={() => { setShowMenu(false); logout(); }}
            className="w-full text-left px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors flex items-center gap-2"
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
    </div>
  );
}
