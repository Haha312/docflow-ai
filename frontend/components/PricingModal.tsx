
import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { paymentService } from '../services/paymentService';
import alipayLogo from '../image/Alipay.png';

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

  // New state for 2-step flow
  const [step, setStep] = useState<'plans' | 'payment'>('plans');
  const [selectedTier, setSelectedTier] = useState<Tier | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Reset state on open
      setStep('plans');
      setSelectedTier(null);

      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const lang = navigator.language;
      const isChina = lang === 'zh-CN' || timeZone.includes('Shanghai') || timeZone.includes('Beijing');
      setPaymentMethod(isChina ? 'alipay' : 'stripe');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handlePlanSelect = (tier: Tier) => {
    setSelectedTier(tier);
    setStep('payment');
  };

  const handleFinalPay = async (method: PaymentMethod) => {
    if (!selectedTier) return;
    setError('');
    setIsLoading(true);
    const planKey = `${selectedTier}_${billingCycle}`;
    try {
      await paymentService.redirectToCheckout(planKey as any, method);
    } catch (err: any) {
      setError(err.message || '创建支付失败,请重试');
      setIsLoading(false);
    }
  };

  // Determine display currency based on current 'paymentMethod' state (which defaults based on locale)
  // But allow switching it implicitly? Or just stick to the detected one for Step 1?
  // User can toggle region/currency via a small control if needed, but per request, main selector is gone.
  // We'll use the 'paymentMethod' state to determine the viewing currency in Step 1.
  const isAlipay = paymentMethod === 'alipay';
  const currency = isAlipay ? 'CNY' : 'USD';
  const symbol = isAlipay ? '¥' : '$';

  const pricingData = {
    pro: {
      title: 'Pro 专业版',
      monthly: { CNY: 29, USD: 3.99 },
      yearly: { CNY: 298, USD: 39.99 },
      quota: '适合独立创作者',
      features: [
        '每月 50 次智能文档生成',
        '集成 GPT-5.2旗舰级大模型',
        '解锁所有高级排版模板',
        '导出高清无水印 Word',
        '7x24小时 优先生成队列'
      ]
    },
    team: {
      title: 'Team 团队版',
      monthly: { CNY: 199, USD: 26.99 },
      yearly: { CNY: 1999, USD: 269.99 },
      quota: '适合工作室与小团队',
      features: [
        '每月 500 次极速生成额度',
        '独享Gemini 深度推理模型',
        '支持团队多人协作与共享',
        '专属 API 接口对接支持',
        '1对1 专属客户经理服务'
      ]
    }
  };

  const tiers: Tier[] = ['pro', 'team'];

  // getPrice helper now accepts explicit method (for Step 2 comparison)
  const getPrice = (tier: Tier, method: PaymentMethod = paymentMethod) => {
    const curr = method === 'alipay' ? 'CNY' : 'USD';
    return pricingData[tier][billingCycle][curr];
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative z-10 w-full max-w-4xl mx-4 bg-white rounded-3xl shadow-2xl overflow-hidden transition-all duration-300" style={{ minHeight: '600px' }}>

        {/* ================= STEP 2: PAYMENT SELECTION OVERLAY ================= */}
        {step === 'payment' && selectedTier && (
          <div className="absolute inset-0 bg-white z-20 flex flex-col p-8 animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="flex items-center mb-8">
              <button
                onClick={() => setStep('plans')}
                className="group flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors px-2 py-1 -ml-2 rounded-lg hover:bg-gray-100"
              >
                <div className="w-8 h-8 rounded-full bg-gray-100 group-hover:bg-white border border-transparent group-hover:border-gray-200 flex items-center justify-center transition-all shadow-sm">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6" /></svg>
                </div>
                <span className="font-bold text-sm">返回</span>
              </button>
              <div className="flex-1 text-center pr-12">
                <h2 className="text-xl font-bold text-gray-900">确认支付方式</h2>
              </div>
            </div>

            <div className="flex-1 flex flex-col justify-center max-w-2xl mx-auto w-full">
              <div className="text-center mb-10">
                <p className="text-gray-500 text-lg">
                  您选择了 <strong className="text-gray-900">{pricingData[selectedTier].title}</strong>
                  <span className="mx-2 text-gray-300">|</span>
                  {billingCycle === 'monthly' ? '月付方案' : '年付方案'}
                </p>
                <div className="mt-4 text-4xl font-extrabold text-gray-900 tracking-tight">
                  <span className="text-2xl text-gray-400 font-normal mr-1">{paymentMethod === 'alipay' ? '¥' : '$'}</span>
                  {pricingData[selectedTier][billingCycle][paymentMethod === 'alipay' ? 'CNY' : 'USD']}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6">
                {/* Alipay Option */}
                <button
                  onClick={() => handleFinalPay('alipay')}
                  disabled={isLoading}
                  onMouseEnter={() => setPaymentMethod('alipay')}
                  className={`group relative flex flex-col items-center p-8 rounded-3xl border-2 transition-all duration-300 ${paymentMethod === 'alipay'
                    ? 'border-blue-500 bg-blue-50/30 shadow-xl shadow-blue-100 scale-105 z-10'
                    : 'border-gray-100 bg-white hover:border-blue-200 hover:shadow-lg hover:scale-[1.02]'
                    }`}
                >
                  <div className="w-16 h-16 bg-white rounded-2xl flex items-center justify-center shadow-sm mb-4 group-hover:scale-110 transition-transform duration-300">
                    <img
                      src={alipayLogo}
                      alt="Alipay"
                      className="w-10 h-10 rounded-lg object-contain"
                    />
                  </div>
                  <div className="text-lg font-bold text-gray-900 mb-1">支付宝支付</div>
                  <div className="text-sm text-gray-500 font-medium">推荐中国用户使用</div>
                  {paymentMethod === 'alipay' && (
                    <div className="absolute top-4 right-4 text-blue-500">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>
                    </div>
                  )}
                </button>

                {/* Stripe Option */}
                <button
                  onClick={() => handleFinalPay('stripe')}
                  disabled={isLoading}
                  onMouseEnter={() => setPaymentMethod('stripe')}
                  className={`group relative flex flex-col items-center p-8 rounded-3xl border-2 transition-all duration-300 ${paymentMethod === 'stripe'
                    ? 'border-indigo-500 bg-indigo-50/30 shadow-xl shadow-indigo-100 scale-105 z-10'
                    : 'border-gray-100 bg-white hover:border-indigo-200 hover:shadow-lg hover:scale-[1.02]'
                    }`}
                >
                  <div className="w-16 h-16 bg-gray-900 rounded-2xl flex items-center justify-center shadow-sm mb-4 group-hover:scale-110 transition-transform duration-300">
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>
                  </div>
                  <div className="text-lg font-bold text-gray-900 mb-1">国际银行卡</div>
                  <div className="text-sm text-gray-500 font-medium">Global USD Payment</div>
                  {paymentMethod === 'stripe' && (
                    <div className="absolute top-4 right-4 text-indigo-500">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>
                    </div>
                  )}
                </button>
              </div>

              {isLoading && (
                <div className="mt-12 flex flex-col items-center justify-center animate-pulse">
                  <div className="text-sm font-medium text-gray-500">正在跳转到第三方安全收银台...</div>
                </div>
              )}

              {error && (
                <div className="mt-8 p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm text-center font-medium animate-in fade-in slide-in-from-bottom-2">
                  {error}
                </div>
              )}
            </div>

            <div className="mt-auto text-center">
              <div className="flex items-center justify-center gap-2 text-xs text-gray-400 bg-gray-50 py-2 rounded-full inline-block px-4 mx-auto">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                SSL Secure Payment Encrypted
              </div>
            </div>
          </div>
        )}

        {/* ================= STEP 1: PLANS VIEW ================= */}

        {/* Header */}
        <div className="px-8 pt-10 pb-6 relative">
          <button
            onClick={onClose}
            className="absolute top-6 right-6 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
            title="关闭"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>

          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900">升级您的计划</h2>
            <p className="text-base text-gray-500 mt-2">选择最适合您的方案，解锁无限可能</p>
          </div>

          <div className="flex items-center justify-center mt-8">
            {/* Billing Toggle (Centered, Clean) */}
            <div className="flex bg-gray-100 p-1 rounded-full relative">
              <button
                onClick={() => setBillingCycle('monthly')}
                className={`flex-1 min-w-[100px] px-6 py-2 text-sm font-medium rounded-full transition-all duration-200 ${billingCycle === 'monthly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                月付
              </button>
              <button
                onClick={() => setBillingCycle('yearly')}
                className={`flex-1 min-w-[120px] px-6 py-2 text-sm font-medium rounded-full transition-all duration-200 flex items-center justify-center gap-2 whitespace-nowrap ${billingCycle === 'yearly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
              >
                年付
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">省15%</span>
              </button>
            </div>


          </div>
        </div>

        {/* Pricing Cards */}
        <div className="p-8 pb-12">
          <div className="grid grid-cols-2 gap-8 items-stretch">
            {tiers.map(tier => {
              const data = pricingData[tier];
              const price = getPrice(tier);
              const isTeam = tier === 'team';

              return (
                <div
                  key={tier}
                  className={`relative flex flex-col rounded-[2rem] p-8 transition-all duration-300 bg-white border border-gray-100 hover:border-blue-200 hover:shadow-lg hover:-translate-y-1`}
                >
                  {isTeam && (
                    <div className="absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 bg-blue-600 text-white text-xs font-bold tracking-wide uppercase rounded-full shadow-sm">
                      推荐
                    </div>
                  )}

                  <div className="mb-4">
                    <h3 className="text-2xl font-bold text-gray-900 tracking-tight">
                      {data.title}
                    </h3>
                    <p className="text-gray-500 mt-2 font-medium">
                      {data.quota}
                    </p>
                  </div>

                  <div className="flex items-baseline mt-4 mb-2">
                    <span className="text-5xl font-extrabold text-gray-900 tracking-tight">
                      {symbol}{price}
                    </span>
                    <span className="text-sm font-medium text-gray-500 ml-2">
                      /{billingCycle === 'yearly' ? '年' : '月'}
                    </span>
                  </div>

                  <div className="h-6">
                    {billingCycle === 'yearly' && (
                      <div className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-bold">
                        节省 15% (约 {symbol}{Math.round(price / 12)}/月)
                      </div>
                    )}
                  </div>

                  <div className="border-t border-gray-100 my-8"></div>

                  <ul className="space-y-4 flex-1">
                    {data.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-3">
                        <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${isTeam ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                            <polyline points="20 6 9 17 4 12"></polyline>
                          </svg>
                        </div>
                        <span className="text-gray-600 text-sm font-medium leading-tight">{f}</span>
                      </li>
                    ))}
                  </ul>

                  <button
                    onClick={() => handlePlanSelect(tier)}
                    className={`mt-10 w-full py-4 rounded-xl text-sm font-bold tracking-wide transition-all active:scale-[0.98] ${isTeam
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-200 hover:bg-blue-700 hover:shadow-blue-300'
                      : 'bg-white text-blue-600 border-2 border-blue-50 hover:border-blue-100 hover:bg-blue-50'
                      }`}
                  >
                    {tier === 'team' ? '立即订阅' : '选择此方案'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
