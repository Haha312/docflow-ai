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

const WarningIcon = ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
);

const DangerIcon = ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="15" y1="9" x2="9" y2="15" />
        <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
);

const InfoIcon = ({ className }: { className?: string }) => (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
);

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
            Icon: DangerIcon,
            iconBg: 'bg-red-50',
            iconColor: 'text-red-500',
            confirmBtn: 'bg-red-500 hover:bg-red-600 shadow-lg shadow-red-100 hover:shadow-red-200'
        },
        warning: {
            Icon: WarningIcon,
            iconBg: 'bg-amber-50',
            iconColor: 'text-amber-500',
            confirmBtn: 'bg-amber-500 hover:bg-amber-600 shadow-lg shadow-amber-100 hover:shadow-amber-200'
        },
        info: {
            Icon: InfoIcon,
            iconBg: 'bg-blue-50',
            iconColor: 'text-blue-500',
            confirmBtn: 'bg-blue-600 hover:bg-blue-700 shadow-lg shadow-blue-100 hover:shadow-blue-200'
        }
    };

    const style = variantStyles[variant];
    const { Icon } = style;

    return (
        <div className="prism-modal confirm-modal fixed inset-0 z-50 flex items-center justify-center animate-in fade-in duration-200">
            {/* Backdrop */}
            <button
                type="button"
                className="modal-backdrop absolute inset-0"
                onClick={onCancel}
                aria-label={finalCancelText}
            />

            {/* Dialog */}
            <div className="confirm-panel modal-surface relative rounded-3xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden animate-in zoom-in-95 fade-in duration-200">
                {/* Body */}
                <div className="flex items-start gap-4 px-6 pt-6 pb-4">
                    <div className={`flex-shrink-0 w-11 h-11 rounded-2xl ${style.iconBg} flex items-center justify-center`}>
                        <Icon className={`w-5 h-5 ${style.iconColor}`} />
                    </div>
                    <div className="flex-1 min-w-0 pt-0.5">
                        {title && (
                            <h3 className="text-base font-bold text-gray-900 mb-1 tracking-tight">
                                {title}
                            </h3>
                        )}
                        <p className="text-sm text-gray-500 leading-relaxed">
                            {message}
                        </p>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-3 px-6 pb-6 pt-3">
                    <button
                        onClick={onCancel}
                        className="modal-secondary flex-1 px-4 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 active:scale-[0.98]"
                    >
                        {finalCancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`flex-1 px-4 py-2.5 rounded-xl text-sm font-bold text-white ${style.confirmBtn} transition-all duration-200 active:scale-[0.98]`}
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
