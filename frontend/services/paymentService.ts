// 支付服务
import { authService } from './authService';
import { API_BASE_URL } from './apiBase';
import i18n from '../i18n';

export interface CreateCheckoutRequest {
    planType: string;
    paymentMethod?: 'wechat';
}

export interface CheckoutResponse {
    paymentMethod: 'wechat';
    orderId?: string;
    qrCode?: string;
    amount?: number;
    isMock?: boolean;
}

class PaymentService {
    // 创建支付会话
    async createCheckoutSession(
        planType: string,
        paymentMethod: 'wechat' = 'wechat'
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
