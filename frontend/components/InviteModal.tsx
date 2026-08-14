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
                        {/* 「已到账」是这里唯一的成果指标,给它品牌绿;另两个是陪衬,保持中性。
                            三个都一样重的话,用户第一眼不知道该看哪个。 */}
                        <div className="grid grid-cols-3 gap-2.5 mb-5">
                            {[
                                { label: '已邀请', value: String(data.invited), accent: false },
                                { label: '已到账', value: `${data.bonusQuota} 次`, accent: true },
                                { label: '还可得', value: `${data.remainingBonus} 次`, accent: false },
                            ].map(({ label, value, accent }) => (
                                <div key={label}
                                    className={`rounded-xl px-3 py-3 text-center ${accent ? 'bg-emerald-500/10 border border-emerald-500/25' : 'bg-white/[0.04] border border-transparent'}`}>
                                    <div className={`text-lg font-semibold tabular-nums ${accent ? 'text-emerald-400' : 'text-zinc-100'}`}>{value}</div>
                                    <div className="text-xs text-zinc-500 mt-0.5">{label}</div>
                                </div>
                            ))}
                        </div>

                        <label className="text-xs text-zinc-500">邀请链接</label>
                        <div className="mt-1.5 mb-4 flex gap-2">
                            <input readOnly value={data.link}
                                className="flex-1 min-w-0 rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2 text-sm text-zinc-300" />
                            <button onClick={() => copy(data.link, 'link')}
                                className="shrink-0 rounded-lg bg-emerald-500/90 hover:bg-emerald-500 px-3 py-2 text-sm font-medium text-black transition-colors">
                                {copied === 'link' ? '已复制' : '复制'}
                            </button>
                        </div>

                        <div className="flex items-baseline justify-between">
                            <label className="text-xs text-zinc-500">邀请码</label>
                            {/* 用法提示贴在它该出现的地方,不塞进底部规则里堆成一坨 */}
                            <span className="text-[11px] text-zinc-600">发不了链接的地方(抖音等)用它</span>
                        </div>
                        <div className="mt-1.5 mb-4 flex gap-2">
                            <input readOnly value={data.code}
                                className="flex-1 min-w-0 rounded-lg bg-white/[0.04] border border-white/10 px-3 py-2 text-sm tracking-[0.3em] text-zinc-200" />
                            <button onClick={() => copy(data.code, 'code')}
                                className="shrink-0 rounded-lg border border-white/15 px-3 py-2 text-sm text-zinc-300 hover:bg-white/[0.06] transition-colors">
                                {copied === 'code' ? '已复制' : '复制'}
                            </button>
                        </div>

                        {/* 规则只留「必须说、别处没说」的那一条:奖励是对方用起来才到账。
                            「各得 N 次」标题已写、「封顶」右上角卡片已表达,重复写只会把弹窗压垮。 */}
                        <p className="text-xs leading-relaxed text-zinc-500">
                            奖励在好友<span className="text-zinc-300">完成首次排版后</span>到账,不是注册就给;每人最多累计 {data.rules.maxBonusPerUser} 次。
                        </p>

                        {data.pending > 0 && (
                            <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-400/[0.07] border border-amber-400/20 px-3 py-2">
                                <svg className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-400/90" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                    <circle cx="12" cy="12" r="9" /><path d="M12 8v4l2.5 2.5" />
                                </svg>
                                <p className="text-xs leading-relaxed text-amber-200/80">
                                    {data.pending} 位好友已注册但还没用过,他们排版一次你就到账
                                </p>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};
