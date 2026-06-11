// TypeScript 类型定义
import { Request } from 'express';

// 扩展 Express Request 类型,添加用户信息
export interface AuthRequest extends Request {
    user?: {
        id: string;
        email: string;
        subscriptionStatus: 'FREE' | 'PLUS' | 'PRO' | 'ULTRA';
        subscriptionEndDate?: Date | null;
        quotaPeriodStart?: Date | null;
        role?: string;
    };
}

// 文档预设类型 (与前端保持一致)
export enum DocPreset {
    CORPORATE = 'corporate',
    ACADEMIC = 'academic',
    ACADEMIC_JOURNAL = 'academic-journal',
    CREATIVE = 'creative',
    MINIMALIST = 'minimalist'
}

// 样式配置接口 (与前端保持一致)
export interface StyleConfig {
    fontFamily: string;
    baseSize: string;
    lineHeight: string;
    headingFont: string;
    headingNumbering: string;
    bodyAlign: string;
    textIndent: string;
    spacingBefore: string;
    spacingAfter: string;
    h1Font?: string;
    h1Size: string;
    h1Bold: boolean;
    h1Italic: boolean;
    h1Align: string;
    h1Indent: string;
    h2Font?: string;
    h2Size: string;
    h2Bold: boolean;
    h2Italic: boolean;
    h2Align: string;
    h2Indent: string;
    h3Font?: string;
    h3Size: string;
    h3Bold: boolean;
    h3Italic: boolean;
    h3Indent: string;
    h4Font?: string;
    h4Size: string;
    h4Bold: boolean;
    h4Italic: boolean;
    h4Indent: string;
    tableFont: string;
    tableSize: string;
    tableCaptionFont: string;
    tableCaptionSize: string;
    tableCaptionAlign: string;
    tableNumbering: string;
    figureFont: string;
    figureSize: string;
    figureNumbering: string;
    columns?: number;
    englishTitleFont?: string;
    englishTitleSize?: string;
    authorFont?: string;
    authorSize?: string;
    affiliationFont?: string;
    affiliationSize?: string;
}

// API 响应格式
export interface ApiResponse<T = any> {
    code: number;
    data?: T;
    message: string;
}

// 用户注册请求
export interface RegisterRequest {
    email: string;
    password: string;
}

// 用户登录请求
export interface LoginRequest {
    email: string;
    password: string;
}

// 文档生成请求
export interface GenerateRequest {
    content: string;
    preset: DocPreset;
    fileName: string;
    styleConfig: StyleConfig;
    model?: string;
}

// 支付请求
export interface CreateCheckoutRequest {
    planType: string;
    paymentMethod?: 'alipay' | 'wechat' | 'qrcode';
}

// JWT Payload
export interface JwtPayload {
    userId: string;
    email: string;
}
