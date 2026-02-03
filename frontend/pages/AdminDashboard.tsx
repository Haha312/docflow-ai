
import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/authService';
import { useNavigate } from 'react-router-dom';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Area, AreaChart } from 'recharts';

interface DailyData {
    date: string;
    dateLabel: string;
    tokens: number;
    calls: number;
}

interface PresetStat {
    preset: string;
    count: number;
    tokens: number;
}

interface UsageLog {
    id: string;
    actionType: string;
    presetUsed: string;
    tokenUsage: number | null;
    createdAt: string;
    user: { email: string; subscriptionStatus: string };
}

interface AdminStats {
    today: { tokens: number; calls: number; activeUsers: number };
    total: { tokens: number; calls: number };
    dailyHistory: DailyData[];
    presetStats: PresetStat[];
    recentLogs: UsageLog[];
}

const ADMIN_EMAIL = 'admin@docuflow.ai';

const PRESET_NAMES: Record<string, string> = {
    'academic': '学术论文',
    'official': '公文报告',
    'technical': '技术文档',
    'proposal': '投标方案',
    'journal': '期刊论文',
    'custom': '自定义'
};

const TIER_NAMES: Record<string, string> = {
    'FREE': '免费',
    'PRO': 'Pro',
    'TEAM': '团队版'
};

// 图标组件
const UsageIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" />
        <path d="M18 17V9" />
        <path d="M13 17V5" />
        <path d="M8 17v-3" />
    </svg>
);

const LogsIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
    </svg>
);

const SettingsIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
);

const BackIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 12H5M12 19l-7-7 7-7" />
    </svg>
);

export const AdminDashboard: React.FC = () => {
    const { user, isAuthenticated, isLoading } = useAuth();
    const navigate = useNavigate();

    const [stats, setStats] = useState<AdminStats | null>(null);
    const [configs, setConfigs] = useState<Record<string, string>>({});
    const [statusMsg, setStatusMsg] = useState('');
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState<'usage' | 'logs' | 'settings'>('usage');

    useEffect(() => {
        if (!isLoading) {
            if (!isAuthenticated || user?.email !== ADMIN_EMAIL) {
                navigate('/');
            } else {
                fetchData();
            }
        }
    }, [isAuthenticated, user, isLoading, navigate]);

    const fetchData = async () => {
        try {
            const token = authService.getToken();
            const headers = { 'Authorization': `Bearer ${token}` };

            const statsRes = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/admin/stats`, { headers });
            if (statsRes.ok) setStats(await statsRes.json());

            const configRes = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/admin/config`, { headers });
            if (configRes.ok) setConfigs(await configRes.json());

            setLoading(false);
        } catch (err) {
            console.error(err);
            setLoading(false);
        }
    };

    const handleConfigSave = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const token = authService.getToken();
            const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/admin/config`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ configs })
            });
            if (res.ok) {
                setStatusMsg('已保存');
                setTimeout(() => setStatusMsg(''), 2000);
            } else {
                setStatusMsg('保存失败');
            }
        } catch (err) {
            setStatusMsg('保存出错');
        }
    };

    const formatNumber = (num: number) => {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toLocaleString();
    };

    const formatTime = (isoString: string) => {
        const date = new Date(isoString);
        return date.toLocaleString('zh-CN', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    if (isLoading || loading) {
        return (
            <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
            </div>
        );
    }

    const configItems = [
        { key: 'GEMINI_OPENAI_BASE_URL', label: 'API Base URL' },
        { key: 'GOOGLE_API_KEY', label: 'Google API Key' }
    ];

    const weekTotal = stats?.dailyHistory.reduce((a, b) => a + b.tokens, 0) || 0;

    const navItems = [
        { key: 'usage', label: 'Usage', Icon: UsageIcon },
        { key: 'logs', label: 'Logs', Icon: LogsIcon },
        { key: 'settings', label: 'Settings', Icon: SettingsIcon }
    ];

    return (
        <div className="min-h-screen bg-[#0a0a0a] text-white">
            {/* 侧边导航 */}
            <div className="fixed left-0 top-0 bottom-0 w-56 bg-[#0a0a0a] border-r border-white/[0.08] flex flex-col">
                {/* Logo */}
                <div className="px-5 py-6">
                    <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-white flex items-center justify-center">
                            <span className="text-black text-xs font-bold">D</span>
                        </div>
                        <span className="text-[15px] font-semibold text-white">DocFlow AI</span>
                    </div>
                </div>

                {/* 导航菜单 */}
                <nav className="flex-1 px-3 py-2">
                    <div className="space-y-0.5">
                        {navItems.map(item => (
                            <button
                                key={item.key}
                                onClick={() => setActiveTab(item.key as any)}
                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${activeTab === item.key
                                    ? 'bg-white/[0.08] text-white'
                                    : 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]'
                                    }`}
                            >
                                <item.Icon />
                                {item.label}
                            </button>
                        ))}
                    </div>
                </nav>

                {/* 底部 */}
                <div className="px-3 py-4 border-t border-white/[0.08]">
                    <button
                        onClick={() => navigate('/')}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] font-medium text-white/50 hover:text-white/80 hover:bg-white/[0.04] transition-colors"
                    >
                        <BackIcon />
                        返回应用
                    </button>
                </div>
            </div>

            {/* 主内容区 */}
            <div className="ml-56">
                <div className="max-w-5xl mx-auto px-8 py-10">

                    {/* Usage Tab */}
                    {activeTab === 'usage' && (
                        <div className="space-y-8">
                            <div>
                                <h1 className="text-2xl font-semibold text-white">Gemini API 使用统计</h1>
                                <p className="text-sm text-white/40 mt-1">Token 消耗与调用统计（gemini-3-pro-preview）</p>
                            </div>

                            {/* 统计卡片 */}
                            <div className="grid grid-cols-4 gap-4">
                                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                                    <p className="text-xs text-white/40 font-medium uppercase tracking-wide">今日消耗</p>
                                    <p className="text-3xl font-semibold text-white mt-2">{formatNumber(stats?.today.tokens || 0)}</p>
                                    <p className="text-xs text-white/30 mt-1">{stats?.today.calls || 0} 次调用</p>
                                </div>
                                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                                    <p className="text-xs text-white/40 font-medium uppercase tracking-wide">活跃用户</p>
                                    <p className="text-3xl font-semibold text-white mt-2">{stats?.today.activeUsers || 0}</p>
                                    <p className="text-xs text-white/30 mt-1">今日</p>
                                </div>
                                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                                    <p className="text-xs text-white/40 font-medium uppercase tracking-wide">近7日</p>
                                    <p className="text-3xl font-semibold text-white mt-2">{formatNumber(weekTotal)}</p>
                                    <p className="text-xs text-white/30 mt-1">tokens</p>
                                </div>
                                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                                    <p className="text-xs text-white/40 font-medium uppercase tracking-wide">累计总量</p>
                                    <p className="text-3xl font-semibold text-white mt-2">{formatNumber(stats?.total.tokens || 0)}</p>
                                    <p className="text-xs text-white/30 mt-1">{formatNumber(stats?.total.calls || 0)} 调用</p>
                                </div>
                            </div>

                            {/* 图表 */}
                            <div className="grid grid-cols-2 gap-6">
                                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-6">
                                    <div className="flex items-center justify-between mb-6">
                                        <h3 className="text-sm font-medium text-white">Token 消耗趋势</h3>
                                        <span className="text-xs text-white/30">近 7 天</span>
                                    </div>
                                    <div className="h-56">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={stats?.dailyHistory || []}>
                                                <defs>
                                                    <linearGradient id="tokenGrad" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="0%" stopColor="#fff" stopOpacity={0.15} />
                                                        <stop offset="100%" stopColor="#fff" stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                                <XAxis dataKey="dateLabel" stroke="rgba(255,255,255,0.2)" fontSize={11} tickLine={false} axisLine={false} />
                                                <YAxis stroke="rgba(255,255,255,0.2)" fontSize={11} tickFormatter={formatNumber} tickLine={false} axisLine={false} width={45} />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px' }}
                                                    labelStyle={{ color: 'rgba(255,255,255,0.5)' }}
                                                    itemStyle={{ color: '#fff' }}
                                                    formatter={(value: number) => [formatNumber(value), 'Tokens']}
                                                />
                                                <Area type="monotone" dataKey="tokens" stroke="rgba(255,255,255,0.6)" strokeWidth={2} fill="url(#tokenGrad)" />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-6">
                                    <div className="flex items-center justify-between mb-6">
                                        <h3 className="text-sm font-medium text-white">API 调用次数</h3>
                                        <span className="text-xs text-white/30">近 7 天</span>
                                    </div>
                                    <div className="h-56">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={stats?.dailyHistory || []} barCategoryGap="25%">
                                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                                <XAxis dataKey="dateLabel" stroke="rgba(255,255,255,0.2)" fontSize={11} tickLine={false} axisLine={false} />
                                                <YAxis stroke="rgba(255,255,255,0.2)" fontSize={11} tickLine={false} axisLine={false} width={30} />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px' }}
                                                    labelStyle={{ color: 'rgba(255,255,255,0.5)' }}
                                                    itemStyle={{ color: '#fff' }}
                                                    formatter={(value: number) => [value, '调用']}
                                                />
                                                <Bar dataKey="calls" fill="rgba(255,255,255,0.25)" radius={[4, 4, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>

                            {/* 预设使用 */}
                            {stats?.presetStats && stats.presetStats.length > 0 && (
                                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-6">
                                    <h3 className="text-sm font-medium text-white mb-5">模板使用分布</h3>
                                    <div className="grid grid-cols-6 gap-3">
                                        {stats.presetStats.map(p => (
                                            <div key={p.preset} className="text-center py-4 px-3 bg-white/[0.03] rounded-lg">
                                                <p className="text-2xl font-semibold text-white">{p.count}</p>
                                                <p className="text-xs text-white/40 mt-1">{PRESET_NAMES[p.preset] || p.preset}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Logs Tab */}
                    {activeTab === 'logs' && (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h1 className="text-2xl font-semibold text-white">Logs</h1>
                                    <p className="text-sm text-white/40 mt-1">最近 50 条使用记录</p>
                                </div>
                                <button
                                    onClick={fetchData}
                                    className="text-xs text-white/40 hover:text-white/60 transition-colors"
                                >
                                    刷新
                                </button>
                            </div>

                            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-white/[0.06]">
                                            <th className="px-5 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wide">时间</th>
                                            <th className="px-5 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wide">用户</th>
                                            <th className="px-5 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wide">等级</th>
                                            <th className="px-5 py-3 text-left text-xs font-medium text-white/40 uppercase tracking-wide">模板</th>
                                            <th className="px-5 py-3 text-right text-xs font-medium text-white/40 uppercase tracking-wide">Tokens</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/[0.04]">
                                        {stats?.recentLogs.map(log => (
                                            <tr key={log.id} className="hover:bg-white/[0.02]">
                                                <td className="px-5 py-3 text-sm text-white/60">{formatTime(log.createdAt)}</td>
                                                <td className="px-5 py-3 text-sm text-white font-medium">{log.user.email}</td>
                                                <td className="px-5 py-3">
                                                    <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded ${log.user.subscriptionStatus === 'TEAM' ? 'bg-purple-500/20 text-purple-400' :
                                                        log.user.subscriptionStatus === 'PRO' ? 'bg-blue-500/20 text-blue-400' :
                                                            'bg-white/10 text-white/50'
                                                        }`}>
                                                        {TIER_NAMES[log.user.subscriptionStatus] || log.user.subscriptionStatus}
                                                    </span>
                                                </td>
                                                <td className="px-5 py-3 text-sm text-white/60">{PRESET_NAMES[log.presetUsed] || log.presetUsed}</td>
                                                <td className="px-5 py-3 text-sm text-white/80 text-right font-mono">{log.tokenUsage ? formatNumber(log.tokenUsage) : '-'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {(!stats?.recentLogs || stats.recentLogs.length === 0) && (
                                    <div className="py-16 text-center text-white/30 text-sm">暂无记录</div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Settings Tab */}
                    {activeTab === 'settings' && (
                        <div className="space-y-6">
                            <div>
                                <h1 className="text-2xl font-semibold text-white">Settings</h1>
                                <p className="text-sm text-white/40 mt-1">API 密钥配置，修改后立即生效</p>
                            </div>

                            <form onSubmit={handleConfigSave} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-6">
                                <div className="space-y-5">
                                    {configItems.map(({ key, label }) => (
                                        <div key={key}>
                                            <label className="block text-xs font-medium text-white/50 mb-2">{label}</label>
                                            <input
                                                type="text"
                                                value={configs[key] || ''}
                                                onChange={e => setConfigs({ ...configs, [key]: e.target.value })}
                                                placeholder={`Enter ${label}...`}
                                                className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors font-mono"
                                            />
                                        </div>
                                    ))}
                                </div>

                                <div className="mt-6 pt-5 border-t border-white/[0.06] flex items-center justify-between">
                                    {statusMsg && (
                                        <span className={`text-sm ${statusMsg === '已保存' ? 'text-green-400' : 'text-red-400'}`}>{statusMsg}</span>
                                    )}
                                    <button
                                        type="submit"
                                        className="ml-auto bg-white text-black px-5 py-2 rounded-lg text-sm font-medium hover:bg-white/90 transition-colors"
                                    >
                                        保存配置
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
