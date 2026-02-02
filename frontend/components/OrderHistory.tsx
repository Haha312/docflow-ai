import React, { useEffect, useState } from 'react';
import { getUserOrders } from '../services/backendApiService';

interface Order {
    id: string;
    amount: number;
    currency: string;
    planType: string;
    status: string;
    createdAt: string;
}

export function OrderHistory() {
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
            setError('无法获取订单历史');
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="loading">加载中...</div>;
    if (error) return <div className="error">{error}</div>;
    if (orders.length === 0) return <div className="empty">暂无订单记录</div>;

    return (
        <div className="order-history">
            <h3>订单历史</h3>
            <div className="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>时间</th>
                            <th>项目</th>
                            <th>金额</th>
                            <th>状态</th>
                        </tr>
                    </thead>
                    <tbody>
                        {orders.map(order => (
                            <tr key={order.id}>
                                <td>{new Date(order.createdAt).toLocaleDateString()}</td>
                                <td>{order.planType === 'monthly' ? '月度会员' : '年度会员'}</td>
                                <td>
                                    {order.currency.toUpperCase()} {order.amount}
                                </td>
                                <td>
                                    <span className={`status ${order.status.toLowerCase()}`}>
                                        {order.status === 'PAID' ? '已支付' :
                                            order.status === 'PENDING' ? '待支付' : '失败'}
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
