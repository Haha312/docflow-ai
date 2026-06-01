import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

export function NotFound() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-zinc-50 flex flex-col items-center justify-center px-4 text-center">
      {/* 大数字 */}
      <div className="text-[120px] font-black text-zinc-200 leading-none select-none">404</div>

      {/* 图标 */}
      <div className="w-16 h-16 bg-zinc-100 rounded-2xl flex items-center justify-center -mt-4 mb-6">
        <svg className="w-8 h-8 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="9" y1="15" x2="15" y2="15" />
        </svg>
      </div>

      <h1 className="text-2xl font-bold text-zinc-900 mb-2">
        {t('not_found.title', '页面不存在')}
      </h1>
      <p className="text-sm text-zinc-500 mb-8 max-w-xs">
        {t('not_found.desc', '你访问的页面已被移动、删除或从未存在过。')}
      </p>

      <div className="flex gap-3">
        <button
          onClick={() => navigate(-1)}
          className="px-5 py-2.5 bg-white border border-zinc-200 text-zinc-700 text-sm font-medium rounded-xl hover:bg-zinc-50 transition-colors"
        >
          {t('not_found.go_back', '返回上页')}
        </button>
        <Link
          to="/"
          className="px-5 py-2.5 bg-zinc-900 text-white text-sm font-medium rounded-xl hover:bg-zinc-800 transition-colors"
        >
          {t('not_found.go_home', '回到首页')}
        </Link>
      </div>
    </div>
  );
}

export default NotFound;
