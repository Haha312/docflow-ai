
import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/authService';
import { useNavigate } from 'react-router-dom';
import { XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Area, AreaChart } from 'recharts';
import { useTranslation } from 'react-i18next';

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

interface UserData {
    id: string;
    email: string;
    subscriptionStatus: string;
    subscriptionEndDate: string | null;
    createdAt: string;
    usageCount: number;
}

interface AdminStats {
    today: { tokens: number; calls: number; activeUsers: number };
    total: { tokens: number; calls: number };
    dailyHistory: DailyData[];
    presetStats: PresetStat[];
}

const ADMIN_EMAIL = 'admin@docuflow.ai';

// Translating dynamically inside the component is better because PRESET_NAMES and TIER_LABELS
// are used directly from constants. We'll change these to functions or inline maps depending on use.
// But since they are outside, we can just use `t` where they are referenced, or map them inside.
const getPresetName = (key: string, t: any) => {
    const keys: any = {
        'academic': 'home.preset_academic',
        'corporate': 'home.preset_corporate',
        'academic_journal': 'home.preset_academic_journal',
        'creative': 'home.preset_creative',
        'minimalist': 'home.preset_minimalist',
        'custom': 'admin.preset_custom'
    };
    return keys[key] ? t(keys[key]) : key;
};

const getTierLabel = (key: string, t: any) => {
    const keys: any = {
        'FREE': 'admin.tier_free',
        'PLUS': 'PLUS',
        'PRO': 'PRO',
        'ULTRA': 'ULTRA'
    };
    return keys[key] ? (keys[key].includes('admin.') ? t(keys[key]) : keys[key]) : key;
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

const UsersIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
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

interface AdminDashboardProps {
    onClose?: () => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onClose }) => {
    const { user, isAuthenticated, isLoading } = useAuth();
    const navigate = useNavigate();
    const { t } = useTranslation();

    const [activeTab, setActiveTab] = useState<'usage' | 'logs' | 'users' | 'settings'>('usage');
    const [stats, setStats] = useState<AdminStats | null>(null);
    const [configs, setConfigs] = useState<Record<string, string>>({});
    const [statusMsg, setStatusMsg] = useState('');
    const [loading, setLoading] = useState(true);
    const [daysFilter, setDaysFilter] = useState<number>(7);

    // Logs pagination
    const [logs, setLogs] = useState<UsageLog[]>([]);
    const [logsPage, setLogsPage] = useState(1);
    const [logsTotalPages, setLogsTotalPages] = useState(1);
    const [logsLoading, setLogsLoading] = useState(false);

    // Users pagination and search
    const [users, setUsers] = useState<UserData[]>([]);
    const [usersPage, setUsersPage] = useState(1);
    const [usersTotalPages, setUsersTotalPages] = useState(1);
    const [searchQuery, setSearchQuery] = useState('');
    const [usersLoading, setUsersLoading] = useState(false);

    // Edit user modal
    const [editingUser, setEditingUser] = useState<UserData | null>(null);
    const [editStatus, setEditStatus] = useState<string>('FREE');
    const [editDays, setEditDays] = useState<number>(0);
    const [editSaveResult, setEditSaveResult] = useState<'success' | 'error' | null>(null);
    const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (!isLoading) {
            if (!isAuthenticated || user?.email?.toLowerCase() !== ADMIN_EMAIL) {
                if (onClose) onClose();
                else navigate('/');
            } else {
                fetchStats();
                fetchConfigs();
            }
        }
    }, [isAuthenticated, user, isLoading, navigate, daysFilter]);

    useEffect(() => {
        if (activeTab === 'logs') {
            fetchLogs();
        } else if (activeTab === 'users') {
            fetchUsers();
        }
    }, [activeTab, logsPage, usersPage]);

    const fetchStats = async () => {
        try {
            const token = authService.getToken();
            const headers = { 'Authorization': `Bearer ${token}` };
            const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/admin/stats?days=${daysFilter}`, { headers });
            if (res.ok) setStats(await res.json());
            setLoading(false);
        } catch (err) {
            console.error(err);
            setLoading(false);
        }
    };

    const fetchConfigs = async () => {
        try {
            const token = authService.getToken();
            const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/admin/config`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) setConfigs(await res.json());
        } catch (err) {
            console.error(err);
        }
    };

    const fetchLogs = async () => {
        setLogsLoading(true);
        try {
            const token = authService.getToken();
            const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/admin/logs?page=${logsPage}&limit=15`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                const data = await res.json();
                setLogs(data.data);
                setLogsTotalPages(data.pagination.totalPages);
            }
        } catch (err) {
            console.error(err);
        }
        setLogsLoading(false);
    };

    const fetchUsers = async () => {
        setUsersLoading(true);
        try {
            const token = authService.getToken();
            const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/admin/users?page=${usersPage}&limit=15&search=${searchQuery}`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                const data = await res.json();
                setUsers(data.data);
                setUsersTotalPages(data.pagination.totalPages);
            }
        } catch (err) {
            console.error(err);
        }
        setUsersLoading(false);
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setUsersPage(1);
        fetchUsers();
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
                setStatusMsg(t('admin.saved'));
                setTimeout(() => setStatusMsg(''), 2000);
            } else {
                setStatusMsg(t('admin.save_failed'));
            }
        } catch (err) {
            setStatusMsg(t('admin.save_error'));
        }
    };

    const saveUserEdit = async () => {
        if (!editingUser) return;
        try {
            const token = authService.getToken();
            const res = await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3001'}/api/admin/users/${editingUser.id}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    subscriptionStatus: editStatus,
                    additionalDays: editDays !== 0 ? editDays : undefined
                })
            });
            if (res.ok) {
                setEditSaveResult('success');
                fetchUsers();
                setTimeout(() => {
                    setEditingUser(null);
                    setEditSaveResult(null);
                }, 1200);
            } else {
                setEditSaveResult('error');
            }
        } catch (err) {
            console.error(err);
            setEditSaveResult('error');
        }
    };

    const formatNumber = (num: number) => {
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

    const formatDateOnly = (isoString?: string | null) => {
        if (!isoString) return '-';
        const date = new Date(isoString);
        return date.toLocaleDateString('zh-CN');
    };

    if (isLoading || loading) {
        return (
            <div className={`min-h-screen bg-[#0a0a0a] flex items-center justify-center ${onClose ? 'fixed inset-0 z-[100]' : ''}`}>
                <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
            </div>
        );
    }

    const configItems = [
        { key: 'GEMINI_OPENAI_BASE_URL', label: 'Gemini API Base URL' },
        { key: 'GOOGLE_API_KEY', label: 'Google / Gemini API Key' },
        { key: 'DEEPSEEK_API_KEY', label: 'DeepSeek API Key' },
        { key: 'DOUBAO_API_KEY', label: 'Doubao (Ark) API Key' },
        { key: 'DOUBAO_ENDPOINT_ID', label: 'Doubao Endpoint ID' },
        { key: 'DASHSCOPE_API_KEY', label: 'Qwen (DashScope) API Key' },
    ];

    const periodTotalTokens = stats?.dailyHistory.reduce((a, b) => a + b.tokens, 0) || 0;
    const periodTotalCalls = stats?.dailyHistory.reduce((a, b) => a + b.calls, 0) || 0;

    const navItems = [
        { key: 'usage', label: t('admin.tab_usage'), Icon: UsageIcon },
        { key: 'logs', label: t('admin.tab_logs'), Icon: LogsIcon },
        { key: 'users', label: t('admin.tab_users'), Icon: UsersIcon },
        { key: 'settings', label: t('admin.tab_settings'), Icon: SettingsIcon }
    ];

    return (
        <div className={`bg-[#0a0a0a] text-white ${onClose ? 'fixed inset-0 z-[100] overflow-y-auto' : 'min-h-screen'}`}>
            {/* 侧边导航 */}
            <div className="fixed left-0 top-0 bottom-0 w-60 bg-[#0a0a0a] border-r border-white/[0.08] flex flex-col z-[101]">
                {/* Logo */}
                <div className="px-5 py-6">
                    <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-white flex items-center justify-center">
                            <span className="text-black text-xs font-bold">D</span>
                        </div>
                        <span className="text-[15px] font-semibold text-white">{t('admin.title')}</span>
                    </div>
                </div>

                {/* 导航菜单 */}
                <nav className="flex-1 px-3 py-2">
                    <div className="space-y-1">
                        {navItems.map(item => (
                            <button
                                key={item.key}
                                onClick={() => setActiveTab(item.key as any)}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === item.key
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
                        onClick={() => {
                            if (onClose) onClose();
                            else navigate('/');
                        }}
                        className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium text-white/50 hover:text-white/80 hover:bg-white/[0.04] transition-colors"
                    >
                        <BackIcon />
                        {t('admin.back_to_app')}
                    </button>
                </div>
            </div>

            {/* 主内容区 */}
            <div className="ml-60">
                <div className="max-w-6xl mx-auto px-8 py-10">

                    {/* =========== Usage Tab =========== */}
                    {activeTab === 'usage' && (
                        <div className="space-y-8">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h1 className="text-2xl font-semibold text-white">{t('admin.api_stats_title')}</h1>
                                    <p className="text-sm text-white/40 mt-1">{t('admin.api_stats_subtitle')}</p>
                                </div>
                                <div className="flex items-center gap-2 bg-white/[0.03] p-1 rounded-lg border border-white/[0.06]">
                                    {[7, 30, 90].map(days => (
                                        <button
                                            key={days}
                                            onClick={() => setDaysFilter(days)}
                                            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${daysFilter === days ? 'bg-white/[0.1] text-white' : 'text-white/40 hover:text-white/70 hover:bg-white/[0.05]'}`}
                                        >
                                            {t('admin.last_days', { days })}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* 统计卡片 */}
                            <div className="grid grid-cols-4 gap-4">
                                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                                    <p className="text-xs text-white/40 font-medium uppercase tracking-wide">{t('admin.today_consumption')}</p>
                                    <p className="text-3xl font-semibold text-white mt-2">{formatNumber(stats?.today.tokens || 0)}</p>
                                    <p className="text-xs text-white/30 mt-1">{stats?.today.calls || 0} {t('admin.calls')}</p>
                                </div>
                                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                                    <p className="text-xs text-white/40 font-medium uppercase tracking-wide">{t('admin.today_active_users')}</p>
                                    <p className="text-3xl font-semibold text-white mt-2">{stats?.today.activeUsers || 0}</p>
                                    <p className="text-xs text-white/30 mt-1">{t('admin.unique_users')}</p>
                                </div>
                                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                                    <p className="text-xs text-white/40 font-medium uppercase tracking-wide">{t('admin.period_total', { days: daysFilter })}</p>
                                    <p className="text-3xl font-semibold text-white mt-2">{formatNumber(periodTotalTokens)}</p>
                                    <p className="text-xs text-white/30 mt-1">{formatNumber(periodTotalCalls)} {t('admin.calls')}</p>
                                </div>
                                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
                                    <p className="text-xs text-white/40 font-medium uppercase tracking-wide">{t('admin.historical_total')}</p>
                                    <p className="text-3xl font-semibold text-white mt-2">{formatNumber(stats?.total.tokens || 0)}</p>
                                    <p className="text-xs text-white/30 mt-1">{formatNumber(stats?.total.calls || 0)} {t('admin.call_label')}</p>
                                </div>
                            </div>

                            {/* 图表 */}
                            <div className="grid grid-cols-2 gap-6">
                                <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-6">
                                    <div className="flex items-center justify-between mb-6">
                                        <h3 className="text-sm font-medium text-white">{t('admin.token_trend')}</h3>
                                        <span className="text-xs text-white/30">{t('admin.last_days', { days: daysFilter })}</span>
                                    </div>
                                    <div className="h-64">
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
                                        <h3 className="text-sm font-medium text-white">{t('admin.api_calls_trend')}</h3>
                                        <span className="text-xs text-white/30">{t('admin.last_days', { days: daysFilter })}</span>
                                    </div>
                                    <div className="h-64">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={stats?.dailyHistory || []} barCategoryGap="25%">
                                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                                                <XAxis dataKey="dateLabel" stroke="rgba(255,255,255,0.2)" fontSize={11} tickLine={false} axisLine={false} />
                                                <YAxis stroke="rgba(255,255,255,0.2)" fontSize={11} tickLine={false} axisLine={false} width={30} />
                                                <Tooltip
                                                    contentStyle={{ backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px' }}
                                                    labelStyle={{ color: 'rgba(255,255,255,0.5)' }}
                                                    itemStyle={{ color: '#fff' }}
                                                    formatter={(value: number) => [value, t('admin.call_label')]}
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
                                    <h3 className="text-sm font-medium text-white mb-5">{t('admin.preset_usage_distribution')}</h3>
                                    <div className="grid grid-cols-6 gap-3">
                                        {stats.presetStats.map(p => (
                                            <div key={p.preset} className="text-center py-4 px-3 bg-white/[0.03] rounded-lg border border-white/[0.03]">
                                                <p className="text-2xl font-semibold text-white">{p.count}</p>
                                                <p className="text-xs text-white/40 mt-1">{getPresetName(p.preset, t)}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* =========== Logs Tab =========== */}
                    {activeTab === 'logs' && (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h1 className="text-2xl font-semibold text-white">{t('admin.all_usage_logs')}</h1>
                                    <p className="text-sm text-white/40 mt-1">{t('admin.usage_logs_subtitle')}</p>
                                </div>
                                <button
                                    onClick={fetchLogs}
                                    className="text-xs text-white/40 hover:text-white/60 transition-colors"
                                >
                                    {t('admin.refresh_data')}
                                </button>
                            </div>

                            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden relative min-h-[400px]">
                                {logsLoading && (
                                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                                        <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                                    </div>
                                )}
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                                            <th className="px-5 py-4 text-left text-xs font-medium text-white/40 uppercase tracking-wide">{t('admin.time')}</th>
                                            <th className="px-5 py-4 text-left text-xs font-medium text-white/40 uppercase tracking-wide">{t('admin.user')}</th>
                                            <th className="px-5 py-4 text-left text-xs font-medium text-white/40 uppercase tracking-wide">{t('admin.tier')}</th>
                                            <th className="px-5 py-4 text-left text-xs font-medium text-white/40 uppercase tracking-wide">{t('admin.preset_action')}</th>
                                            <th className="px-5 py-4 text-right text-xs font-medium text-white/40 uppercase tracking-wide">{t('admin.consumed_tokens')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/[0.04]">
                                        {logs.map(log => {
                                            const status = log.user?.subscriptionStatus || 'FREE';
                                            return (
                                                <tr key={log.id} className="hover:bg-white/[0.02]">
                                                    <td className="px-5 py-3.5 text-sm text-white/60">{formatTime(log.createdAt)}</td>
                                                    <td className="px-5 py-3.5 text-sm text-white font-medium">{log.user?.email || t('admin.unknown_user')}</td>
                                                    <td className="px-5 py-3.5">
                                                        <span className={`inline-flex text-[10px] font-bold tracking-wider px-2 py-1 rounded uppercase ${status === 'ULTRA' ? 'bg-purple-500/20 text-purple-400' :
                                                            status === 'PRO' ? 'bg-blue-500/20 text-blue-400' :
                                                                status === 'PLUS' ? 'bg-amber-500/20 text-amber-400' :
                                                                    'bg-gray-500/20 text-gray-400'
                                                            }`}>
                                                            {getTierLabel(status, t)}
                                                        </span>
                                                    </td>
                                                    <td className="px-5 py-3.5 text-sm text-white/60">{getPresetName(log.presetUsed, t)}</td>
                                                    <td className="px-5 py-3.5 text-sm text-green-400/80 text-right font-mono font-medium">{log.tokenUsage ? formatNumber(log.tokenUsage) : '-'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                                {(!logs || logs.length === 0) && !logsLoading && (
                                    <div className="py-16 text-center text-white/30 text-sm">{t('admin.no_records')}</div>
                                )}
                            </div>

                            {/* Pagination */}
                            <div className="flex items-center justify-between text-sm text-white/40">
                                <span>{t('admin.page_info', { page: logsPage, total: logsTotalPages || 1 })}</span>
                                <div className="flex items-center gap-2">
                                    <button
                                        disabled={logsPage <= 1}
                                        onClick={() => setLogsPage(p => p - 1)}
                                        className="px-3 py-1 bg-white/[0.05] hover:bg-white/[0.1] rounded disabled:opacity-30 disabled:hover:bg-white/[0.05]"
                                    >{t('admin.prev_page')}</button>
                                    <button
                                        disabled={logsPage >= logsTotalPages}
                                        onClick={() => setLogsPage(p => p + 1)}
                                        className="px-3 py-1 bg-white/[0.05] hover:bg-white/[0.1] rounded disabled:opacity-30 disabled:hover:bg-white/[0.05]"
                                    >{t('admin.next_page')}</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* =========== Users Tab =========== */}
                    {activeTab === 'users' && (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h1 className="text-2xl font-semibold text-white">{t('admin.user_management')}</h1>
                                    <p className="text-sm text-white/40 mt-1">{t('admin.user_management_subtitle')}</p>
                                </div>
                                <form onSubmit={handleSearch} className="flex gap-2">
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        placeholder={t('admin.search_email')}
                                        className="bg-white/[0.03] border border-white/[0.08] rounded-lg px-4 py-2 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20"
                                    />
                                    <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition-colors">{t('admin.search')}</button>
                                </form>
                            </div>

                            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden relative min-h-[400px]">
                                {usersLoading && (
                                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10 backdrop-blur-sm">
                                        <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                                    </div>
                                )}
                                <table className="w-full">
                                    <thead>
                                        <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                                            <th className="px-5 py-4 text-left text-xs font-medium text-white/40 uppercase tracking-wide">{t('admin.register_time')}</th>
                                            <th className="px-5 py-4 text-left text-xs font-medium text-white/40 uppercase tracking-wide">{t('admin.account_email')}</th>
                                            <th className="px-5 py-4 text-left text-xs font-medium text-white/40 uppercase tracking-wide">{t('admin.identity_tier')}</th>
                                            <th className="px-5 py-4 text-left text-xs font-medium text-white/40 uppercase tracking-wide">{t('admin.subscription_expiry')}</th>
                                            <th className="px-5 py-4 text-center text-xs font-medium text-white/40 uppercase tracking-wide">{t('admin.historical_layout')}</th>
                                            <th className="px-5 py-4 text-right text-xs font-medium text-white/40 uppercase tracking-wide">{t('admin.action')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/[0.04]">
                                        {users.map(u => (
                                            <tr key={u.id} className="hover:bg-white/[0.02]">
                                                <td className="px-5 py-3.5 text-sm text-white/60">{formatDateOnly(u.createdAt)}</td>
                                                <td className="px-5 py-3.5 text-sm text-white font-medium">{u.email}</td>
                                                <td className="px-5 py-3.5">
                                                    <span className={`inline-flex text-[10px] font-bold tracking-wider px-2 py-1 rounded uppercase ${u.subscriptionStatus === 'ULTRA' ? 'bg-purple-500/20 text-purple-400' :
                                                        u.subscriptionStatus === 'PRO' ? 'bg-blue-500/20 text-blue-400' :
                                                            u.subscriptionStatus === 'PLUS' ? 'bg-amber-500/20 text-amber-400' :
                                                                'border border-gray-600/50 text-gray-400'
                                                        }`}>
                                                        {getTierLabel(u.subscriptionStatus, t)}
                                                    </span>
                                                </td>
                                                <td className="px-5 py-3.5 text-sm text-white/60">
                                                    {u.subscriptionStatus === 'FREE' ? t('admin.permanent') : formatDateOnly(u.subscriptionEndDate)}
                                                </td>
                                                <td className="px-5 py-3.5 text-sm text-white/80 text-center font-mono">
                                                    {u.usageCount}
                                                </td>
                                                <td className="px-5 py-3.5 text-right">
                                                    <button
                                                        onClick={() => {
                                                            setEditStatus(u.subscriptionStatus);
                                                            setEditDays(0);
                                                            setEditingUser(u);
                                                        }}
                                                        className="text-xs bg-white/[0.05] hover:bg-white/[0.1] px-3 py-1.5 rounded transition-colors text-white"
                                                    >{t('admin.edit_status')}</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {(!users || users.length === 0) && !usersLoading && (
                                    <div className="py-16 text-center text-white/30 text-sm">{t('admin.no_users_found')}</div>
                                )}
                            </div>

                            {/* Pagination */}
                            <div className="flex items-center justify-between text-sm text-white/40">
                                <span>{t('admin.page_info', { page: usersPage, total: usersTotalPages || 1 })}</span>
                                <div className="flex items-center gap-2">
                                    <button
                                        disabled={usersPage <= 1}
                                        onClick={() => setUsersPage(p => p - 1)}
                                        className="px-3 py-1 bg-white/[0.05] hover:bg-white/[0.1] rounded disabled:opacity-30 disabled:hover:bg-white/[0.05]"
                                    >{t('admin.prev_page')}</button>
                                    <button
                                        disabled={usersPage >= usersTotalPages}
                                        onClick={() => setUsersPage(p => p + 1)}
                                        className="px-3 py-1 bg-white/[0.05] hover:bg-white/[0.1] rounded disabled:opacity-30 disabled:hover:bg-white/[0.05]"
                                    >{t('admin.next_page')}</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* =========== Settings Tab =========== */}
                    {activeTab === 'settings' && (
                        <div className="space-y-6 max-w-2xl">
                            <div>
                                <h1 className="text-2xl font-semibold text-white">{t('admin.system_config')}</h1>
                                <p className="text-sm text-white/40 mt-1">{t('admin.system_config_subtitle')}</p>
                            </div>

                            <form onSubmit={handleConfigSave} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-6">
                                <div className="space-y-5">
                                    {configItems.map(({ key, label }) => {
                                        const isKeyField = key.includes('KEY') || key.includes('SECRET') || key.includes('PASS') || key.includes('TOKEN') || key.includes('ID');
                                        const isVisible = visibleKeys.has(key);
                                        return (
                                            <div key={key}>
                                                <label className="block text-xs font-medium text-white/50 mb-2">{label}</label>
                                                <div className="relative">
                                                    <input
                                                        type={isKeyField && !isVisible ? 'password' : 'text'}
                                                        value={configs[key] || ''}
                                                        onChange={e => setConfigs({ ...configs, [key]: e.target.value })}
                                                        placeholder={`Enter ${label}...`}
                                                        className="w-full bg-white/[0.03] border border-white/[0.08] rounded-lg px-4 py-3 pr-10 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-white/20 transition-colors font-mono"
                                                    />
                                                    {isKeyField && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                const next = new Set(visibleKeys);
                                                                if (next.has(key)) next.delete(key); else next.add(key);
                                                                setVisibleKeys(next);
                                                            }}
                                                            className="absolute inset-y-0 right-0 px-3 text-white/30 hover:text-white/70 transition-colors"
                                                        >
                                                            {isVisible ? (
                                                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                                                            ) : (
                                                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                                                            )}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="mt-8 pt-5 border-t border-white/[0.06] flex items-center justify-between">
                                    {statusMsg && (
                                        <span className={`text-sm ${statusMsg === t('admin.saved') ? 'text-green-400' : 'text-red-400'}`}>{statusMsg}</span>
                                    )}
                                    <button
                                        type="submit"
                                        className="ml-auto bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors"
                                    >
                                        {t('admin.save_config')}
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}
                </div>
            </div>

            {/* Editing User Modal Overlay */}
            {editingUser && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className="bg-[#111] border border-white/10 rounded-2xl w-full max-w-md shadow-2xl p-6 relative">
                        <button onClick={() => setEditingUser(null)} className="absolute top-4 right-4 text-white/40 hover:text-white">
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                        <h3 className="text-lg font-bold text-white mb-1">{t('admin.edit_user')}</h3>
                        <p className="text-sm text-white/40 mb-6">{editingUser.email}</p>

                        <div className="space-y-4 mb-6">
                            <div>
                                <label className="block text-xs text-white/50 mb-2">{t('admin.subscription_tier')}</label>
                                <select
                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                                    value={editStatus}
                                    onChange={(e) => setEditStatus(e.target.value)}
                                >
                                    <option value="FREE" className="bg-gray-900">{t('admin.tier_free_label')}</option>
                                    <option value="PLUS" className="bg-gray-900">{t('admin.tier_plus_label')}</option>
                                    <option value="PRO" className="bg-gray-900">{t('admin.tier_pro_label')}</option>
                                    <option value="ULTRA" className="bg-gray-900">{t('admin.tier_ultra_label')}</option>
                                </select>
                            </div>

                            {(editStatus !== 'FREE') && (
                                <div>
                                    <label className="block text-xs text-white/50 mb-2">{t('admin.add_days')}</label>
                                    <input
                                        type="number"
                                        value={editDays}
                                        onChange={(e) => setEditDays(Number(e.target.value))}
                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                                        placeholder={t('admin.add_days_placeholder')}
                                    />
                                    <p className="text-[11px] text-white/30 mt-1">{t('admin.add_days_hint')}</p>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center justify-end gap-3">
                            {editSaveResult === 'success' && (
                                <span className="text-sm text-green-400">{t('admin.saved')}</span>
                            )}
                            {editSaveResult === 'error' && (
                                <span className="text-sm text-red-400">{t('admin.save_error')}</span>
                            )}
                            <button onClick={() => { setEditingUser(null); setEditSaveResult(null); }} className="px-4 py-2 text-sm text-white/60 hover:text-white">{t('admin.cancel')}</button>
                            <button onClick={saveUserEdit} disabled={editSaveResult === 'success'} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg">{t('admin.confirm_edit')}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
