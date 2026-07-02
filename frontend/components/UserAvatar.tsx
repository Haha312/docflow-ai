import React from 'react';

export type AccountTone = 'admin' | 'paid' | 'free';

interface UserAvatarProps {
  tone: AccountTone;
  size?: 'sm' | 'lg';
  className?: string;
}

export function UserAvatar({ tone, size = 'sm', className = '' }: UserAvatarProps) {
  const sizeClass = size === 'lg' ? 'w-14 h-14' : 'w-8 h-8';
  const iconClass = size === 'lg' ? 'w-7 h-7' : 'w-4 h-4';
  const dotClass = size === 'lg' ? 'right-1 bottom-1 w-3 h-3' : 'right-0 bottom-0 w-2.5 h-2.5';

  return (
    <div
      className={`user-avatar relative ${sizeClass} rounded-full flex items-center justify-center ring-1 ${className}`}
      data-account-tone={tone}
      data-avatar-size={size}
    >
      <svg
        className={`user-avatar-icon ${iconClass}`}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle cx="12" cy="8.2" r="3.55" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M5.6 19.2c.75-3.25 3.1-5.05 6.4-5.05s5.65 1.8 6.4 5.05"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
      <span className={`user-status-dot absolute ${dotClass} rounded-full border-2`} />
    </div>
  );
}
