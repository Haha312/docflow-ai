import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { paymentService } from '../services/paymentService';

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type PaymentMethod = 'alipay' | 'stripe';
type BillingCycle = 'monthly' | 'yearly';
type Tier = 'pro' | 'team';

export function PricingModal({ isOpen, onClose }: PricingModalProps) {
  const { user } = useAuth();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('yearly');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('alipay');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const lang = navigator.language;
      const isChina = lang === 'zh-CN' || timeZone.includes('Shanghai') || timeZone.includes('Beijing');
      setPaymentMethod(isChina ? 'alipay' : 'stripe');
    }
  }, [isOpen]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!isOpen) return null;

  const handleSubscribe = async (tier: Tier) => {
    setError('');
    setIsLoading(true);
    const planKey = `${tier}_${billingCycle}`;
    try {
      await paymentService.redirectToCheckout(planKey as any, paymentMethod);
    } catch (err: any) {
      setError(err.message || '创建支付失败,请重试');
      setIsLoading(false);
    }
  };

  const isAlipay = paymentMethod === 'alipay';
  const currency = isAlipay ? 'CNY' : 'USD';
  const symbol = isAlipay ? '¥' : '$';

  const pricingData = {
    pro: {
      title: 'Pro',
      monthly: { CNY: 29, USD: 3.99 },
      yearly: { CNY: 298, USD: 39.99 },
      quota: '50次/月',
      features: ['50 次生成/月', '无水印', '自定义模板', '优先处理']
    },
    team: {
      title: '团队版',
      monthly: { CNY: 199, USD: 26.99 },
      yearly: { CNY: 1999, USD: 269.99 },
      quota: '500次/月',
      features: ['500 次生成/月', '批量处理', 'API 接口', '专属客服']
    }
  };

  const tiers: Tier[] = ['pro', 'team'];
  const getPrice = (tier: Tier) => pricingData[tier][billingCycle][currency];

  const paymentOptions = [
    { id: 'alipay', label: '支付宝' },
    { id: 'stripe', label: '信用卡' }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative z-10 w-full max-w-2xl mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-8 pt-8 pb-6 border-b border-gray-100">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>

          <h2 className="text-xl font-semibold text-gray-900 text-center">升级套餐</h2>
          <p className="text-sm text-gray-500 text-center mt-1">解锁更多生成次数</p>

          {/* Controls */}
          <div className="flex items-center justify-center gap-4 mt-6">
            {/* Payment Method */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="flex items-center gap-2 px-4 py-2 bg-gray-100 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
              >
                {paymentOptions.find(p => p.id === paymentMethod)?.label}
                <svg className={`w-4 h-4 transition-transform ${isDropdownOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>
              {isDropdownOpen && (
                <div className="absolute top-full mt-1 left-0 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden z-10">
                  {paymentOptions.map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => { setPaymentMethod(opt.id as any); setIsDropdownOpen(false); }}
                      className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 ${paymentMethod === opt.id ? 'bg-gray-50 font-medium' : ''}`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Billing Toggle */}
            <div className="flex bg-gray-100 rounded-lg p-1">
              <button
                onClick={() => setBillingCycle('monthly')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${billingCycle === 'monthly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                  }`}
              >
                月付
              </button>
              <button
                onClick={() => setBillingCycle('yearly')}
                className={`px-4 py-2 text-sm font-medium rounded-md transition-colors flex items-center gap-1.5 ${billingCycle === 'yearly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                  }`}
              >
                年付
                <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">省15%</span>
              </button>
            </div>
          </div>
        </div>

        {/* Pricing Cards */}
        <div className="p-8">
          <div className="grid grid-cols-2 gap-6">
            {tiers.map(tier => {
              const data = pricingData[tier];
              const price = getPrice(tier);
              const isTeam = tier === 'team';

              return (
                <div
                  key={tier}
                  className={`relative rounded-2xl p-6 flex flex-col ${isTeam
                      ? 'bg-gray-900 text-white'
                      : 'bg-white border-2 border-gray-900'
                    }`}
                >
                  {isTeam && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gray-700 text-white text-xs font-medium px-3 py-1 rounded-full">
                      推荐
                    </div>
                  )}

                  <h3 className={`text-lg font-semibold ${isTeam ? 'text-white' : 'text-gray-900'}`}>
                    {data.title}
                  </h3>

                  <p className={`text-sm mt-1 ${isTeam ? 'text-gray-400' : 'text-gray-500'}`}>
                    {data.quota}
                  </p>

                  <div className="mt-4 flex items-baseline">
                    <span className={`text-3xl font-bold ${isTeam ? 'text-white' : 'text-gray-900'}`}>
                      {symbol}{price}
                    </span>
                    <span className={`text-sm ml-1 ${isTeam ? 'text-gray-400' : 'text-gray-500'}`}>
                      /{billingCycle === 'yearly' ? '年' : '月'}
                    </span>
                  </div>

                  {billingCycle === 'yearly' && (
                    <p className={`text-xs mt-1 ${isTeam ? 'text-gray-400' : 'text-gray-500'}`}>
                      约 {symbol}{Math.round(price / 12)}/月
                    </p>
                  )}

                  <ul className="mt-6 space-y-3 flex-1">
                    {data.features.map((f, i) => (
                      <li key={i} className={`text-sm flex items-center gap-2 ${isTeam ? 'text-gray-300' : 'text-gray-600'}`}>
                        <svg className={`w-4 h-4 flex-shrink-0 ${isTeam ? 'text-white' : 'text-gray-900'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <polyline points="20 6 9 17 4 12"></polyline>
                        </svg>
                        {f}
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() => handleSubscribe(tier)}
                    disabled={isLoading}
                    className={`mt-6 w-full py-3 rounded-xl text-sm font-medium transition-colors ${isTeam
                        ? 'bg-white text-gray-900 hover:bg-gray-100'
                        : 'bg-gray-900 text-white hover:bg-gray-800'
                      } disabled:opacity-50`}
                  >
                    {isLoading ? '处理中...' : '立即订阅'}
                  </button>
                </div>
              );
            })}
          </div>

          {error && (
            <div className="mt-6 p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm text-center">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
