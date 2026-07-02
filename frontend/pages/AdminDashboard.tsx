
import React, { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/authService';
import { API_BASE_URL } from '../services/apiBase';
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
    user: { phone?: string | null; email?: string | null; subscriptionStatus: string };
}

interface UserData {
    id: string;
    phone?: string | null;
    email?: string | null;
    subscriptionStatus: string;
    subscriptionEndDate: string | null;
    createdAt: string;
    usageCount: number;
    banned?: boolean;
}

interface AdminStats {
    today: { tokens: number; calls: number; activeUsers: number };
    total: { tokens: number; calls: number };
    dailyHistory: DailyData[];
    presetStats: PresetStat[];
}

interface AdminOverview {
    revenue: {
        today: { revenue: number; paidOrders: number };
        period: { revenue: number; paidOrders: number };
        total: { revenue: number; paidOrders: number };
    };
    refunds: { refundedAmount: number; refundedCount: number };
    byPlan: { planType: string; count: number; revenue: number }[];
    dailyRevenue: { date: string; dateLabel: string; revenue: number; orders: number }[];
    users: { total: number; byTier: Record<string, number>; activePaid: number; newToday: number; conversionPct: number };
    dailySignups: { date: string; dateLabel: string; count: number }[];
}

interface AdminOrder {
    id: string;
    amount: number;
    currency: string;
    planType: string;
    status: string;
    createdAt: string;
    user?: { phone?: string | null; email?: string | null; subscriptionStatus: string };
}

const getPresetName = (key: string, t: any) => {
    const keys: any = {
        'academic': 'home.preset_academic',
        'corporate': 'home.preset_corporate',
        'academic_journal': 'home.preset_academic_journal',
        'creative': 'home.preset_creative',
        'work-report': 'home.preset_work_report',
        'meeting-minutes': 'home.preset_meeting_minutes',
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

const getPlanLabel = (planType: string, t: any) => {
    const tierKey = planType.includes('ultra') ? 'ULTRA' : planType.includes('pro') ? 'PRO' : 'PLUS';
    const cycle = planType.includes('yearly') ? t('admin.cycle_yearly') : t('admin.cycle_monthly');
    return `${getTierLabel(tierKey, t)} · ${cycle}`;
};

const getOrderStatusLabel = (status: string, t: any) => {
    const map: Record<string, string> = {
        PAID: 'profile.paid', PENDING: 'profile.pending', FAILED: 'profile.failed',
        REFUNDING: 'profile.refunding', REFUNDED: 'profile.refunded', EXPIRED: 'profile.expired',
    };
    return map[status] ? t(map[status]) : status;
};

const UsageIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" />
    </svg>
);

const LogsIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
    </svg>
);

const UsersIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
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

const RevenueIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 1v22" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
);

const OrdersIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z" />
        <line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
);

const SunIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="5" />
        <line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" />
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
        <line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" />
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
);

const MoonIcon = () => (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
);

interface AdminDashboardProps {
    onClose?: () => void;
}

type AdminTheme = 'dark' | 'light';

const APP_THEME_KEY = 'docflow_theme';
const ADMIN_THEME_KEY = 'admin-theme';

const toAdminTheme = (theme: string | null): AdminTheme | null => {
    if (theme === 'dark') return 'dark';
    if (theme === 'light' || theme === 'blueviolet' || theme === 'green' || theme === 'coral' || theme === 'color') return 'light';
    return null;
};

const getInitialAdminTheme = (): AdminTheme => {
    try {
        const appTheme = toAdminTheme(localStorage.getItem(APP_THEME_KEY));
        if (appTheme) return appTheme;
        const adminTheme = toAdminTheme(localStorage.getItem(ADMIN_THEME_KEY));
        return adminTheme || 'dark';
    } catch (_) {
        return 'dark';
    }
};

const AdminBrandMark = () => (
    <svg className="w-7 h-7" viewBox="0 0 28 28" fill="none" aria-hidden="true">
        <path d="M8 4.8h6.2c5.2 0 8.8 3.55 8.8 9.2s-3.6 9.2-8.8 9.2H8V4.8Z" stroke="currentColor" strokeWidth="2.25" strokeLinejoin="round" />
        <path d="M12.2 9.2v9.6" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
        <path d="M12.2 14h10.2" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
        <path d="M4.6 19.9c4.4 2.2 8.8 2.2 13.2 0" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" opacity="0.68" />
    </svg>
);

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ onClose }) => {
    const { user, isAuthenticated, isLoading } = useAuth();
    const navigate = useNavigate();
    const { t } = useTranslation();

    // Theme
    const [adminTheme, setAdminTheme] = useState<AdminTheme>(getInitialAdminTheme);
    const isDark = adminTheme === 'dark';
    const toggleTheme = () => {
        const next = isDark ? 'light' : 'dark';
        setAdminTheme(next);
        try {
            localStorage.setItem(ADMIN_THEME_KEY, next);
            localStorage.setItem(APP_THEME_KEY, next);
        } catch (_) { /* ignore localStorage failures */ }
    };

    useEffect(() => {
        document.documentElement.setAttribute('data-doc-theme', adminTheme);
        try {
            localStorage.setItem(ADMIN_THEME_KEY, adminTheme);
        } catch (_) { /* ignore localStorage failures */ }
    }, [adminTheme]);

    // Theme tokens
    const T = {
        main:        isDark ? 'bg-[#0a0a0a] text-white'   : 'bg-gray-50 text-gray-900',
        sidebar:     isDark ? 'bg-[#0a0a0a]'              : 'bg-white',
        sidebarBorder: isDark ? 'border-r border-white/[0.08]' : 'border-r border-gray-200',
        t1:          isDark ? 'text-white'      : 'text-gray-900',
        t2:          isDark ? 'text-white/50'   : 'text-gray-500',
        t3:          isDark ? 'text-white/40'   : 'text-gray-400',
        t4:          isDark ? 'text-white/60'   : 'text-gray-600',
        t5:          isDark ? 'text-white/30'   : 'text-gray-400',
        card:        isDark ? 'bg-white/[0.03] border border-white/[0.06]' : 'bg-white border border-gray-200',
        cardInner:   isDark ? 'bg-white/[0.03] border border-white/[0.03]' : 'bg-gray-50 border border-gray-100',
        navActive:   isDark ? 'bg-white/[0.08] text-white'                : 'bg-gray-100 text-gray-900',
        navInactive: isDark ? 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100',
        tableHead:   isDark ? 'border-b border-white/[0.06] bg-white/[0.02]' : 'border-b border-gray-200 bg-gray-50',
        tableThText: isDark ? 'text-white/40'  : 'text-gray-500',
        tableDivide: isDark ? 'divide-y divide-white/[0.04]' : 'divide-y divide-gray-100',
        tableHover:  isDark ? 'hover:bg-white/[0.02]' : 'hover:bg-gray-50',
        input:       isDark
            ? 'bg-white/[0.03] border border-white/[0.08] text-white placeholder:text-white/20 focus:outline-none focus:border-white/20'
            : 'bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-gray-400',
        select:      isDark
            ? 'bg-white/[0.03] border border-white/[0.08] text-white focus:outline-none focus:border-white/20'
            : 'bg-white border border-gray-200 text-gray-900 focus:outline-none focus:border-gray-400',
        segWrap:     isDark ? 'bg-white/[0.03] p-1 rounded-lg border border-white/[0.06]' : 'bg-gray-100 p-1 rounded-lg border border-gray-200',
        segActive:   isDark ? 'bg-white/[0.1] text-white'  : 'bg-white text-gray-900 shadow-sm',
        segInactive: isDark ? 'text-white/40 hover:text-white/70 hover:bg-white/[0.05]' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-200',
        footerBtn:   isDark ? 'text-white/50 hover:text-white/80 hover:bg-white/[0.04]' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100',
        footerBorder: isDark ? 'border-t border-white/[0.08]' : 'border-t border-gray-200',
        spinner:     isDark ? 'border-white/20 border-t-white' : 'border-gray-200 border-t-gray-600',
        overlay:     isDark ? 'bg-black/50 backdrop-blur-sm' : 'bg-white/70 backdrop-blur-sm',
        pageBtn:     isDark
            ? 'px-3 py-1 bg-white/[0.05] hover:bg-white/[0.1] rounded disabled:opacity-30 disabled:hover:bg-white/[0.05]'
            : 'px-3 py-1 bg-white hover:bg-gray-100 border border-gray-200 rounded disabled:opacity-30',
        modal:       isDark ? 'bg-[#111] border border-white/10' : 'bg-white border border-gray-200',
        modalClose:  isDark ? 'text-white/40 hover:text-white' : 'text-gray-400 hover:text-gray-600',
        modalLabel:  isDark ? 'text-white/50' : 'text-gray-500',
        modalInput:  isDark ? 'bg-white/5 border border-white/10 text-white' : 'bg-gray-50 border border-gray-200 text-gray-900',
        editBtn:     isDark ? 'bg-white/[0.05] hover:bg-white/[0.1] text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-700',
        banBtn:      isDark ? 'bg-red-500/20 hover:bg-red-500/30 text-red-300'   : 'bg-red-100 hover:bg-red-200 text-red-700',
        unbanBtn:    isDark ? 'bg-green-500/20 hover:bg-green-500/30 text-green-300' : 'bg-green-100 hover:bg-green-200 text-green-700',
        refundBtn:   isDark ? 'bg-red-500/20 hover:bg-red-500/30 text-red-300' : 'bg-red-100 hover:bg-red-200 text-red-700',
        tierBadge: (s: string) => {
            if (isDark) {
                return s === 'ULTRA' ? 'bg-purple-500/20 text-purple-400'
                    : s === 'PRO'   ? 'bg-blue-500/20 text-blue-400'
                    : s === 'PLUS'  ? 'bg-amber-500/20 text-amber-400'
                    : 'bg-gray-500/20 text-gray-400';
            }
            return s === 'ULTRA' ? 'bg-purple-100 text-purple-700'
                : s === 'PRO'   ? 'bg-blue-100 text-blue-700'
                : s === 'PLUS'  ? 'bg-amber-100 text-amber-700'
                : 'bg-gray-100 text-gray-600';
        },
        tierBadgeNoBox: (s: string) => {
            if (isDark) {
                return s === 'ULTRA' ? 'text-purple-400'
                    : s === 'PRO'   ? 'text-blue-400'
                    : s === 'PLUS'  ? 'text-amber-400'
                    : 'text-gray-400';
            }
            return s === 'ULTRA' ? 'text-purple-700'
                : s === 'PRO'   ? 'text-blue-700'
                : s === 'PLUS'  ? 'text-amber-700'
                : 'text-gray-500';
        },
        // Chart
        chartGrid:  isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
        chartAxis:  isDark ? 'rgba(255,255,255,0.2)'  : 'rgba(0,0,0,0.25)',
        chartTip: {
            content: isDark
                ? { backgroundColor: '#1a1a1a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px', fontSize: '12px' }
                : { backgroundColor: '#fff',    border: '1px solid rgba(0,0,0,0.1)',       borderRadius: '8px', fontSize: '12px' },
            label: { color: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)' },
            item:  { color: isDark ? '#fff' : '#111' },
        },
        tokenStroke:    isDark ? 'rgba(255,255,255,0.6)' : 'rgba(99,102,241,0.8)',
        tokenGradStart: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(99,102,241,0.2)',
        callsBarFill:   isDark ? 'rgba(255,255,255,0.25)' : 'rgba(99,102,241,0.5)',
        signupsBarFill: isDark ? 'rgba(96,165,250,0.5)'   : 'rgba(96,165,250,0.7)',
    };

    const orderStatusClass = (status: string) => {
        if (isDark) {
            return status === 'PAID' ? 'bg-green-500/20 text-green-400'
                : (status === 'PENDING' || status === 'REFUNDING') ? 'bg-amber-500/20 text-amber-400'
                : status === 'REFUNDED' ? 'bg-indigo-500/20 text-indigo-400'
                : 'bg-red-500/20 text-red-400';
        }
        return status === 'PAID' ? 'bg-green-100 text-green-700'
            : (status === 'PENDING' || status === 'REFUNDING') ? 'bg-amber-100 text-amber-700'
            : status === 'REFUNDED' ? 'bg-indigo-100 text-indigo-700'
            : 'bg-red-100 text-red-700';
    };

    const [activeTab, setActiveTab] = useState<'overview' | 'usage' | 'logs' | 'users' | 'orders' | 'settings'>('overview');
    const [stats, setStats] = useState<AdminStats | null>(null);
    const [configs, setConfigs] = useState<Record<string, string>>({});
    const [statusMsg, setStatusMsg] = useState('');
    const [loading, setLoading] = useState(true);
    const [daysFilter, setDaysFilter] = useState<number>(7);

    const [logs, setLogs] = useState<UsageLog[]>([]);
    const [logsPage, setLogsPage] = useState(1);
    const [logsTotalPages, setLogsTotalPages] = useState(1);
    const [logsLoading, setLogsLoading] = useState(false);

    const [users, setUsers] = useState<UserData[]>([]);
    const [usersPage, setUsersPage] = useState(1);
    const [usersTotalPages, setUsersTotalPages] = useState(1);
    const [searchQuery, setSearchQuery] = useState('');
    const [usersLoading, setUsersLoading] = useState(false);

    const [editingUser, setEditingUser] = useState<UserData | null>(null);
    const [editStatus, setEditStatus] = useState<string>('FREE');
    const [editDays, setEditDays] = useState<number>(0);
    const [editSaveResult, setEditSaveResult] = useState<'success' | 'error' | null>(null);
    const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set());

    const [overview, setOverview] = useState<AdminOverview | null>(null);

    const [orders, setOrders] = useState<AdminOrder[]>([]);
    const [ordersPage, setOrdersPage] = useState(1);
    const [ordersTotalPages, setOrdersTotalPages] = useState(1);
    const [ordersLoading, setOrdersLoading] = useState(false);
    const [statusFilter, setStatusFilter] = useState<string>('');
    const [refundingId, setRefundingId] = useState<string | null>(null);

    useEffect(() => {
        if (!isLoading) {
            if (!isAuthenticated || !user?.isAdmin) {
                if (onClose) onClose();
                else navigate('/');
            } else {
                fetchStats();
                fetchOverview();
                fetchConfigs();
            }
        }
    }, [isAuthenticated, user, isLoading, navigate, daysFilter]);

    useEffect(() => {
        if (activeTab === 'logs') fetchLogs();
        else if (activeTab === 'users') fetchUsers();
        else if (activeTab === 'orders') fetchOrders();
    }, [activeTab, logsPage, usersPage, ordersPage, statusFilter]);

    const API = API_BASE_URL;
    const authHeader = () => ({ 'Authorization': `Bearer ${authService.getToken()}` });

    const fetchStats = async () => {
        try {
            const res = await fetch(`${API}/api/admin/stats?days=${daysFilter}`, { headers: authHeader() });
            if (res.ok) setStats(await res.json());
            setLoading(false);
        } catch { setLoading(false); }
    };

    const fetchOverview = async () => {
        try {
            const res = await fetch(`${API}/api/admin/overview?days=${daysFilter}`, { headers: authHeader() });
            if (res.ok) setOverview(await res.json());
        } catch (err) { console.error(err); }
    };

    const fetchConfigs = async () => {
        try {
            const res = await fetch(`${API}/api/admin/config`, { headers: authHeader() });
            if (res.ok) setConfigs(await res.json());
        } catch (err) { console.error(err); }
    };

    const fetchLogs = async () => {
        setLogsLoading(true);
        try {
            const res = await fetch(`${API}/api/admin/logs?page=${logsPage}&limit=15`, { headers: authHeader() });
            if (res.ok) {
                const data = await res.json();
                setLogs(data.data);
                setLogsTotalPages(data.pagination.totalPages);
            }
        } catch (err) { console.error(err); }
        setLogsLoading(false);
    };

    const fetchUsers = async () => {
        setUsersLoading(true);
        try {
            const res = await fetch(`${API}/api/admin/users?page=${usersPage}&limit=15&search=${searchQuery}`, { headers: authHeader() });
            if (res.ok) {
                const data = await res.json();
                setUsers(data.data);
                setUsersTotalPages(data.pagination.totalPages);
            }
        } catch (err) { console.error(err); }
        setUsersLoading(false);
    };

    const fetchOrders = async () => {
        setOrdersLoading(true);
        try {
            const q = `page=${ordersPage}&limit=15${statusFilter ? `&status=${statusFilter}` : ''}`;
            const res = await fetch(`${API}/api/admin/orders?${q}`, { headers: authHeader() });
            if (res.ok) {
                const data = await res.json();
                setOrders(data.data);
                setOrdersTotalPages(data.pagination.totalPages);
            }
        } catch (err) { console.error(err); }
        setOrdersLoading(false);
    };

    const handleSearch = (e: React.FormEvent) => {
        e.preventDefault();
        setUsersPage(1);
        fetchUsers();
    };

    const handleConfigSave = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const res = await fetch(`${API}/api/admin/config`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeader() },
                body: JSON.stringify({ configs })
            });
            if (res.ok) {
                setStatusMsg(t('admin.saved'));
                setTimeout(() => setStatusMsg(''), 2000);
            } else {
                setStatusMsg(t('admin.save_failed'));
            }
        } catch { setStatusMsg(t('admin.save_error')); }
    };

    const saveUserEdit = async () => {
        if (!editingUser) return;
        try {
            const res = await fetch(`${API}/api/admin/users/${editingUser.id}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeader() },
                body: JSON.stringify({ subscriptionStatus: editStatus, additionalDays: editDays !== 0 ? editDays : undefined })
            });
            if (res.ok) {
                setEditSaveResult('success');
                fetchUsers();
                setTimeout(() => { setEditingUser(null); setEditSaveResult(null); }, 1200);
            } else {
                setEditSaveResult('error');
            }
        } catch { setEditSaveResult('error'); }
    };

    const toggleBanUser = async (u: UserData) => {
        const action = u.banned ? 'unban' : 'ban';
        const confirmMsg = u.banned
            ? t('admin.unban_confirm', '确定解封 {{email}}?', { email: u.phone || u.email || u.id })
            : t('admin.ban_confirm', '确定封禁 {{email}}? 用户将无法访问任何 API。', { email: u.phone || u.email || u.id });
        if (!window.confirm(confirmMsg)) return;
        try {
            const res = await fetch(`${API}/api/admin/users/${u.id}/${action}`, { method: 'POST', headers: authHeader() });
            if (res.ok) fetchUsers();
        } catch (err) { console.error(`${action} user failed:`, err); }
    };

    const handleAdminRefund = async (o: AdminOrder) => {
        if (refundingId) return;
        const who = o.user?.phone || o.user?.email || o.id;
        const msg = t('admin.refund_confirm', '确定为 {{who}} 退款 ¥{{amt}}? 用户将立即降级为免费版。', { who, amt: o.amount });
        if (!window.confirm(msg)) return;
        setRefundingId(o.id);
        try {
            const res = await fetch(`${API}/api/payment/refund/${o.id}`, { method: 'POST', headers: authHeader() });
            if (res.ok) { await fetchOrders(); await fetchOverview(); }
            else {
                const e = await res.json().catch(() => ({} as any));
                window.alert(e.error || e.message || t('errors.refund_failed', '退款失败'));
            }
        } catch { window.alert(t('errors.refund_failed', '退款失败')); }
        finally { setRefundingId(null); }
    };

    const formatNumber = (num: number) => num.toLocaleString();

    const formatTime = (isoString: string) =>
        new Date(isoString).toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

    const formatDateOnly = (isoString?: string | null) =>
        isoString ? new Date(isoString).toLocaleDateString('zh-CN') : '-';

    if (isLoading || loading) {
        return (
            <div className={`min-h-screen ${T.main} flex items-center justify-center ${onClose ? 'fixed inset-0 z-[100]' : ''}`}>
                <div className={`w-5 h-5 border-2 ${T.spinner} rounded-full animate-spin`}></div>
            </div>
        );
    }

    const configItems = [
        { key: 'GEMINI_OPENAI_BASE_URL', label: 'Gemini API Base URL' },
        { key: 'GOOGLE_API_KEY',         label: 'Google / Gemini API Key' },
        { key: 'DEEPSEEK_API_KEY',       label: 'DeepSeek API Key' },
    ];

    const periodTotalTokens = stats?.dailyHistory.reduce((a, b) => a + b.tokens, 0) || 0;
    const periodTotalCalls  = stats?.dailyHistory.reduce((a, b) => a + b.calls,  0) || 0;

    const navItems = [
        { key: 'overview',  label: t('admin.tab_revenue'),  Icon: RevenueIcon  },
        { key: 'usage',     label: t('admin.tab_usage'),    Icon: UsageIcon    },
        { key: 'logs',      label: t('admin.tab_logs'),     Icon: LogsIcon     },
        { key: 'users',     label: t('admin.tab_users'),    Icon: UsersIcon    },
        { key: 'orders',    label: t('admin.tab_orders'),   Icon: OrdersIcon   },
        { key: 'settings',  label: t('admin.tab_settings'), Icon: SettingsIcon },
    ];

    const DaysFilter = () => (
        <div className={`flex items-center gap-2 ${T.segWrap}`}>
            {[7, 30, 90].map(days => (
                <button
                    key={days}
                    onClick={() => setDaysFilter(days)}
                    className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${daysFilter === days ? T.segActive : T.segInactive}`}
                >
                    {t('admin.last_days', { days })}
                </button>
            ))}
        </div>
    );

    const Pagination = ({ page, total, onPrev, onNext }: { page: number; total: number; onPrev: () => void; onNext: () => void }) => (
        <div className={`flex items-center justify-between text-sm ${T.t3}`}>
            <span>{t('admin.page_info', { page, total: total || 1 })}</span>
            <div className="flex items-center gap-2">
                <button disabled={page <= 1}    onClick={onPrev} className={T.pageBtn}>{t('admin.prev_page')}</button>
                <button disabled={page >= total} onClick={onNext} className={T.pageBtn}>{t('admin.next_page')}</button>
            </div>
        </div>
    );

    return (
        <div data-doc-theme={adminTheme} className={`${T.main} ${onClose ? 'fixed inset-0 z-[100] overflow-y-auto' : 'min-h-screen'}`}>
            {/* 侧边导航 */}
            <div className={`fixed left-0 top-0 bottom-0 w-60 ${T.sidebar} ${T.sidebarBorder} flex flex-col z-[101]`}>
                <div className="px-5 py-6">
                    <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 flex items-center justify-center ${isDark ? 'text-white' : 'text-gray-900'}`}>
                            <AdminBrandMark />
                        </div>
                        <span className={`text-[15px] font-semibold ${T.t1}`}>{t('admin.title')}</span>
                    </div>
                </div>

                <nav className="flex-1 px-3 py-2">
                    <div className="space-y-1">
                        {navItems.map(item => (
                            <button
                                key={item.key}
                                onClick={() => setActiveTab(item.key as any)}
                                className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${activeTab === item.key ? T.navActive : T.navInactive}`}
                            >
                                <item.Icon />
                                {item.label}
                            </button>
                        ))}
                    </div>
                </nav>

                <div className={`px-3 py-4 ${T.footerBorder} space-y-1`}>
                    <button
                        onClick={toggleTheme}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${T.footerBtn}`}
                    >
                        {isDark ? <SunIcon /> : <MoonIcon />}
                        {isDark ? t('admin.theme_light', '切换亮色') : t('admin.theme_dark', '切换暗色')}
                    </button>
                    <button
                        onClick={() => { if (onClose) onClose(); else navigate('/'); }}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-colors ${T.footerBtn}`}
                    >
                        <BackIcon />
                        {t('admin.back_to_app')}
                    </button>
                </div>
            </div>

            {/* 主内容区 */}
            <div className="ml-60">
                <div className="max-w-6xl mx-auto px-8 py-10">

                    {/* =========== Overview Tab =========== */}
                    {activeTab === 'overview' && (
                        <div className="space-y-8">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h1 className={`text-2xl font-semibold ${T.t1}`}>{t('admin.revenue_title')}</h1>
                                    <p className={`text-sm ${T.t3} mt-1`}>{t('admin.revenue_subtitle')}</p>
                                </div>
                                <DaysFilter />
                            </div>

                            <div className="grid grid-cols-4 gap-4">
                                {[
                                    { label: t('admin.revenue_today'),  val: overview?.revenue.today.revenue || 0,  sub: `${overview?.revenue.today.paidOrders || 0} ${t('admin.paid_orders')}` },
                                    { label: t('admin.revenue_period', { days: daysFilter }), val: overview?.revenue.period.revenue || 0, sub: `${overview?.revenue.period.paidOrders || 0} ${t('admin.paid_orders')}` },
                                    { label: t('admin.revenue_total'),  val: overview?.revenue.total.revenue || 0,  sub: `${overview?.revenue.total.paidOrders || 0} ${t('admin.paid_orders')}` },
                                ].map((c, i) => (
                                    <div key={i} className={`${T.card} rounded-xl p-5`}>
                                        <p className={`text-xs ${T.t3} font-medium uppercase tracking-wide`}>{c.label}</p>
                                        <p className={`text-3xl font-semibold ${T.t1} mt-2`}>¥{formatNumber(c.val)}</p>
                                        <p className={`text-xs ${T.t5} mt-1`}>{c.sub}</p>
                                    </div>
                                ))}
                                <div className={`${T.card} rounded-xl p-5`}>
                                    <p className={`text-xs ${T.t3} font-medium uppercase tracking-wide`}>{t('admin.refund_amount')}</p>
                                    <p className="text-3xl font-semibold text-red-400 mt-2">¥{formatNumber(overview?.refunds.refundedAmount || 0)}</p>
                                    <p className={`text-xs ${T.t5} mt-1`}>{overview?.refunds.refundedCount || 0} {t('admin.refund_count')}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                                <div className={`${T.card} rounded-xl p-6`}>
                                    <div className="flex items-center justify-between mb-6">
                                        <h3 className={`text-sm font-medium ${T.t1}`}>{t('admin.revenue_trend')}</h3>
                                        <span className={`text-xs ${T.t5}`}>{t('admin.last_days', { days: daysFilter })}</span>
                                    </div>
                                    <div className="h-64">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={overview?.dailyRevenue || []}>
                                                <defs>
                                                    <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="0%" stopColor="#34d399" stopOpacity={isDark ? 0.25 : 0.35} />
                                                        <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" stroke={T.chartGrid} vertical={false} />
                                                <XAxis dataKey="dateLabel" stroke={T.chartAxis} fontSize={11} tickLine={false} axisLine={false} />
                                                <YAxis stroke={T.chartAxis} fontSize={11} tickFormatter={(v: number) => `¥${formatNumber(v)}`} tickLine={false} axisLine={false} width={55} />
                                                <Tooltip contentStyle={T.chartTip.content} labelStyle={T.chartTip.label} itemStyle={T.chartTip.item} formatter={(value: number) => [`¥${formatNumber(value)}`, t('admin.revenue_trend')]} />
                                                <Area type="monotone" dataKey="revenue" stroke="#34d399" strokeWidth={2} fill="url(#revGrad)" />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                <div className={`${T.card} rounded-xl p-6`}>
                                    <h3 className={`text-sm font-medium ${T.t1} mb-5`}>{t('admin.revenue_by_plan')}</h3>
                                    {overview?.byPlan && overview.byPlan.length > 0 ? (
                                        <div className="space-y-2">
                                            {overview.byPlan.map(p => (
                                                <div key={p.planType} className={`flex items-center justify-between px-4 py-3 ${T.cardInner} rounded-lg`}>
                                                    <span className={`text-sm ${T.t2}`}>{getPlanLabel(p.planType, t)}</span>
                                                    <span className={`text-sm ${T.t3}`}>{p.count} {t('admin.paid_orders')}</span>
                                                    <span className={`text-sm font-semibold ${T.t1} font-mono`}>¥{formatNumber(p.revenue)}</span>
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div className={`py-16 text-center ${T.t5} text-sm`}>{t('admin.no_orders')}</div>
                                    )}
                                </div>
                            </div>

                            <div className="grid grid-cols-4 gap-4">
                                <div className={`${T.card} rounded-xl p-5`}>
                                    <p className={`text-xs ${T.t3} font-medium uppercase tracking-wide`}>{t('admin.users_total')}</p>
                                    <p className={`text-3xl font-semibold ${T.t1} mt-2`}>{formatNumber(overview?.users.total || 0)}</p>
                                    <p className={`text-xs ${T.t5} mt-1`}>{t('admin.users_new_today')} +{overview?.users.newToday || 0}</p>
                                </div>
                                <div className={`${T.card} rounded-xl p-5`}>
                                    <p className={`text-xs ${T.t3} font-medium uppercase tracking-wide`}>{t('admin.users_active_paid')}</p>
                                    <p className={`text-3xl font-semibold ${T.t1} mt-2`}>{formatNumber(overview?.users.activePaid || 0)}</p>
                                    <p className={`text-xs ${T.t5} mt-1`}>{t('admin.of_total', { pct: overview?.users.conversionPct || 0 })}</p>
                                </div>
                                <div className={`${T.card} rounded-xl p-5`}>
                                    <p className={`text-xs ${T.t3} font-medium uppercase tracking-wide`}>{t('admin.conversion_rate')}</p>
                                    <p className={`text-3xl font-semibold ${T.t1} mt-2`}>{overview?.users.conversionPct || 0}%</p>
                                    <p className={`text-xs ${T.t5} mt-1`}>{t('admin.users_active_paid')} / {t('admin.users_total')}</p>
                                </div>
                                <div className={`${T.card} rounded-xl p-5`}>
                                    <p className={`text-xs ${T.t3} font-medium uppercase tracking-wide`}>{t('admin.users_new_today')}</p>
                                    <p className={`text-3xl font-semibold ${T.t1} mt-2`}>{formatNumber(overview?.users.newToday || 0)}</p>
                                    <p className={`text-xs ${T.t5} mt-1`}>{t('admin.unique_users')}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                                <div className={`${T.card} rounded-xl p-6`}>
                                    <h3 className={`text-sm font-medium ${T.t1} mb-5`}>{t('admin.tier_distribution')}</h3>
                                    <div className="grid grid-cols-4 gap-3">
                                        {(['FREE', 'PLUS', 'PRO', 'ULTRA'] as const).map(tier => (
                                            <div key={tier} className={`text-center py-4 px-3 ${T.cardInner} rounded-lg`}>
                                                <p className={`text-2xl font-semibold ${T.t1}`}>{overview?.users.byTier?.[tier] || 0}</p>
                                                <p className={`text-xs mt-1 font-bold tracking-wider ${T.tierBadgeNoBox(tier)}`}>{getTierLabel(tier, t)}</p>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className={`${T.card} rounded-xl p-6`}>
                                    <div className="flex items-center justify-between mb-6">
                                        <h3 className={`text-sm font-medium ${T.t1}`}>{t('admin.signups_trend')}</h3>
                                        <span className={`text-xs ${T.t5}`}>{t('admin.last_days', { days: daysFilter })}</span>
                                    </div>
                                    <div className="h-48">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={overview?.dailySignups || []} barCategoryGap="25%">
                                                <CartesianGrid strokeDasharray="3 3" stroke={T.chartGrid} vertical={false} />
                                                <XAxis dataKey="dateLabel" stroke={T.chartAxis} fontSize={11} tickLine={false} axisLine={false} />
                                                <YAxis stroke={T.chartAxis} fontSize={11} tickLine={false} axisLine={false} width={30} allowDecimals={false} />
                                                <Tooltip contentStyle={T.chartTip.content} labelStyle={T.chartTip.label} itemStyle={T.chartTip.item} formatter={(value: number) => [value, t('admin.users_new_today')]} />
                                                <Bar dataKey="count" fill={T.signupsBarFill} radius={[4, 4, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* =========== Usage Tab =========== */}
                    {activeTab === 'usage' && (
                        <div className="space-y-8">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h1 className={`text-2xl font-semibold ${T.t1}`}>{t('admin.api_stats_title')}</h1>
                                    <p className={`text-sm ${T.t3} mt-1`}>{t('admin.api_stats_subtitle')}</p>
                                </div>
                                <DaysFilter />
                            </div>

                            <div className="grid grid-cols-4 gap-4">
                                <div className={`${T.card} rounded-xl p-5`}>
                                    <p className={`text-xs ${T.t3} font-medium uppercase tracking-wide`}>{t('admin.today_consumption')}</p>
                                    <p className={`text-3xl font-semibold ${T.t1} mt-2`}>{formatNumber(stats?.today.tokens || 0)}</p>
                                    <p className={`text-xs ${T.t5} mt-1`}>{stats?.today.calls || 0} {t('admin.calls')}</p>
                                </div>
                                <div className={`${T.card} rounded-xl p-5`}>
                                    <p className={`text-xs ${T.t3} font-medium uppercase tracking-wide`}>{t('admin.today_active_users')}</p>
                                    <p className={`text-3xl font-semibold ${T.t1} mt-2`}>{stats?.today.activeUsers || 0}</p>
                                    <p className={`text-xs ${T.t5} mt-1`}>{t('admin.unique_users')}</p>
                                </div>
                                <div className={`${T.card} rounded-xl p-5`}>
                                    <p className={`text-xs ${T.t3} font-medium uppercase tracking-wide`}>{t('admin.period_total', { days: daysFilter })}</p>
                                    <p className={`text-3xl font-semibold ${T.t1} mt-2`}>{formatNumber(periodTotalTokens)}</p>
                                    <p className={`text-xs ${T.t5} mt-1`}>{formatNumber(periodTotalCalls)} {t('admin.calls')}</p>
                                </div>
                                <div className={`${T.card} rounded-xl p-5`}>
                                    <p className={`text-xs ${T.t3} font-medium uppercase tracking-wide`}>{t('admin.historical_total')}</p>
                                    <p className={`text-3xl font-semibold ${T.t1} mt-2`}>{formatNumber(stats?.total.tokens || 0)}</p>
                                    <p className={`text-xs ${T.t5} mt-1`}>{formatNumber(stats?.total.calls || 0)} {t('admin.call_label')}</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-6">
                                <div className={`${T.card} rounded-xl p-6`}>
                                    <div className="flex items-center justify-between mb-6">
                                        <h3 className={`text-sm font-medium ${T.t1}`}>{t('admin.token_trend')}</h3>
                                        <span className={`text-xs ${T.t5}`}>{t('admin.last_days', { days: daysFilter })}</span>
                                    </div>
                                    <div className="h-64">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <AreaChart data={stats?.dailyHistory || []}>
                                                <defs>
                                                    <linearGradient id="tokenGrad" x1="0" y1="0" x2="0" y2="1">
                                                        <stop offset="0%" stopColor={isDark ? '#fff' : '#6366f1'} stopOpacity={isDark ? 0.15 : 0.2} />
                                                        <stop offset="100%" stopColor={isDark ? '#fff' : '#6366f1'} stopOpacity={0} />
                                                    </linearGradient>
                                                </defs>
                                                <CartesianGrid strokeDasharray="3 3" stroke={T.chartGrid} vertical={false} />
                                                <XAxis dataKey="dateLabel" stroke={T.chartAxis} fontSize={11} tickLine={false} axisLine={false} />
                                                <YAxis stroke={T.chartAxis} fontSize={11} tickFormatter={formatNumber} tickLine={false} axisLine={false} width={45} />
                                                <Tooltip contentStyle={T.chartTip.content} labelStyle={T.chartTip.label} itemStyle={T.chartTip.item} formatter={(value: number) => [formatNumber(value), 'Tokens']} />
                                                <Area type="monotone" dataKey="tokens" stroke={T.tokenStroke} strokeWidth={2} fill="url(#tokenGrad)" />
                                            </AreaChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>

                                <div className={`${T.card} rounded-xl p-6`}>
                                    <div className="flex items-center justify-between mb-6">
                                        <h3 className={`text-sm font-medium ${T.t1}`}>{t('admin.api_calls_trend')}</h3>
                                        <span className={`text-xs ${T.t5}`}>{t('admin.last_days', { days: daysFilter })}</span>
                                    </div>
                                    <div className="h-64">
                                        <ResponsiveContainer width="100%" height="100%">
                                            <BarChart data={stats?.dailyHistory || []} barCategoryGap="25%">
                                                <CartesianGrid strokeDasharray="3 3" stroke={T.chartGrid} vertical={false} />
                                                <XAxis dataKey="dateLabel" stroke={T.chartAxis} fontSize={11} tickLine={false} axisLine={false} />
                                                <YAxis stroke={T.chartAxis} fontSize={11} tickLine={false} axisLine={false} width={30} />
                                                <Tooltip contentStyle={T.chartTip.content} labelStyle={T.chartTip.label} itemStyle={T.chartTip.item} formatter={(value: number) => [value, t('admin.call_label')]} />
                                                <Bar dataKey="calls" fill={T.callsBarFill} radius={[4, 4, 0, 0]} />
                                            </BarChart>
                                        </ResponsiveContainer>
                                    </div>
                                </div>
                            </div>

                            {stats?.presetStats && stats.presetStats.length > 0 && (
                                <div className={`${T.card} rounded-xl p-6`}>
                                    <h3 className={`text-sm font-medium ${T.t1} mb-5`}>{t('admin.preset_usage_distribution')}</h3>
                                    <div className="grid grid-cols-6 gap-3">
                                        {stats.presetStats.map(p => (
                                            <div key={p.preset} className={`text-center py-4 px-3 ${T.cardInner} rounded-lg`}>
                                                <p className={`text-2xl font-semibold ${T.t1}`}>{p.count}</p>
                                                <p className={`text-xs ${T.t3} mt-1`}>{getPresetName(p.preset, t)}</p>
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
                                    <h1 className={`text-2xl font-semibold ${T.t1}`}>{t('admin.all_usage_logs')}</h1>
                                    <p className={`text-sm ${T.t3} mt-1`}>{t('admin.usage_logs_subtitle')}</p>
                                </div>
                                <button onClick={fetchLogs} className={`text-xs ${T.t3} hover:${T.t2} transition-colors`}>{t('admin.refresh_data')}</button>
                            </div>

                            <div className={`${T.card} rounded-xl overflow-hidden relative min-h-[400px]`}>
                                {logsLoading && (
                                    <div className={`absolute inset-0 ${T.overlay} flex items-center justify-center z-10`}>
                                        <div className={`w-5 h-5 border-2 ${T.spinner} rounded-full animate-spin`}></div>
                                    </div>
                                )}
                                <table className="w-full">
                                    <thead>
                                        <tr className={T.tableHead}>
                                            {[t('admin.time'), t('admin.user'), t('admin.tier'), t('admin.preset_action'), t('admin.consumed_tokens')].map((h, i) => (
                                                <th key={i} className={`px-5 py-4 ${i === 4 ? 'text-right' : 'text-left'} text-xs font-medium ${T.tableThText} uppercase tracking-wide`}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className={T.tableDivide}>
                                        {logs.map(log => {
                                            const s = log.user?.subscriptionStatus || 'FREE';
                                            return (
                                                <tr key={log.id} className={T.tableHover}>
                                                    <td className={`px-5 py-3.5 text-sm ${T.t4}`}>{formatTime(log.createdAt)}</td>
                                                    <td className={`px-5 py-3.5 text-sm ${T.t1} font-medium`}>{log.user?.phone || log.user?.email || t('admin.unknown_user')}</td>
                                                    <td className="px-5 py-3.5">
                                                        <span className={`inline-flex text-[10px] font-bold tracking-wider px-2 py-1 rounded uppercase ${T.tierBadge(s)}`}>
                                                            {getTierLabel(s, t)}
                                                        </span>
                                                    </td>
                                                    <td className={`px-5 py-3.5 text-sm ${T.t4}`}>{getPresetName(log.presetUsed, t)}</td>
                                                    <td className="px-5 py-3.5 text-sm text-green-500 text-right font-mono font-medium">{log.tokenUsage ? formatNumber(log.tokenUsage) : '-'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                                {(!logs || logs.length === 0) && !logsLoading && (
                                    <div className={`py-16 text-center ${T.t5} text-sm`}>{t('admin.no_records')}</div>
                                )}
                            </div>
                            <Pagination page={logsPage} total={logsTotalPages} onPrev={() => setLogsPage(p => p - 1)} onNext={() => setLogsPage(p => p + 1)} />
                        </div>
                    )}

                    {/* =========== Users Tab =========== */}
                    {activeTab === 'users' && (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h1 className={`text-2xl font-semibold ${T.t1}`}>{t('admin.user_management')}</h1>
                                    <p className={`text-sm ${T.t3} mt-1`}>{t('admin.user_management_subtitle')}</p>
                                </div>
                                <form onSubmit={handleSearch} className="flex gap-2">
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        placeholder={t('admin.search_email')}
                                        className={`rounded-lg px-4 py-2 text-sm ${T.input}`}
                                    />
                                    <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm transition-colors">{t('admin.search')}</button>
                                </form>
                            </div>

                            <div className={`${T.card} rounded-xl overflow-hidden relative min-h-[400px]`}>
                                {usersLoading && (
                                    <div className={`absolute inset-0 ${T.overlay} flex items-center justify-center z-10`}>
                                        <div className={`w-5 h-5 border-2 ${T.spinner} rounded-full animate-spin`}></div>
                                    </div>
                                )}
                                <table className="w-full">
                                    <thead>
                                        <tr className={T.tableHead}>
                                            {[t('admin.register_time'), t('admin.account_email'), t('admin.identity_tier'), t('admin.subscription_expiry'), t('admin.historical_layout'), t('admin.action')].map((h, i) => (
                                                <th key={i} className={`px-5 py-4 ${i === 4 ? 'text-center' : i === 5 ? 'text-right' : 'text-left'} text-xs font-medium ${T.tableThText} uppercase tracking-wide`}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className={T.tableDivide}>
                                        {users.map(u => (
                                            <tr key={u.id} className={T.tableHover}>
                                                <td className={`px-5 py-3.5 text-sm ${T.t4}`}>{formatDateOnly(u.createdAt)}</td>
                                                <td className={`px-5 py-3.5 text-sm ${T.t1} font-medium`}>
                                                    <span className={u.banned ? 'line-through opacity-60' : ''}>{u.phone || u.email || u.id}</span>
                                                    {u.banned && <span className="ml-2 inline-block px-1.5 py-0.5 text-[10px] bg-red-500/30 text-red-300 rounded">{t('admin.banned_badge', '已封禁')}</span>}
                                                </td>
                                                <td className="px-5 py-3.5">
                                                    <span className={`inline-flex text-[10px] font-bold tracking-wider px-2 py-1 rounded uppercase ${T.tierBadge(u.subscriptionStatus)}`}>
                                                        {getTierLabel(u.subscriptionStatus, t)}
                                                    </span>
                                                </td>
                                                <td className={`px-5 py-3.5 text-sm ${T.t4}`}>
                                                    {u.subscriptionStatus === 'FREE' ? t('admin.permanent') : formatDateOnly(u.subscriptionEndDate)}
                                                </td>
                                                <td className={`px-5 py-3.5 text-sm ${T.t2} text-center font-mono`}>{u.usageCount}</td>
                                                <td className="px-5 py-3.5 text-right space-x-2">
                                                    <button onClick={() => { setEditStatus(u.subscriptionStatus); setEditDays(0); setEditingUser(u); }} className={`text-xs ${T.editBtn} px-3 py-1.5 rounded transition-colors`}>{t('admin.edit_status')}</button>
                                                    <button onClick={() => toggleBanUser(u)} className={`text-xs px-3 py-1.5 rounded transition-colors ${u.banned ? T.unbanBtn : T.banBtn}`}>
                                                        {u.banned ? t('admin.unban', '解封') : t('admin.ban', '封禁')}
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {(!users || users.length === 0) && !usersLoading && (
                                    <div className={`py-16 text-center ${T.t5} text-sm`}>{t('admin.no_users_found')}</div>
                                )}
                            </div>
                            <Pagination page={usersPage} total={usersTotalPages} onPrev={() => setUsersPage(p => p - 1)} onNext={() => setUsersPage(p => p + 1)} />
                        </div>
                    )}

                    {/* =========== Orders Tab =========== */}
                    {activeTab === 'orders' && (
                        <div className="space-y-6">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h1 className={`text-2xl font-semibold ${T.t1}`}>{t('admin.orders_title')}</h1>
                                    <p className={`text-sm ${T.t3} mt-1`}>{t('admin.orders_subtitle')}</p>
                                </div>
                                <select
                                    value={statusFilter}
                                    onChange={e => { setStatusFilter(e.target.value); setOrdersPage(1); }}
                                    className={`rounded-lg px-4 py-2 text-sm ${T.select}`}
                                >
                                    <option value="">{t('admin.status_all')}</option>
                                    {['PAID', 'PENDING', 'REFUNDING', 'REFUNDED', 'FAILED', 'EXPIRED'].map(s => (
                                        <option key={s} value={s}>{getOrderStatusLabel(s, t)}</option>
                                    ))}
                                </select>
                            </div>

                            <div className={`${T.card} rounded-xl overflow-hidden relative min-h-[400px]`}>
                                {ordersLoading && (
                                    <div className={`absolute inset-0 ${T.overlay} flex items-center justify-center z-10`}>
                                        <div className={`w-5 h-5 border-2 ${T.spinner} rounded-full animate-spin`}></div>
                                    </div>
                                )}
                                <table className="w-full">
                                    <thead>
                                        <tr className={T.tableHead}>
                                            {[t('admin.time'), t('admin.user'), t('admin.order_plan'), t('admin.order_amount'), t('admin.order_status'), t('admin.action')].map((h, i) => (
                                                <th key={i} className={`px-5 py-4 ${i === 3 || i === 5 ? 'text-right' : 'text-left'} text-xs font-medium ${T.tableThText} uppercase tracking-wide`}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className={T.tableDivide}>
                                        {orders.map(o => (
                                            <tr key={o.id} className={T.tableHover}>
                                                <td className={`px-5 py-3.5 text-sm ${T.t4}`}>{formatTime(o.createdAt)}</td>
                                                <td className={`px-5 py-3.5 text-sm ${T.t1} font-medium`}>{o.user?.phone || o.user?.email || t('admin.unknown_user')}</td>
                                                <td className={`px-5 py-3.5 text-sm ${T.t4}`}>{getPlanLabel(o.planType, t)}</td>
                                                <td className={`px-5 py-3.5 text-sm ${T.t1} text-right font-mono`}>¥{formatNumber(o.amount)}</td>
                                                <td className="px-5 py-3.5">
                                                    <span className={`inline-flex text-[10px] font-bold tracking-wider px-2 py-1 rounded uppercase ${orderStatusClass(o.status)}`}>
                                                        {getOrderStatusLabel(o.status, t)}
                                                    </span>
                                                </td>
                                                <td className="px-5 py-3.5 text-right">
                                                    {o.status === 'PAID' && (
                                                        <button
                                                            onClick={() => handleAdminRefund(o)}
                                                            disabled={refundingId === o.id}
                                                            className={`text-xs ${T.refundBtn} px-3 py-1.5 rounded transition-colors disabled:opacity-40`}
                                                        >
                                                            {refundingId === o.id ? t('common.processing', '处理中...') : t('admin.refund')}
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {(!orders || orders.length === 0) && !ordersLoading && (
                                    <div className={`py-16 text-center ${T.t5} text-sm`}>{t('admin.no_orders')}</div>
                                )}
                            </div>
                            <Pagination page={ordersPage} total={ordersTotalPages} onPrev={() => setOrdersPage(p => p - 1)} onNext={() => setOrdersPage(p => p + 1)} />
                        </div>
                    )}

                    {/* =========== Settings Tab =========== */}
                    {activeTab === 'settings' && (
                        <div className="space-y-6 max-w-2xl">
                            <div>
                                <h1 className={`text-2xl font-semibold ${T.t1}`}>{t('admin.system_config')}</h1>
                                <p className={`text-sm ${T.t3} mt-1`}>{t('admin.system_config_subtitle')}</p>
                            </div>

                            <form onSubmit={handleConfigSave} className={`${T.card} rounded-xl p-6`}>
                                <div className="space-y-5">
                                    {configItems.map(({ key, label }) => {
                                        const isKeyField = key.includes('KEY') || key.includes('SECRET') || key.includes('PASS') || key.includes('TOKEN') || key.includes('ID');
                                        const isVisible = visibleKeys.has(key);
                                        return (
                                            <div key={key}>
                                                <label className={`block text-xs font-medium ${T.modalLabel} mb-2`}>{label}</label>
                                                <div className="relative">
                                                    <input
                                                        type={isKeyField && !isVisible ? 'password' : 'text'}
                                                        value={configs[key] || ''}
                                                        onChange={e => setConfigs({ ...configs, [key]: e.target.value })}
                                                        placeholder={`Enter ${label}...`}
                                                        className={`w-full rounded-lg px-4 py-3 pr-10 text-sm font-mono transition-colors ${T.input}`}
                                                    />
                                                    {isKeyField && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                const next = new Set(visibleKeys);
                                                                if (next.has(key)) next.delete(key); else next.add(key);
                                                                setVisibleKeys(next);
                                                            }}
                                                            className={`absolute inset-y-0 right-0 px-3 ${T.t5} hover:${T.t3} transition-colors`}
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

                                <div className={`mt-8 pt-5 ${isDark ? 'border-t border-white/[0.06]' : 'border-t border-gray-200'} flex items-center justify-between`}>
                                    {statusMsg && (
                                        <span className={`text-sm ${statusMsg === t('admin.saved') ? 'text-green-500' : 'text-red-400'}`}>{statusMsg}</span>
                                    )}
                                    <button type="submit" className="ml-auto bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg text-sm font-medium transition-colors">
                                        {t('admin.save_config')}
                                    </button>
                                </div>
                            </form>
                        </div>
                    )}
                </div>
            </div>

            {/* Edit User Modal */}
            {editingUser && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                    <div className={`${T.modal} rounded-2xl w-full max-w-md shadow-2xl p-6 relative`}>
                        <button onClick={() => setEditingUser(null)} className={`absolute top-4 right-4 ${T.modalClose}`}>
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                        <h3 className={`text-lg font-bold ${T.t1} mb-1`}>{t('admin.edit_user')}</h3>
                        <p className={`text-sm ${T.t3} mb-6`}>{editingUser.phone || editingUser.email || editingUser.id}</p>

                        <div className="space-y-4 mb-6">
                            <div>
                                <label className={`block text-xs ${T.modalLabel} mb-2`}>{t('admin.subscription_tier')}</label>
                                <select className={`w-full rounded-lg px-3 py-2 text-sm focus:outline-none ${T.modalInput}`} value={editStatus} onChange={e => setEditStatus(e.target.value)}>
                                    <option value="FREE">{t('admin.tier_free_label')}</option>
                                    <option value="PLUS">{t('admin.tier_plus_label')}</option>
                                    <option value="PRO">{t('admin.tier_pro_label')}</option>
                                    <option value="ULTRA">{t('admin.tier_ultra_label')}</option>
                                </select>
                            </div>

                            {editStatus !== 'FREE' && (
                                <div>
                                    <label className={`block text-xs ${T.modalLabel} mb-2`}>{t('admin.add_days')}</label>
                                    <input
                                        type="number"
                                        value={editDays}
                                        onChange={e => setEditDays(Number(e.target.value))}
                                        className={`w-full rounded-lg px-3 py-2 text-sm focus:outline-none ${T.modalInput}`}
                                        placeholder={t('admin.add_days_placeholder')}
                                    />
                                    <p className={`text-[11px] ${T.t5} mt-1`}>{t('admin.add_days_hint')}</p>
                                </div>
                            )}
                        </div>

                        <div className="flex items-center justify-end gap-3">
                            {editSaveResult === 'success' && <span className="text-sm text-green-500">{t('admin.saved')}</span>}
                            {editSaveResult === 'error'   && <span className="text-sm text-red-400">{t('admin.save_error')}</span>}
                            <button onClick={() => { setEditingUser(null); setEditSaveResult(null); }} className={`px-4 py-2 text-sm ${T.t4} hover:${T.t1}`}>{t('admin.cancel')}</button>
                            <button onClick={saveUserEdit} disabled={editSaveResult === 'success'} className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg">{t('admin.confirm_edit')}</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
