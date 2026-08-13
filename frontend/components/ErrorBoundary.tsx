import React from 'react';
import { reportClientError } from '../utils/errorReporter';

interface State { hasError: boolean }

/**
 * 渲染崩溃兜底:没有它,任何一个组件抛错整页就是白屏,用户什么都做不了也
 * 什么都报不了。这里给一个能刷新的提示页,并把错误上报到后端日志。
 */
// 注意:项目没装 @types/react(React 19 + 全函数组件,类型走的是内置推断),
// React.Component 的泛型解析不出来,这里用 declare 显式声明 props 形状。
export class ErrorBoundary extends React.Component {
    declare props: { children?: React.ReactNode };
    state: State = { hasError: false };

    static getDerivedStateFromError(): State {
        return { hasError: true };
    }

    componentDidCatch(error: Error, info: React.ErrorInfo): void {
        reportClientError(error.message, error.stack, `render:${info.componentStack?.slice(0, 300)}`);
    }

    render(): React.ReactNode {
        if (!this.state.hasError) return this.props.children;
        return (
            <div className="min-h-screen flex items-center justify-center bg-white px-6">
                <div className="text-center max-w-sm">
                    <div className="text-3xl mb-3">😵</div>
                    <h1 className="text-lg font-semibold text-gray-900 mb-2">页面出了点问题</h1>
                    <p className="text-sm text-gray-500 mb-5">错误已自动上报。刷新一般就能恢复;若反复出现,请联系我们。</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="px-5 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 transition-colors"
                    >
                        刷新页面
                    </button>
                </div>
            </div>
        );
    }
}
