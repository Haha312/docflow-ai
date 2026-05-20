// 认证服务
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
import i18n from '../i18n';

/**
 * 翻译后端返回的错误码为用户可读消息
 * 后端现在返回结构化错误码 (如 AUTH_INVALID_CREDENTIALS)
 * 前端通过 i18n 映射为当前语言的错误消息
 */
export function translateBackendError(message: string): string {
    const key = `backend_errors.${message}`;
    const translated = i18n.t(key);
    // 如果 i18n 找不到翻译, 会返回 key 本身, 此时使用原始消息
    return translated === key ? message : translated;
}

export interface User {
    id: string;
    email: string;
    subscriptionStatus: 'FREE' | 'PLUS' | 'PRO' | 'ULTRA';
    subscriptionEndDate?: string;
    isAdmin?: boolean;
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
            throw new Error(data.message || i18n.t('errors.fetch_captcha_failed', '获取验证码失败'));
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
            throw new Error(data.message || i18n.t('errors.send_captcha_failed', '验证码发送失败'));
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
            throw new Error(data.message || i18n.t('errors.register_failed', '注册失败'));
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
            throw new Error(data.message || i18n.t('errors.login_failed', '登录失败'));
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
            throw new Error(i18n.t('errors.not_logged_in', '未登录'));
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
            throw new Error(data.message || i18n.t('errors.fetch_user_failed', '获取用户信息失败'));
        }

        return data.data;
    }
}

export const authService = new AuthService();
