import React, { useEffect, useState } from 'react';
import { getUserOrders, requestRefund } from '../services/backendApiService';
import { useConfirmDialog } from './ConfirmDialog';
import { useAuth } from '../contexts/AuthContext';
import { useTranslation } from 'react-i18next';

interface Order {
  id: string;
  amount: number;
  currency: string;
  planType: string;
  status: string;
  createdAt: string;
}

export function OrderHistory() {
  const { t } = useTranslation();
  const { confirm, ConfirmDialogComponent } = useConfirmDialog();
  const { refreshUser } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refundingId, setRefundingId] = useState<string | null>(null);

  useEffect(() => {
    loadOrders();
  }, []);

  const loadOrders = async () => {
    try {
      setLoading(true);
      const data = await getUserOrders();
      setOrders(data);
    } catch (err: any) {
      setError(t('profile.fetch_order_failed'));
    } finally {
      setLoading(false);
    }
  };

  const handleRefund = async (order: Order) => {
    if (refundingId) return;
    const ok = await confirm(t('profile.refund_warning'), {
      title: t('profile.request_refund'),
      variant: 'danger',
    });
    if (!ok) return;

    setRefundingId(order.id);
    setError('');
    try {
      await requestRefund(order.id);
      // 不让"刷新用户"或"重载订单"的失败影响主流程 — 退款本身已成功
      try { await refreshUser(); } catch (e) { console.warn('refreshUser after refund failed', e); }
      try { await loadOrders(); } catch (e) { console.warn('reloadOrders after refund failed', e); }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : t('errors.refund_failed', '退款失败');
      setError(msg);
    } finally {
      setRefundingId(null);
    }
  };

  if (loading) return <div className="order-state">{t('profile.loading')}</div>;
  if (error) return <div className="order-state is-error">{error}</div>;
  if (orders.length === 0) return <div className="order-state">{t('profile.no_order_history')}</div>;

  const formatStatus = (status: string): string => {
    switch (status) {
      case 'PAID': return t('profile.paid');
      case 'PENDING': return t('profile.pending');
      case 'REFUNDING': return t('profile.refunding', 'Refunding');
      case 'REFUNDED': return t('profile.refunded', 'Refunded');
      case 'EXPIRED': return t('profile.expired', 'Expired');
      default: return t('profile.failed');
    }
  };

  return (
    <div className="order-history">
      {ConfirmDialogComponent}
      <h3>{t('profile.tab_orders')}</h3>
      {error && <div className="inline-error">{error}</div>}
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>{t('profile.time')}</th>
              <th>{t('profile.item')}</th>
              <th>{t('profile.amount')}</th>
              <th>{t('profile.status')}</th>
              <th>{t('profile.action', '操作')}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(order => (
              <tr key={order.id}>
                <td>{new Date(order.createdAt).toLocaleDateString()}</td>
                <td>{order.planType.includes('monthly') ? t('profile.monthly_plan') : t('profile.yearly_plan')}</td>
                <td>
                  {order.currency.toUpperCase()} {order.amount}
                </td>
                <td>
                  <span className={`status ${order.status.toLowerCase()}`}>
                    {formatStatus(order.status)}
                  </span>
                </td>
                <td>
                  {order.status === 'PAID' && (
                    <button
                      className="refund-btn"
                      disabled={refundingId === order.id}
                      onClick={() => handleRefund(order)}
                      title={t('profile.request_refund')}
                    >
                      {refundingId === order.id ? t('common.processing', '处理中...') : t('profile.request_refund')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style>{`
        .order-history {
          color: var(--df-text);
        }
        
        .order-history h3 {
          font-size: 1.1rem;
          margin-bottom: 1rem;
          color: var(--df-text);
        }

        .table-container {
          width: 100%;
          overflow-x: auto;
          border: 1px solid var(--df-border);
          border-radius: 0.75rem;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.9rem;
        }

        th {
          text-align: left;
          padding: 0.75rem;
          background: var(--df-soft);
          color: var(--df-text-muted);
          font-weight: 500;
          border-bottom: 1px solid var(--df-border);
        }

        td {
          padding: 0.75rem;
          border-bottom: 1px solid var(--df-border);
          color: var(--df-text-muted);
        }

        tr:last-child td {
          border-bottom: 0;
        }

        .status {
          padding: 2px 8px;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 500;
        }

        .status.paid {
          background: var(--df-admin-soft);
          color: var(--df-admin);
        }

        .status.pending {
          background: rgba(245, 158, 11, 0.14);
          color: #d97706;
        }

        .status.failed,
        .status.expired {
          background: rgba(239, 68, 68, 0.14);
          color: #dc2626;
        }

        .status.refunding {
          background: rgba(245, 158, 11, 0.14);
          color: #d97706;
        }

        .status.refunded {
          background: var(--df-paid-soft);
          color: var(--df-paid);
        }

        .refund-btn {
          padding: 4px 12px;
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--df-text-muted);
          background: var(--df-soft);
          border: 1px solid var(--df-border);
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.15s;
        }

        .refund-btn:hover:not(:disabled) {
          color: #dc2626;
          border-color: rgba(220, 38, 38, 0.24);
          background: rgba(220, 38, 38, 0.08);
        }

        .refund-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .inline-error {
          padding: 0.5rem 0.75rem;
          margin-bottom: 0.75rem;
          background: rgba(220, 38, 38, 0.08);
          border: 1px solid rgba(220, 38, 38, 0.22);
          color: #dc2626;
          border-radius: 6px;
          font-size: 0.8rem;
        }

        .order-state {
          padding: 2rem;
          text-align: center;
          color: var(--df-text-muted);
        }

        .order-state.is-error {
          color: #dc2626;
        }
      `}</style>
    </div>
  );
}
