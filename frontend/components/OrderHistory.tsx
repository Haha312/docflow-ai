import React, { useEffect, useState } from 'react';
import { getUserOrders } from '../services/backendApiService';
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
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  if (loading) return <div className="loading">{t('profile.loading')}</div>;
  if (error) return <div className="error">{error}</div>;
  if (orders.length === 0) return <div className="empty">{t('profile.no_order_history')}</div>;

  return (
    <div className="order-history">
      <h3>{t('profile.tab_orders')}</h3>
      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>{t('profile.time')}</th>
              <th>{t('profile.item')}</th>
              <th>{t('profile.amount')}</th>
              <th>{t('profile.status')}</th>
            </tr>
          </thead>
          <tbody>
            {orders.map(order => (
              <tr key={order.id}>
                <td>{new Date(order.createdAt).toLocaleDateString()}</td>
                <td>{order.planType === 'monthly' ? t('profile.monthly_plan') : t('profile.yearly_plan')}</td>
                <td>
                  {order.currency.toUpperCase()} {order.amount}
                </td>
                <td>
                  <span className={`status ${order.status.toLowerCase()}`}>
                    {order.status === 'PAID' ? t('profile.paid') :
                      order.status === 'PENDING' ? t('profile.pending') : t('profile.failed')}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <style>{`
        .order-history {
          margin-top: 1rem;
        }
        
        h3 {
          font-size: 1.1rem;
          margin-bottom: 1rem;
          color: #333;
        }

        .table-container {
          width: 100%;
          overflow-x: auto;
        }

        table {
          width: 100%;
          border-collapse: collapse;
          font-size: 0.9rem;
        }

        th {
          text-align: left;
          padding: 0.75rem;
          background: #f9fafb;
          color: #6b7280;
          font-weight: 500;
          border-bottom: 1px solid #e5e7eb;
        }

        td {
          padding: 0.75rem;
          border-bottom: 1px solid #e5e7eb;
          color: #374151;
        }

        .status {
          padding: 2px 8px;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 500;
        }

        .status.paid {
          background: #d1fae5;
          color: #059669;
        }

        .status.pending {
          background: #fef3c7;
          color: #d97706;
        }

        .status.failed {
          background: #fee2e2;
          color: #dc2626;
        }

        .loading, .error, .empty {
          padding: 2rem;
          text-align: center;
          color: #6b7280;
        }

        .error {
          color: #dc2626;
        }
      `}</style>
    </div>
  );
}
