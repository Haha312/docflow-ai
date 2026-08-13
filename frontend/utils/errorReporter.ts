/**
 * 前端错误上报:未捕获异常 / 未处理的 Promise 拒绝 / React 渲染崩溃(由 ErrorBoundary 调用)。
 *
 * 约束:
 *  - 同一条错误一个会话只报一次(SPA 里渲染错误会反复触发,不去重就是自我 DDoS);
 *  - fire-and-forget,上报本身出错绝不再抛(报错通道不能反过来砸正常功能);
 *  - 只报站内脚本的错误:浏览器插件注入脚本的报错(跨源 'Script error.')没有诊断价值。
 */

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const seen = new Set<string>();
const MAX_REPORTS_PER_SESSION = 20;

export const reportClientError = (message: string, stack?: string, context?: string): void => {
    try {
        const key = message.slice(0, 200);
        if (seen.has(key) || seen.size >= MAX_REPORTS_PER_SESSION) return;
        seen.add(key);
        void fetch(`${API_BASE_URL}/api/client-log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message.slice(0, 2000),
                stack: (stack || '').slice(0, 2000),
                url: window.location.href,
                userAgent: navigator.userAgent,
                context: (context || '').slice(0, 500),
            }),
            keepalive: true,   // 页面卸载途中也尽量送达
        }).catch(() => { /* 上报失败就算了 */ });
    } catch { /* 同上 */ }
};

export const installErrorReporter = (): void => {
    window.addEventListener('error', (e) => {
        // 跨源脚本(浏览器插件等)只给 'Script error.',无诊断价值
        if (e.message === 'Script error.' && !e.filename) return;
        reportClientError(e.message || 'unknown error', e.error?.stack, `${e.filename}:${e.lineno}`);
    });
    window.addEventListener('unhandledrejection', (e) => {
        const r = e.reason;
        reportClientError(
            r?.message || String(r ?? 'unhandled rejection'),
            r?.stack,
            'unhandledrejection',
        );
    });
};
