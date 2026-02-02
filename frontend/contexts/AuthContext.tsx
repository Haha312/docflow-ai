import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { authService, User, UserInfoResponse } from '../services/authService';

interface AuthContextType {
    user: User | null;
    remainingQuota: number;
    isLoading: boolean;
    isAuthenticated: boolean;
    login: (email: string, password: string) => Promise<void>;
    register: (email: string, password: string) => Promise<void>;
    logout: () => void;
    refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [remainingQuota, setRemainingQuota] = useState<number>(0);
    const [isLoading, setIsLoading] = useState<boolean>(true);

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

    // 初始化时加载用户信息
    useEffect(() => {
        loadUser();
    }, []);

    // 登录
    const login = async (email: string, password: string) => {
        const authResponse = await authService.login(email, password);
        setUser(authResponse.user);
        // 登录后刷新用户信息获取额度
        await loadUser();
    };

    // 注册
    const register = async (email: string, password: string) => {
        await authService.register(email, password);
        // 注册后自动登录
        await login(email, password);
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
        isLoading,
        isAuthenticated: !!user,
        login,
        register,
        logout,
        refreshUser,
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
