// 认证服务
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface User {
    id: string;
    email: string;
    subscriptionStatus: 'FREE' | 'PLUS' | 'PRO' | 'ULTRA';
    subscriptionEndDate?: string;
}

export interface AuthResponse {
    token: string;
    user: User;
}

export interface UserInfoResponse {
    user: User;
    remainingQuota: number;
}

class AuthService {
    private readonly TOKEN_KEY = 'docuflow_auth_token';

    // 获取存储的 token
    getToken(): string | null {
        return localStorage.getItem(this.TOKEN_KEY);
    }

    // 保存 token
    setToken(token: string): void {
        localStorage.setItem(this.TOKEN_KEY, token);
    }

    // 清除 token
    clearToken(): void {
        localStorage.removeItem(this.TOKEN_KEY);
    }

    // 检查是否已登录
    isAuthenticated(): boolean {
        return !!this.getToken();
    }

    // 获取图形验证码
    async getCaptcha(): Promise<{ image: string; sessionId: string }> {
        const response = await fetch(`${API_BASE_URL}/api/auth/captcha`);
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || '获取验证码失败');
        }
        return data.data;
    }

    // 发送邮箱验证码
    async sendEmailCode(email: string, captcha: string, sessionId: string): Promise<void> {
        const response = await fetch(`${API_BASE_URL}/api/auth/send-verify-code`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, captcha, sessionId }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || '验证码发送失败');
        }
    }

    // 用户注册
    async register(email: string, password: string, code: string): Promise<User> {
        const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password, code }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || '注册失败');
        }

        return data.data;
    }

    // 用户登录
    async login(email: string, password: string): Promise<AuthResponse> {
        const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email, password }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || '登录失败');
        }

        // 保存 token
        this.setToken(data.data.token);

        return data.data;
    }

    // 登出
    logout(): void {
        this.clearToken();
    }

    // 获取当前用户信息
    async getCurrentUser(): Promise<UserInfoResponse> {
        const token = this.getToken();
        if (!token) {
            throw new Error('未登录');
        }

        const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
            headers: {
                'Authorization': `Bearer ${token}`,
            },
        });

        const data = await response.json();

        if (!response.ok) {
            // Token 过期或无效,清除本地 token
            if (response.status === 401) {
                this.clearToken();
            }
            throw new Error(data.message || '获取用户信息失败');
        }

        return data.data;
    }
}

export const authService = new AuthService();
