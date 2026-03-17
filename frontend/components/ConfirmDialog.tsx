import React from 'react';
import { useTranslation } from 'react-i18next';

interface ConfirmDialogProps {
    isOpen: boolean;
    title?: string;
    message: string;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
    onCancel: () => void;
    variant?: 'danger' | 'warning' | 'info';
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
    isOpen,
    title,
    message,
    confirmText,
    cancelText,
    onConfirm,
    onCancel,
    variant = 'warning'
}) => {
    const { t } = useTranslation();
    const finalConfirmText = confirmText || t('common.confirm', '确定');
    const finalCancelText = cancelText || t('common.cancel', '取消');

    if (!isOpen) return null;

    const variantStyles = {
        danger: {
            icon: '⚠️',
            iconBg: 'bg-red-500/10',
            iconColor: 'text-red-500',
            confirmBtn: 'bg-red-500 hover:bg-red-600 focus:ring-red-500/50'
        },
        warning: {
            icon: '⚠️',
            iconBg: 'bg-amber-500/10',
            iconColor: 'text-amber-500',
            confirmBtn: 'bg-amber-500 hover:bg-amber-600 focus:ring-amber-500/50'
        },
        info: {
            icon: 'ℹ️',
            iconBg: 'bg-blue-500/10',
            iconColor: 'text-blue-500',
            confirmBtn: 'bg-blue-500 hover:bg-blue-600 focus:ring-blue-500/50'
        }
    };

    const style = variantStyles[variant];

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onCancel}
            />

            {/* Dialog */}
            <div className="relative bg-white border border-gray-200 rounded-2xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
                {/* Header with Icon */}
                <div className="flex items-start gap-4 p-6 pb-4">
                    <div className={`flex-shrink-0 w-12 h-12 rounded-xl ${style.iconBg} flex items-center justify-center text-2xl`}>
                        {style.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                        {title && (
                            <h3 className="text-lg font-semibold text-gray-900 mb-1">
                                {title}
                            </h3>
                        )}
                        <p className="text-sm text-gray-600 leading-relaxed">
                            {message}
                        </p>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 px-6 pb-6 pt-2">
                    <button
                        onClick={onCancel}
                        className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 border border-gray-200 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-gray-300"
                    >
                        {finalCancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-white ${style.confirmBtn} transition-all duration-200 focus:outline-none focus:ring-2 shadow-lg`}
                    >
                        {finalConfirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};

// Hook for easier usage
export const useConfirmDialog = () => {
    const [dialogState, setDialogState] = React.useState<{
        isOpen: boolean;
        title?: string;
        message: string;
        variant?: 'danger' | 'warning' | 'info';
        onConfirm: () => void;
    }>({
        isOpen: false,
        message: '',
        onConfirm: () => { }
    });

    const confirm = React.useCallback((
        message: string,
        options?: {
            title?: string;
            variant?: 'danger' | 'warning' | 'info';
        }
    ): Promise<boolean> => {
        return new Promise((resolve) => {
            setDialogState({
                isOpen: true,
                message,
                title: options?.title,
                variant: options?.variant || 'warning',
                onConfirm: () => {
                    setDialogState(prev => ({ ...prev, isOpen: false }));
                    resolve(true);
                }
            });
        });
    }, []);

    const handleCancel = React.useCallback(() => {
        setDialogState(prev => ({ ...prev, isOpen: false }));
    }, []);

    const ConfirmDialogComponent = React.useMemo(() => (
        <ConfirmDialog
            isOpen={dialogState.isOpen}
            title={dialogState.title}
            message={dialogState.message}
            variant={dialogState.variant}
            onConfirm={dialogState.onConfirm}
            onCancel={handleCancel}
        />
    ), [dialogState, handleCancel]);

    return { confirm, ConfirmDialogComponent };
};
