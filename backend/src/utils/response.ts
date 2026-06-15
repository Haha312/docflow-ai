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
 * 验证密码强度 (至少6位)
 */
export const isValidPassword = (password: string): boolean => {
    return password.length >= 6;
};

/**
 * 验证中国大陆手机号格式 (1 开头,第二位 3-9,共 11 位)
 */
export const isValidPhone = (phone: string): boolean => {
    return /^1[3-9]\d{9}$/.test(phone);
};
