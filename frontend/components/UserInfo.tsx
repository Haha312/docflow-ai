import React, { useState, useRef, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';
import { AccountTone, UserAvatar } from './UserAvatar';

interface UserInfoProps {
  onOpenPricing: () => void;
  onOpenAuth: () => void;
  onOpenProfile: () => void;
  onOpenAdmin?: () => void;
  themeMode: 'dark' | 'light' | 'blueviolet' | 'green' | 'coral';
  onThemeChange: (theme: 'dark' | 'light' | 'blueviolet' | 'green' | 'coral') => void;
}

export function UserInfo({ onOpenPricing, onOpenAuth, onOpenProfile, onOpenAdmin, themeMode, onThemeChange }: UserInfoProps) {
  const { user, isAuthenticated, isLoading, remainingQuota, logout } = useAuth();
  const { t, i18n } = useTranslation();
  const [showMenu, setShowMenu] = useState(false);
  const [showThemePicker, setShowThemePicker] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const toggleLanguage = () => {
    const nextLang = i18n.language === 'zh' ? 'en' : 'zh';
    i18n.changeLanguage(nextLang);
    setShowMenu(false);
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
        setShowThemePicker(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (isLoading) {
    return <div className="h-8 w-20 bg-white/10 animate-pulse rounded-full"></div>;
  }

  if (!isAuthenticated || !user) {
    return (
      <button
        onClick={onOpenAuth}
        className="text-sm font-medium text-zinc-400 hover:text-zinc-100 transition-colors"
      >
        {t('nav.login')}
      </button>
    );
  }

  const isAdmin = Boolean(user.isAdmin);
  const isPro = user.subscriptionStatus !== 'FREE';
  const tierQuotaTotal = user.subscriptionStatus === 'ULTRA' ? 1000 :
    user.subscriptionStatus === 'PRO' ? 200 :
      user.subscriptionStatus === 'PLUS' ? 50 : 3;
  const tierLabel = isAdmin ? 'Admin' :
    user.subscriptionStatus === 'ULTRA' ? 'Ultra' :
    user.subscriptionStatus === 'PRO' ? 'Pro' :
      user.subscriptionStatus === 'PLUS' ? 'Plus' : 'Free';
  const accountTone: AccountTone = isAdmin ? 'admin' : isPro ? 'paid' : 'free';
  const themeOptions: { id: 'dark' | 'light' | 'blueviolet' | 'green' | 'coral'; label: string; dot: string }[] = [
    { id: 'dark', label: t('nav.theme_dark', '黑色'), dot: 'bg-zinc-950' },
    { id: 'light', label: t('nav.theme_light', '白色'), dot: 'bg-zinc-100' },
    { id: 'blueviolet', label: t('nav.theme_blueviolet', '蓝紫'), dot: 'bg-gradient-to-br from-sky-300 via-indigo-400 to-violet-400' },
    { id: 'green', label: t('nav.theme_green', '青绿'), dot: 'bg-gradient-to-br from-emerald-300 via-teal-400 to-cyan-300' },
    { id: 'coral', label: t('nav.theme_coral', '珊瑚'), dot: 'bg-gradient-to-br from-orange-300 via-rose-300 to-pink-300' },
  ];

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => {
          setShowMenu(!showMenu);
          if (showMenu) setShowThemePicker(false);
        }}
        className="group flex items-center gap-2.5 pl-1 pr-3 py-1 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-full transition-all duration-200"
      >
        <UserAvatar tone={accountTone} size="sm" className="group-hover:scale-[1.03] transition-transform duration-200" />
        <div className="hidden sm:flex flex-col items-start gap-0.5">
          <span className="text-xs font-semibold text-zinc-200 max-w-[100px] truncate leading-none">
            {user.phone ? `${user.phone.slice(0, 3)}****${user.phone.slice(-4)}` : (user.email?.split('@')[0] || t('nav.user', '用户'))}
          </span>
          <span className="user-tier-label text-[10px] font-bold tracking-wide uppercase leading-none" data-account-tone={accountTone}>
            {tierLabel}
          </span>
        </div>
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`text-zinc-500 transition-transform ${showMenu ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      {showMenu && (
        <div className="absolute right-0 top-full mt-2 w-52 bg-[#111111] rounded-xl shadow-2xl border border-white/10 py-1 z-50">
          <div className="px-3 py-2 border-b border-white/10">
            <p className="text-xs text-zinc-500">{user.phone ? `${user.phone.slice(0, 3)}****${user.phone.slice(-4)}` : user.email}</p>
            <div className="flex items-center justify-between mt-1">
              <span className="user-tier-label text-sm font-bold" data-account-tone={accountTone}>
                {tierLabel}
              </span>
              {isAdmin ? (
                <span className="text-xs text-zinc-500">{t('nav.quota_unlimited', '不限次数')}</span>
              ) : isPro ? (
                <span className="text-xs text-zinc-500">{t('nav.period_remaining_of', { count: remainingQuota, total: tierQuotaTotal })}</span>
              ) : (
                <span className="text-xs text-zinc-500">{t('nav.free_remaining', { count: remainingQuota })}</span>
              )}
            </div>
          </div>

          <button
            onClick={() => { setShowMenu(false); onOpenProfile(); }}
            className="w-full text-left px-3 py-2 text-sm text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
              <circle cx="12" cy="7" r="4"></circle>
            </svg>
            {t('nav.profile')}
          </button>

          <button
            onClick={() => { setShowMenu(false); onOpenPricing(); }}
            className="w-full text-left px-3 py-2 text-sm text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            {t('nav.upgrade')}
          </button>

          {user.isAdmin && (
            <button
              onClick={() => { setShowMenu(false); onOpenAdmin && onOpenAdmin(); }}
              className="w-full text-left px-3 py-2 text-sm text-purple-200 hover:bg-purple-400/10 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="3" y1="9" x2="21" y2="9"></line>
                <line x1="9" y1="21" x2="9" y2="9"></line>
              </svg>
              {t('nav.dashboard')}
            </button>
          )}

          <div className="h-px bg-white/10 my-1"></div>

          <div>
            <button
              type="button"
              onClick={() => setShowThemePicker(!showThemePicker)}
              className="w-full text-left px-3 py-2 text-sm text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="4"></circle>
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path>
              </svg>
              <span className="flex-1">{t('nav.appearance', '外观主题')}</span>
              <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500">
                <span className={`h-2.5 w-2.5 rounded-full border border-white/20 ${themeOptions.find(option => option.id === themeMode)?.dot}`} />
                {themeOptions.find(option => option.id === themeMode)?.label}
              </span>
              <svg className={`w-3 h-3 text-zinc-600 transition-transform ${showThemePicker ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </button>

            {showThemePicker && (
              <div className="theme-switcher px-3 pb-2">
                <div className="flex items-center justify-between rounded-lg bg-white/[0.03] px-2 py-2">
                  {themeOptions.map(option => {
                    const active = themeMode === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => onThemeChange(option.id)}
                        aria-pressed={active}
                        title={option.label}
                        className={`h-7 w-7 rounded-full flex items-center justify-center transition-colors ${active ? 'bg-white text-black' : 'hover:bg-white/[0.08]'}`}
                      >
                        <span className={`h-3 w-3 rounded-full border ${active ? 'border-black/20' : 'border-white/20'} ${option.dot}`} />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="h-px bg-white/10 my-1"></div>

          <button
            onClick={toggleLanguage}
            className="w-full text-left px-3 py-2 text-sm text-zinc-400 hover:bg-white/[0.08] hover:text-zinc-100 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="2" y1="12" x2="22" y2="12"></line>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
            </svg>
            {t('nav.switch_lang')}
          </button>

          <button
            onClick={() => { setShowMenu(false); logout(); }}
            className="w-full text-left px-3 py-2 text-sm text-red-300 hover:bg-red-400/10 transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
            {t('nav.logout')}
          </button>
        </div>
      )}
    </div>
  );
}
