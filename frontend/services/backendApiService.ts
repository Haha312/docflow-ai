// 后端 API 调用服务 (替换直接调用 Gemini)
import { DocPreset, StyleConfig } from '../types';
import { authService } from './authService';
import i18n from '../i18n';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export interface GenerateDocumentRequest {
    content: string;
    preset: DocPreset;
    fileName: string;
    styleConfig: StyleConfig;
}

/**
 * 调用后端 API 生成文档 (SSE 流式响应)
 * @param request 生成请求
 * @param onProgress 进度回调 (接收生成的 HTML 片段)
 * @param abortSignal 中止信号
 */
export async function generateDocumentViaBackend(
    request: GenerateDocumentRequest,
    onProgress: (html: string, progress?: any, imageMap?: Record<string, string>) => void,
    abortSignal?: AbortSignal
): Promise<string> {
    const token = authService.getToken();
    if (!token) {
        throw new Error(i18n.t('errors.login_required', '请先登录'));
    }

    const response = await fetch(`${API_BASE_URL}/api/generate`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: abortSignal,
    });

    // 检查响应状态
    if (!response.ok) {
        const data = await response.json();

        // 特殊处理额度用尽错误
        if (response.status === 403) {
            throw new Error('QUOTA_EXCEEDED');
        }

        // 特殊处理未认证错误
        if (response.status === 401) {
            authService.clearToken();
            throw new Error('LOGIN_REQUIRED');
        }

        throw new Error(data.message || i18n.t('errors.generate_failed', '文档生成失败'));
    }

    // 处理 SSE 流式响应
    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error(i18n.t('errors.cannot_read_stream', '无法读取响应流'));
    }

    const decoder = new TextDecoder();
    let fullText = '';
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop() || '';

            for (const event of events) {
                const lines = event.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const dataStr = line.substring(6);
                        try {
                            const data = JSON.parse(dataStr);

                            if (data.error) throw new Error(data.error);
                            if (data.done) return fullText;

                            // imageMap 事件 — 初始化图片映射
                            if (data.imageMap) {
                                onProgress(fullText, data.progress, data.imageMap);
                                continue;
                            }

                            // ping 事件 — 只更新进度，不改变内容
                            if (data.ping) {
                                onProgress(fullText, data.progress);
                                continue;
                            }

                            // delta — 追加内容
                            if (data.delta) {
                                fullText += data.delta;
                                onProgress(fullText, data.progress);
                            }
                            // legacy full replacement
                            else if (data.text) {
                                fullText = data.text;
                                onProgress(fullText, data.progress);
                            }
                        } catch (e) {
                            if (e instanceof SyntaxError) {
                                console.warn('SSE parse error, skipping:', dataStr.substring(0, 100));
                                continue;
                            }
                            throw e;
                        }
                    }
                }
            }
        }
        return fullText;
    } finally {
        reader.releaseLock();
    }
}

// 获取用户订单历史
export async function getUserOrders(): Promise<any[]> {
    const token = authService.getToken();
    if (!token) throw new Error(i18n.t('errors.login_required', '请先登录'));

    const response = await fetch(`${API_BASE_URL}/api/user/orders`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || i18n.t('errors.fetch_order_failed', '获取订单失败'));
    return data.data;
}

// 获取用户文档列表
export async function getUserDocuments(page = 1, pageSize = 20): Promise<{ list: any[], pagination: any }> {
    const token = authService.getToken();
    if (!token) throw new Error(i18n.t('errors.login_required', '请先登录'));

    const response = await fetch(`${API_BASE_URL}/api/documents?page=${page}&pageSize=${pageSize}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || i18n.t('errors.fetch_doc_failed', '获取文档失败'));
    return data.data;
}

// 获取文档详情
export async function getDocument(id: string): Promise<any> {
    const token = authService.getToken();
    if (!token) throw new Error(i18n.t('errors.login_required', '请先登录'));

    const response = await fetch(`${API_BASE_URL}/api/documents/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || i18n.t('errors.fetch_doc_failed', '获取文档失败'));
    return data.data;
}

// 删除文档
export async function deleteDocument(id: string): Promise<void> {
    const token = authService.getToken();
    if (!token) throw new Error(i18n.t('errors.login_required', '请先登录'));

    const response = await fetch(`${API_BASE_URL}/api/documents/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || i18n.t('errors.delete_doc_failed', '删除文档失败'));
}
