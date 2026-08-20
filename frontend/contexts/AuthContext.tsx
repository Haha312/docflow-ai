import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authService, User, UserInfoResponse } from '../services/authService';

interface AuthContextType {
    user: User | null;
    remainingQuota: number;
    /** 总额度 = 档位额度 + 邀请奖励(后端算好,前端只显示总数,不做拆分) */
    quotaTotal: number;
    isLoading: boolean;
    isAuthenticated: boolean;
    /** 微信扫码失败的原因(回跳带回)。有值时首页会自动弹出登录框并展示,
        否则用户扫完码只看到页面刷新一下、毫无反应,会以为产品坏了。 */
    wechatError: string | null;
    /** 扫码绑定的回跳结果:ok / already / taken / err(用完由消费方清掉) */
    wechatBind: string | null;
    clearWechatError: () => void;
    clearWechatBind: () => void;
    login: (phone: string, code: string) => Promise<void>;
    logout: () => void;
    refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [remainingQuota, setRemainingQuota] = useState<number>(0);
    const [quotaTotal, setQuotaTotal] = useState<number>(0);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [wechatError, setWechatError] = useState<string | null>(null);
    const [wechatBind, setWechatBind] = useState<string | null>(null);

    // 加载用户信息
    const loadUser = async () => {
        if (!authService.isAuthenticated()) {
            setIsLoading(false);
            return;
        }

        try {
            const userInfo = await authService.getCurrentUser();
            setUser(userInfo.user);
            setRemainingQuota(userInfo.remainingQuota);
            setQuotaTotal(userInfo.quotaTotal ?? 0);
        } catch (error) {
            console.error('加载用户信息失败:', error);
            // Token 无效,清除登录状态
            authService.clearToken();
            setUser(null);
            setRemainingQuota(0);
        } finally {
            setIsLoading(false);
        }
    };

    // 初始化:先处理微信扫码回跳,再加载用户信息(合并成一次,避免闪一下未登录态)
    useEffect(() => {
        void (async () => {
            try {
                const params = new URLSearchParams(window.location.search);
                const ticket = params.get('wxlogin');
                const wxerr = params.get('wxerr');
                const wxbind = params.get('wxbind');
                if (ticket || wxerr || wxbind) {
                    // 无论成败都先把参数从地址栏抹掉:票是一次性的,留在 URL 里
                    // 会随刷新/分享泄漏,也会让用户看到一串没有意义的乱码
                    params.delete('wxlogin');
                    params.delete('wxerr');
                    params.delete('wxbind');
                    const q = params.toString();
                    window.history.replaceState(
                        {}, '',
                        window.location.pathname + (q ? `?${q}` : '') + window.location.hash,
                    );
                }
                if (ticket) {
                    await authService.wechatFinish(ticket);
                } else if (wxerr) {
                    console.warn('[wxlogin] 扫码登录未完成:', wxerr);
                    setWechatError(wxerr);
                }
                // 绑定回跳:登录态没变(绑定不发票),只要把结果亮给用户看
                if (wxbind) setWechatBind(wxbind);
            } catch (e) {
                console.error('微信登录失败:', e);
                // 票据过期/被用过时后端返回 400,这里也要让用户看见
                setWechatError('finish');
            }
            await loadUser();
        })();
    }, []);

    // 登录(手机号 + 短信验证码,新用户自动注册)
    const login = async (phone: string, code: string) => {
        await authService.loginWithSms(phone, code);
        await loadUser();
    };

    // 登出
    const logout = () => {
        authService.logout();
        setUser(null);
        setRemainingQuota(0);
    };

    // 刷新用户信息
    const refreshUser = async () => {
        await loadUser();
    };

    const value: AuthContextType = {
        user,
        remainingQuota,
        quotaTotal,
        isLoading,
        isAuthenticated: !!user,
        login,
        logout,
        refreshUser,
        wechatError,
        wechatBind,
        clearWechatBind: () => setWechatBind(null),
        clearWechatError: () => setWechatError(null),
    };

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}
