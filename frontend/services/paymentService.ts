// 支付服务
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
import { authService } from './authService';

export interface CreateCheckoutRequest {
    planType: string;
    paymentMethod?: 'stripe' | 'alipay';
}

export interface CheckoutResponse {
    paymentMethod: 'stripe' | 'alipay';
    sessionId?: string;
    orderId?: string;
    url?: string;
    qrCode?: string;
    isMock?: boolean;
}

class PaymentService {
    // 创建支付会话
    async createCheckoutSession(
        planType: string,
        paymentMethod: 'stripe' | 'alipay' = 'alipay'
    ): Promise<CheckoutResponse> {
        const token = authService.getToken();
        if (!token) {
            throw new Error('请先登录');
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
            throw new Error(data.message || '创建支付会话失败');
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
        const data = await response.json();
        return data.data?.status || 'PENDING';
    }

    // 跳转到支付页面 (Legacy support for Stripe)
    async redirectToCheckout(planType: string, paymentMethod: 'stripe' | 'alipay' = 'alipay'): Promise<CheckoutResponse> {
        const checkout = await this.createCheckoutSession(planType, paymentMethod);
        if (checkout.url && paymentMethod === 'stripe') {
            window.location.href = checkout.url;
        }
        return checkout;
    }
}

export const paymentService = new PaymentService();
