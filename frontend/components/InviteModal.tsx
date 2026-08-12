import React, { useEffect, useState } from 'react';
import { authService } from '../services/authService';

interface ReferralData {
    code: string;
    link: string;
    bonusQuota: number;
    invited: number;
    rewarded: number;
    pending: number;
    remainingBonus: number;
    rules: { bonus: number; maxBonusPerUser: number; minChars: number };
}

interface Props {
    open: boolean;
    onClose: () => void;
    /** 未登录时点邀请 → 先去登录 */
    onRequireLogin: () => void;
    isAuthenticated: boolean;
}

/**
 * 邀请弹窗。规则要写清楚 —— 尤其「对方用起来之后才到账」这条:
 * 不写明的话,用户拉了人却没立刻加次数,会以为是产品坏了。
 */
export const InviteModal: React.FC<Props> = ({ open, onClose, onRequireLogin, isAuthenticated }) => {
    const [data, setData] = useState<ReferralData | null>(null);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState<'link' | 'code' | null>(null);

    useEffect(() => {
        if (!open) return;
        if (!isAuthenticated) { onRequireLogin(); return; }
        let cancelled = false;
        setError('');
        authService.getReferral()
            .then((d) => { if (!cancelled) setData(d as ReferralData); })
            .catch((e) => { if (!cancelled) setError(e.message || '读取邀请数据失败'); });
        return () => { cancelled = true; };
    }, [open, isAuthenticated, onRequireLogin]);

    if (!open) return null;

    const copy = async (text: string, which: 'link' | 'code') => {
        try {
            await navigator.clipboard.writeText(text);
        } catch {
            // 非 https 或旧浏览器下 clipboard 不可用,退回选中文本让用户手动复制
            const el = document.createElement('textarea');
            el.value = text; document.body.appendChild(el); el.select();
            document.execCommand('copy'); el.remove();
        }
        setCopied(which);
        setTimeout(() => setCopied(null), 1800);
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
            onClick={onClose}>
            <div className="w-full max-w-md rounded-2xl bg-[#111111] border border-white/10 p-6 shadow-2xl"
                onClick={(e) => e.stopPropagation()}>
                <div className="flex items-start justify-between mb-5">
                    <div>
                        <h3 className="text-lg font-semibold text-zinc-100">邀请好友</h3>
                        <p className="text-sm text-zinc-500 mt-1">
                            {data ? `好友用起来之后，双方各得 ${data.rules.bonus} 次` : ' '}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 text-xl leading-none">×</button>
                </div>

                {error && <p className="text-sm text-red-400 mb-4">{error}</p>}
                {!data && !error && <p className="text-sm text-zinc-500">加载中…</p>}

                {data && (
                    <>
                        <div className="grid grid-cols-3 gap-3 mb-5">
                            {[
                                ['已邀请', data.invited],
                                ['已到账', `${data.bonusQuota} 次`],
                                ['还可得', `${data.remainingBonus} 次`],
                            ].map(([label, value]) => (
                                <div key={label as string} className="rounded-xl bg-white/[0.04] px-3 py-3 text-center">
                                    <div className="text-lg font-semibold text-zinc-100">{value}</div>
                                    <div className="text-xs text-zinc-500 mt-0.5">{label}</div>
                                </div>
                            ))}
                        </div>

                        <label className="text-xs text-zinc-500">邀请链接</label>
                        <div className="mt-1.5 mb-3 flex gap-2">
                            <input readOnly value={data.link}
                                className="flex-1 min-w-0 rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2 text-sm text-zinc-300" />
                            <button onClick={() => copy(data.link, 'link')}
                                className="shrink-0 rounded-lg bg-emerald-500/90 hover:bg-emerald-500 px-3 py-2 text-sm font-medium text-black transition-colors">
                                {copied === 'link' ? '已复制' : '复制'}
                            </button>
                        </div>

                        <label className="text-xs text-zinc-500">邀请码</label>
                        <div className="mt-1.5 mb-5 flex gap-2">
                            <input readOnly value={data.code}
                                className="flex-1 min-w-0 rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2 text-sm tracking-[0.3em] text-zinc-200" />
                            <button onClick={() => copy(data.code, 'code')}
                                className="shrink-0 rounded-lg border border-white/15 px-3 py-2 text-sm text-zinc-300 hover:bg-white/[0.06] transition-colors">
                                {copied === 'code' ? '已复制' : '复制'}
                            </button>
                        </div>

                        <div className="rounded-xl bg-white/[0.03] px-4 py-3 text-xs leading-relaxed text-zinc-500">
                            <p className="text-zinc-400 mb-1.5">规则</p>
                            <p>· 好友通过你的链接注册,并完成一次排版后,双方各得 {data.rules.bonus} 次。</p>
                            <p>· 奖励在对方<span className="text-zinc-400">真正用起来之后</span>到账,不是注册就给。</p>
                            <p>· 每人最多通过邀请获得 {data.rules.maxBonusPerUser} 次。</p>
                            {data.pending > 0 && (
                                <p className="mt-1.5 text-amber-400/80">
                                    有 {data.pending} 位好友已注册但还没用过,他们完成一次排版后你就会到账。
                                </p>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};
