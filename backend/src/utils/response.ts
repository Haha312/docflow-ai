import { ApiResponse } from '../types';

/**
 * 统一的成功响应格式
 */
export const successResponse = <T>(data: T, message: string = 'Success'): ApiResponse<T> => {
    return {
        code: 200,
        data,
        message
    };
};

/**
 * 统一的错误响应格式
 */
export const errorResponse = (message: string, code: number = 500): ApiResponse => {
    return {
        code,
        message
    };
};

/**
 * 验证邮箱格式
 */
export const isValidEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

/**
 * 验证密码强度: 至少 8 位,且至少包含字母 + 数字两类字符。
 * 长度上限 128 防止 bcrypt 截断带来的混淆。
 */
export const isValidPassword = (password: string): boolean => {
    if (typeof password !== 'string') return false;
    if (password.length < 8 || password.length > 128) return false;
    const hasLetter = /[A-Za-z]/.test(password);
    const hasDigit = /\d/.test(password);
    return hasLetter && hasDigit;
};
