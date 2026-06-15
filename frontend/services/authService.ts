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
    phone: string | null;
    email: string | null;
    isAdmin?: boolean;
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
            throw new Error(data.message || i18n.t('errors.fetch_captcha_failed', '获取验证码失败'));
        }
        return data.data;
    }

    // 发送短信验证码(需先通过图形码人机校验)。dev mock 模式后端会回传 devCode,便于本地联调。
    async sendSmsCode(phone: string, captcha: string, sessionId: string): Promise<{ devCode?: string }> {
        const response = await fetch(`${API_BASE_URL}/api/auth/send-sms-code`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, captcha, sessionId }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || i18n.t('errors.send_captcha_failed', '验证码发送失败'));
        }
        return data.data || {};
    }

    // 手机号 + 短信验证码登录(无密码,新用户自动注册)
    async loginWithSms(phone: string, code: string): Promise<AuthResponse> {
        const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, code }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || i18n.t('errors.login_failed', '登录失败'));
        }
        this.setToken(data.data.token);
        return data.data;
    }

    // 登出
    logout(): void {
        this.clearToken();
    }

    private authHeaders(): Record<string, string> {
        const token = this.getToken();
        if (!token) throw new Error(i18n.t('errors.not_logged_in', '未登录'));
        return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
    }

    // 设置/更新选填邮箱(用于接收支付收据/续费提醒;传空字符串清除)
    async setEmail(email: string): Promise<{ email: string | null }> {
        const response = await fetch(`${API_BASE_URL}/api/auth/set-email`, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify({ email }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || i18n.t('errors.set_email_failed', '邮箱保存失败'));
        return data.data;
    }

    // 换绑手机第一步:向新手机发码
    async requestPhoneChange(newPhone: string, captcha: string, sessionId: string): Promise<void> {
        const response = await fetch(`${API_BASE_URL}/api/auth/change-phone/send-code`, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify({ newPhone, captcha, sessionId }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || i18n.t('errors.change_phone_failed', '手机号修改失败'));
    }

    // 换绑手机第二步:输入新手机验证码,成功后换新 token
    async confirmPhoneChange(code: string): Promise<{ phone: string }> {
        const response = await fetch(`${API_BASE_URL}/api/auth/change-phone/confirm`, {
            method: 'POST',
            headers: this.authHeaders(),
            body: JSON.stringify({ code }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || i18n.t('errors.change_phone_failed', '手机号修改失败'));
        if (data.data?.token) this.setToken(data.data.token); // 旧 token 已失效,换新
        return data.data;
    }

    // 删除账号:无密码,仅需输 "DELETE" 字面量确认
    async deleteAccount(): Promise<void> {
        const response = await fetch(`${API_BASE_URL}/api/auth/account`, {
            method: 'DELETE',
            headers: this.authHeaders(),
            body: JSON.stringify({ confirm: 'DELETE' }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || i18n.t('errors.delete_account_failed', '账号删除失败'));
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
