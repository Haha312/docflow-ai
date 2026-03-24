// 支付服务
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
import { authService } from './authService';
import i18n from '../i18n';

export interface CreateCheckoutRequest {
    planType: string;
    paymentMethod?: 'alipay' | 'wechat' | 'qrcode';
}

export interface CheckoutResponse {
    paymentMethod: 'alipay' | 'wechat' | 'qrcode';
    orderId?: string;
    qrCode?: string;
    amount?: number;
    alipayQrUrl?: string;
    wechatQrUrl?: string;
    isMock?: boolean;
}

class PaymentService {
    // 创建支付会话
    async createCheckoutSession(
        planType: string,
        paymentMethod: 'alipay' | 'wechat' = 'alipay'
    ): Promise<CheckoutResponse> {
        const token = authService.getToken();
        if (!token) {
            throw new Error(i18n.t('home.login_first', '请先登录'));
        }

        const response = await fetch(`${API_BASE_URL}/api/payment/create-checkout-session`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ planType, paymentMethod }),
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.message || i18n.t('pricing.checkout_failed', '创建支付会话失败'));
        }

        return data.data;
    }

    // 检查支付状态
    async checkPaymentStatus(orderId: string): Promise<'PENDING' | 'PAID' | 'CANCELLED'> {
        const token = authService.getToken();
        const response = await fetch(`${API_BASE_URL}/api/payment/status/${orderId}`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        if (!response.ok) {
            throw new Error(`Payment status check failed: ${response.status}`);
        }
        const data = await response.json();
        return data.data?.status || 'PENDING';
    }
}

export const paymentService = new PaymentService();
