import React from 'react';
import { useTranslation } from 'react-i18next';
import { termSections } from '../pages/Terms';
import { privacySections } from '../pages/Privacy';

export type LegalType = 'terms' | 'privacy' | null;

interface LegalSection {
  title: string;
  paragraphs?: string[];
  items?: string[];
}

const TITLES: Record<'terms' | 'privacy', string> = {
  terms: 'DocFlow 用户协议',
  privacy: 'DocFlow 隐私与保密条款',
};

/**
 * 用户协议 / 隐私政策的「当场弹层」——通用做法:点击时浮层显示正文,不跳走,看完关闭继续注册。
 * 复用 /terms、/privacy 页面的同一份正文数据;配色走 --df-* 主题变量,与整站主题一致。
 */
export const LegalModal: React.FC<{ type: LegalType; onClose: () => void }> = ({ type, onClose }) => {
  const { t } = useTranslation();
  if (!type) return null;
  const sections = (type === 'terms' ? termSections : privacySections) as LegalSection[];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center px-4">
      <button
        type="button"
        aria-label={t('common.close', '关闭')}
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div
        className="relative z-10 w-full max-w-2xl max-h-[85vh] rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        style={{ background: 'var(--df-surface, #ffffff)', color: 'var(--df-text, #111827)', border: '1px solid var(--df-border, #e5e7eb)' }}
      >
        <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--df-border, #e5e7eb)' }}>
          <h2 className="text-base font-semibold" style={{ color: 'var(--df-text, #111827)' }}>{TITLES[type]}</h2>
          <button
            onClick={onClose}
            aria-label={t('common.close', '关闭')}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:opacity-70 transition-opacity"
            style={{ color: 'var(--df-text-muted, #6b7280)' }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto px-6 py-5 space-y-6 text-sm leading-7" style={{ color: 'var(--df-text-muted, #4b5563)' }}>
          {sections.map((section) => (
            <section key={section.title}>
              <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--df-text, #111827)' }}>{section.title}</h3>
              {section.paragraphs?.map((p) => (
                <p key={p} className="mt-2">{p}</p>
              ))}
              {section.items && (
                <ul className="mt-2 list-disc space-y-1.5 pl-5">
                  {section.items.map((it) => (
                    <li key={it}>{it}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};
