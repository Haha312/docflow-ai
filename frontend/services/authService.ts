// 认证服务
import { API_BASE_URL } from './apiBase';
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
    /** 微信昵称。微信扫码注册的账号没有手机号,这是唯一能显示的名字 */
    wxNickname?: string | null;
    /** 是否已绑定微信(账号设置里据此显示「绑定 / 已绑定」) */
    hasWechat?: boolean;
    isAdmin?: boolean;
    subscriptionStatus: 'FREE' | 'PLUS' | 'PRO' | 'ULTRA';
    subscriptionEndDate?: string;
}

/**
 * 界面上「这个账号叫什么」的统一口径。
 * 优先手机号(脱敏)—— 它是账号的主标识;微信用户没有手机号时用昵称,
 * 都没有才退到「用户」。此前微信用户这里是一片空白。
 */
export const displayName = (u: Pick<User, 'phone' | 'email' | 'wxNickname'> | null | undefined): string => {
    if (!u) return '';
    if (u.phone) return `${u.phone.slice(0, 3)}****${u.phone.slice(-4)}`;
    if (u.wxNickname) return u.wxNickname;
    if (u.email) return u.email.split('@')[0];
    return '';
};

export interface AuthResponse {
    token: string;
    user: User;
}

export interface UserInfoResponse {
    user: User;
    remainingQuota: number;
    /** 总额度 = 档位额度 + 邀请奖励(后端合并好,前端只显示总数) */
    quotaTotal?: number;
    /** 通过邀请累计获得的次数,仅邀请页展示用 */
    bonusQuota?: number;
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

    // 获取图形验证码(dev 环境后端会附带 devCaptcha 明文,便于本地联调自动填)
    async getCaptcha(): Promise<{ image: string; sessionId: string; devCaptcha?: string }> {
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

    /**
     * 取邀请码。来源优先级:当前 URL 的 ?ref= > 之前存下的。
     * 存一份是因为用户点开邀请链接后往往先浏览、后登录,登录时 URL 上的参数可能已经没了。
     */
    private takeReferralCode(): string | undefined {
        try {
            const fromUrl = new URLSearchParams(window.location.search).get('ref');
            if (fromUrl) localStorage.setItem('docflow_ref', fromUrl);
            return (fromUrl || localStorage.getItem('docflow_ref') || undefined) ?? undefined;
        } catch {
            return undefined;
        }
    }

    // 手机号 + 短信验证码登录(无密码,新用户自动注册)
    async loginWithSms(phone: string, code: string): Promise<AuthResponse> {
        const ref = this.takeReferralCode();
        const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, code, ref }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || i18n.t('errors.login_failed', '登录失败'));
        }
        this.setToken(data.data.token);
        // 绑定只在首次注册时生效,用过就清掉,免得以后换号登录又被算一次
        try { localStorage.removeItem('docflow_ref'); } catch { /* 隐私模式下不可用,忽略 */ }
        return data.data;
    }

    /** 微信登录是否可用(没配凭据就不显示入口,免得用户点一个必然失败的按钮) */
    async wechatEnabled(): Promise<boolean> {
        try {
            const r = await fetch(`${API_BASE_URL}/api/auth/wechat/status`);
            if (!r.ok) return false;
            const d = await r.json();
            return !!d?.data?.enabled;
        } catch {
            return false;
        }
    }

    /** 取微信二维码页地址,内嵌 iframe 展示 —— 不把用户跳走 */
    async wechatQrUrl(): Promise<string> {
        const ref = this.takeReferralCode();
        const q = new URLSearchParams({ json: '1' });
        if (ref) q.set('ref', ref);
        const r = await fetch(`${API_BASE_URL}/api/auth/wechat/start?${q}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.message || i18n.t('errors.wechat_start_failed', '微信登录暂不可用'));
        return d.data.url as string;
    }

    /**
     * 扫码回跳后,用一次性票换正式登录态。
     * 票 60 秒有效、用后即废;正式令牌只走这条 POST 返回,不进 URL。
     */
    async wechatFinish(ticket: string): Promise<AuthResponse> {
        const response = await fetch(`${API_BASE_URL}/api/auth/wechat/finish`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ticket }),
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.message || i18n.t('errors.login_failed', '登录失败'));
        }
        this.setToken(data.data.token);
        try { localStorage.removeItem('docflow_ref'); } catch { /* 隐私模式下不可用,忽略 */ }
        return data.data;
    }

    /** 已登录用户「绑定微信」的二维码地址 —— 与登录用的是同一个页面,只是 state 里带了本人 id */
    async wechatBindQrUrl(): Promise<string> {
        const r = await fetch(`${API_BASE_URL}/api/auth/wechat/bind/start`, {
            headers: this.authHeaders(),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.message || i18n.t('errors.wechat_start_failed', '微信登录暂不可用'));
        return d.data.url as string;
    }

    /** 解绑微信。后端会拦住「解绑后无法登录」的情况,这里如实把原因抛给用户 */
    async wechatUnbind(): Promise<void> {
        const r = await fetch(`${API_BASE_URL}/api/auth/wechat/unbind`, {
            method: 'POST',
            headers: this.authHeaders(),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.message || i18n.t('errors.unknown', '操作失败'));
    }

    /** 当前用户的邀请数据(码、链接、进度、规则) */
    async getReferral(): Promise<{
        code: string; link: string; bonusQuota: number; invited: number;
        rewarded: number; pending: number; remainingBonus: number;
        rules: { bonus: number; maxBonusPerUser: number; minChars: number };
    }> {
        const response = await fetch(`${API_BASE_URL}/api/referral`, {
            headers: { Authorization: `Bearer ${this.getToken()}` },
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || '读取邀请数据失败');
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
