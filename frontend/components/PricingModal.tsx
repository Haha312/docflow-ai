
import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { paymentService } from '../services/paymentService';
import { useTranslation } from 'react-i18next';
import alipayQrCode from '../image/alipay_qr.png';
import wechatQrCode from '../image/wechat_qr.png';
import alipayLogo from '../image/Alipaylogo.png';
import wechatLogo from '../image/WeChatlogo.jpg';
import { QRCodeCanvas } from 'qrcode.react';

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type PaymentMethod = 'alipay' | 'wechat';
type BillingCycle = 'monthly' | 'yearly';
type Tier = 'plus' | 'pro' | 'ultra';

export function PricingModal({ isOpen, onClose }: PricingModalProps) {
  const { user } = useAuth();
  const { t } = useTranslation();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('yearly');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('alipay');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // New state for 2-step flow + QR Code
  const [step, setStep] = useState<'plans' | 'payment' | 'qrcode' | 'success'>('plans');
  const [selectedTier, setSelectedTier] = useState<Tier | null>(null);
  const [qrCodeData, setQrCodeData] = useState<string>('');
  const [currentOrderId, setCurrentOrderId] = useState<string>('');
  const [isMockOrder, setIsMockOrder] = useState(false);

  useEffect(() => {
    if (isOpen) {
      // Reset state on open
      setStep('plans');
      setSelectedTier(null);
      setQrCodeData('');
      setCurrentOrderId('');
      setIsMockOrder(false);
      setIsLoading(false);

      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const lang = navigator.language;
      const isChina = lang === 'zh-CN' || timeZone.includes('Shanghai') || timeZone.includes('Beijing');
      setPaymentMethod(isChina ? 'alipay' : 'stripe');
    }
  }, [isOpen]);

  // Polling for payment status
  useEffect(() => {
    let interval: any;
    if (step === 'qrcode' && currentOrderId) {
      interval = setInterval(async () => {
        try {
          const status = await paymentService.checkPaymentStatus(currentOrderId);
          if (status === 'PAID') {
            setStep('success');
            clearInterval(interval);
            // Refresh user profile after short delay or immediately
            setTimeout(() => {
              window.location.reload(); // Simple reload to refresh auth state
            }, 2000);
          }
        } catch (e) {
          console.error('Polling error', e);
        }
      }, 2000);
    }
    return () => clearInterval(interval);
  }, [step, currentOrderId]);

  if (!isOpen) return null;

  const handlePlanSelect = (tier: Tier) => {
    setSelectedTier(tier);
    setStep('payment');
  };

  const handleFinalPay = async (method: PaymentMethod) => {
    if (!selectedTier) return;
    setError('');

    // Show static QR code directly (no API call needed)
    setPaymentMethod(method);
    setStep('qrcode');
  };

  // ... (pricingData and helpers) ...
  // Determine display currency based on current 'paymentMethod' state (which defaults based on locale)
  // But allow switching it implicitly? Or just stick to the detected one for Step 1?
  // User can toggle region/currency via a small control if needed, but per request, main selector is gone.
  // We'll use the 'paymentMethod' state to determine the viewing currency in Step 1.
  const isAlipay = paymentMethod === 'alipay';
  const currency = isAlipay ? 'CNY' : 'USD';
  const symbol = isAlipay ? '¥' : '$';

  const pricingData: Record<Tier, any> = {
    plus: {
      title: t('pricing.plus_title'),
      monthly: { CNY: 19 },
      yearly: { CNY: 198 },
      quota: t('pricing.plus_quota'),
      features: [
        t('pricing.plus_f1'),
        t('pricing.plus_f2'),
        t('pricing.plus_f3'),
        t('pricing.plus_f4')
      ]
    },
    pro: {
      title: t('pricing.pro_title'),
      monthly: { CNY: 29 },
      yearly: { CNY: 298 },
      quota: t('pricing.pro_quota'),
      features: [
        t('pricing.pro_f1'),
        t('pricing.pro_f2'),
        t('pricing.pro_f3'),
        t('pricing.pro_f4'),
        t('pricing.pro_f5')
      ]
    },
    ultra: {
      title: t('pricing.ultra_title'),
      monthly: { CNY: 99 },
      yearly: { CNY: 998 },
      quota: t('pricing.ultra_quota'),
      features: [
        t('pricing.ultra_f1'),
        t('pricing.ultra_f2'),
        t('pricing.ultra_f3'),
        t('pricing.ultra_f4'),
        t('pricing.ultra_f5')
      ]
    }
  };

  const allTiers: Tier[] = ['plus', 'pro', 'ultra'];

  const getTierLevel = (tierName: string) => {
    switch (tierName.toLowerCase()) {
      case 'ultra': return 3;
      case 'pro': return 2;
      case 'plus': return 1;
      default: return 0; // FREE or unknown
    }
  };

  const userLevel = user ? getTierLevel(user.subscriptionStatus) : 0;
  // Filter out tiers that are lower than the user's current tier
  const tiers = allTiers.filter(t => getTierLevel(t) >= userLevel);

  // getPrice helper - always returns CNY
  const getPrice = (tier: Tier) => {
    return pricingData[tier][billingCycle].CNY;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div
        className="relative z-10 w-full max-w-4xl mx-4 bg-white rounded-3xl shadow-2xl overflow-hidden transition-all duration-300 max-h-[90vh] overflow-y-auto [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >

        {/* ================= STEP 4: SUCCESS ================= */}
        {step === 'success' && (
          <div className="flex flex-col items-center justify-center p-6 animate-in fade-in zoom-in duration-500 h-full min-h-[400px]">
            <div className="w-24 h-24 bg-green-100 rounded-full flex items-center justify-center mb-6 text-green-600 animate-bounce">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
            </div>
            <h2 className="text-3xl font-bold text-gray-900 mb-2">{t('pricing.success_title')}</h2>
            <p className="text-gray-500 text-lg mb-8">{t('pricing.success_subtitle')}</p>
            <div className="text-sm text-gray-400">{t('pricing.refreshing_status')}</div>
          </div>
        )}

        {/* ================= STEP 3: QR CODE SCAN ================= */}
        {step === 'qrcode' && selectedTier && (
          <div className="flex flex-col p-6 animate-in fade-in slide-in-from-right-4 duration-300 h-full">
            <div className="flex items-center mb-4">
              <button
                onClick={() => setStep('payment')}
                className="group flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors px-2 py-1 -ml-2 rounded-lg hover:bg-gray-100"
              >
                <span className="text-sm font-medium">{t('pricing.back_to_payment')}</span>
              </button>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                {paymentMethod === 'wechat' ? t('pricing.scan_wechat') : t('pricing.scan_alipay')}
              </h2>
              <p className="text-gray-500 mb-6">
                {t('pricing.pay_amount')} <span className={`font-bold text-xl ${paymentMethod === 'wechat' ? 'text-green-600' : 'text-blue-600'}`}>¥{getPrice(selectedTier)}</span> {t('pricing.currency_unit')}
              </p>

              <div className={`p-4 bg-gradient-to-br ${paymentMethod === 'wechat' ? 'from-green-50 to-white border-green-100' : 'from-blue-50 to-white border-blue-100'} border-2 rounded-3xl shadow-lg`}>
                <img
                  src={paymentMethod === 'wechat' ? wechatQrCode : alipayQrCode}
                  alt={paymentMethod === 'wechat' ? '微信收款码' : '支付宝收款码'}
                  className="w-56 h-56 object-contain rounded-xl"
                />
              </div>

              <div className="mt-6 text-sm text-gray-500 max-w-xs">
                <p>{t('pricing.please_use')}{paymentMethod === 'wechat' ? t('pricing.wechat') : t('pricing.alipay')}{t('pricing.scan_qr_prompt')}</p>
                <p className="mt-2 text-xs text-gray-400">{t('pricing.payment_completion_notice')}</p>
              </div>

              <button
                onClick={onClose}
                className={`mt-6 px-6 py-2 text-white rounded-full text-sm font-medium transition-colors ${paymentMethod === 'wechat' ? 'bg-green-500 hover:bg-green-600' : 'bg-blue-500 hover:bg-blue-600'}`}
              >
                {t('pricing.payment_completed_btn')}
              </button>
            </div>
          </div>
        )}

        {/* ================= STEP 2: PAYMENT SELECTION OVERLAY ================= */}
        {step === 'payment' && selectedTier && (
          <div className="flex flex-col p-6 pb-10 animate-in fade-in slide-in-from-right-4 duration-300 h-full min-h-[550px]">
            <div className="flex items-center mb-6">
              <button
                onClick={() => setStep('plans')}
                className="group flex items-center gap-2 text-gray-500 hover:text-gray-900 transition-colors px-2 py-1 -ml-2 rounded-lg hover:bg-gray-100"
              >
                <div className="w-8 h-8 rounded-full bg-gray-100 group-hover:bg-white border border-transparent group-hover:border-gray-200 flex items-center justify-center transition-all shadow-sm">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M15 18l-6-6 6-6" /></svg>
                </div>
                <span className="font-bold text-sm">{t('pricing.back_btn')}</span>
              </button>
              <div className="flex-1 text-center pr-12">
                <h2 className="text-xl font-bold text-gray-900">{t('pricing.confirm_payment_method')}</h2>
              </div>
            </div>

            <div className="flex-1 flex flex-col justify-center max-w-2xl mx-auto w-full">
              <div className="text-center mb-10">
                <p className="text-gray-500 text-lg">
                  {t('pricing.you_selected')} <strong className="text-gray-900">{pricingData[selectedTier].title}</strong>
                  <span className="mx-2 text-gray-300">|</span>
                  {billingCycle === 'monthly' ? t('pricing.monthly_plan') : t('pricing.yearly_plan')}
                </p>
                <div className="mt-4 text-4xl font-extrabold text-gray-900 tracking-tight">
                  <span className="text-2xl text-gray-400 font-normal mr-1">¥</span>
                  {pricingData[selectedTier][billingCycle].CNY}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Alipay Option */}
                <button
                  onClick={() => handleFinalPay('alipay')}
                  disabled={isLoading}
                  onMouseEnter={() => setPaymentMethod('alipay')}
                  className={`group relative flex flex-col items-center p-6 rounded-3xl border-2 transition-all duration-300 ${paymentMethod === 'alipay'
                    ? 'border-blue-500 bg-blue-50/30 shadow-xl shadow-blue-100 scale-105 z-10'
                    : 'border-gray-100 bg-white hover:border-blue-200 hover:shadow-lg hover:scale-[1.02]'
                    }`}
                >
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-sm mb-4 group-hover:scale-110 transition-transform duration-300 overflow-hidden">
                    <img src={alipayLogo} alt={t('pricing.alipay')} className="w-16 h-16 object-cover rounded-2xl" />
                  </div>
                  <div className="text-lg font-bold text-gray-900 mb-1">{t('pricing.alipay_pay')}</div>
                  <div className="text-sm text-gray-500 font-medium">{t('pricing.recommended_cn')}</div>
                  {paymentMethod === 'alipay' && (
                    <div className="absolute top-4 right-4 text-blue-500">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>
                    </div>
                  )}
                </button>

                {/* WeChat Option */}
                <button
                  onClick={() => handleFinalPay('wechat')}
                  disabled={isLoading}
                  onMouseEnter={() => setPaymentMethod('wechat')}
                  className={`group relative flex flex-col items-center p-6 rounded-3xl border-2 transition-all duration-300 ${paymentMethod === 'wechat'
                    ? 'border-green-500 bg-green-50/30 shadow-xl shadow-green-100 scale-105 z-10'
                    : 'border-gray-100 bg-white hover:border-green-200 hover:shadow-lg hover:scale-[1.02]'
                    }`}
                >
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-sm mb-4 group-hover:scale-110 transition-transform duration-300 overflow-hidden">
                    <img src={wechatLogo} alt={t('pricing.wechat')} className="w-16 h-16 object-cover rounded-2xl" />
                  </div>
                  <div className="text-lg font-bold text-gray-900 mb-1">{t('pricing.wechat_pay')}</div>
                  <div className="text-sm text-gray-500 font-medium">{t('pricing.recommended_cn')}</div>
                  {paymentMethod === 'wechat' && (
                    <div className="absolute top-4 right-4 text-green-500">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>
                    </div>
                  )}
                </button>
              </div>

              {isLoading && (
                <div className="mt-12 flex flex-col items-center justify-center animate-pulse">
                  <div className="text-sm font-medium text-gray-500">{t('pricing.redirecting_checkout')}</div>
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
        {step === 'plans' && (
          <>
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
                <h2 className="text-2xl font-bold text-gray-900">{t('pricing.upgrade_plan_title')}</h2>
                <p className="text-base text-gray-500 mt-2">{t('pricing.upgrade_plan_subtitle')}</p>
              </div>

              <div className="flex items-center justify-center mt-8">
                {/* Billing Toggle (Centered, Clean) */}
                <div className="flex bg-gray-100 p-1 rounded-full relative">
                  <button
                    onClick={() => setBillingCycle('monthly')}
                    className={`flex-1 min-w-[100px] px-6 py-2 text-sm font-medium rounded-full transition-all duration-200 ${billingCycle === 'monthly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                      }`}
                  >
                    {t('pricing.monthly')}
                  </button>
                  <button
                    onClick={() => setBillingCycle('yearly')}
                    className={`flex-1 min-w-[120px] px-6 py-2 text-sm font-medium rounded-full transition-all duration-200 flex items-center justify-center gap-2 whitespace-nowrap ${billingCycle === 'yearly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                      }`}
                  >
                    {t('pricing.yearly')}
                    <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">{t('pricing.save_15')}</span>
                  </button>
                </div>


              </div>
            </div>

            {/* Pricing Cards */}
            <div className="p-6 pb-8 flex justify-center">
              <div className="flex flex-col md:flex-row flex-wrap justify-center gap-6 items-stretch w-full max-w-6xl">
                {tiers.map(tier => {
                  const data = pricingData[tier];
                  const price = getPrice(tier);
                  const isUltra = tier === 'ultra';
                  const isPro = tier === 'pro';

                  return (
                    <div
                      key={tier}
                      className={`relative flex flex-col rounded-[2rem] p-6 transition-all duration-300 bg-white border border-gray-100 hover:border-blue-200 hover:shadow-lg hover:-translate-y-1 w-full md:w-[320px] md:flex-1 md:max-w-[340px]`}
                    >
                      {(isPro || isUltra) && (
                        <div className={`absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 ${isUltra ? 'bg-purple-600' : 'bg-blue-600'} text-white text-xs font-bold tracking-wide uppercase rounded-full shadow-sm`}>
                          {isUltra ? t('pricing.exclusive') : t('pricing.recommended')}
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
                          /{billingCycle === 'yearly' ? t('pricing.yearly') : t('pricing.monthly')}
                        </span>
                      </div>

                      <div className="h-6">
                        {billingCycle === 'yearly' && (
                          <div className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-bold">
                            {t('pricing.save_15_approx', { symbol, amount: Math.round(price / 12) })}
                          </div>
                        )}
                      </div>

                      <div className="border-t border-gray-100 my-5"></div>

                      <ul className="space-y-4 flex-1">
                        {data.features.map((f, i) => (
                          <li key={i} className="flex items-start gap-3">
                            <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${isUltra ? 'bg-purple-600 text-white' : isPro ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                            </div>
                            <span className="text-gray-600 text-sm font-medium leading-tight">{f}</span>
                          </li>
                        ))}
                      </ul>

                      {(() => {
                        const isCurrentPlan = user?.subscriptionStatus?.toLowerCase() === tier;
                        if (isCurrentPlan) {
                          // Allow upgrade to yearly if viewing yearly tab 
                          if (billingCycle === 'yearly') {
                            return (
                              <button
                                onClick={() => handlePlanSelect(tier)}
                                className="mt-6 w-full py-3.5 rounded-xl text-sm font-bold tracking-wide transition-all active:scale-[0.98] bg-green-600 text-white shadow-lg shadow-green-200 hover:bg-green-700 hover:shadow-green-300"
                              >
                                {t('pricing.upgrade_to_yearly')}
                              </button>
                            );
                          }

                          return (
                            <button
                              disabled
                              className="mt-6 w-full py-3.5 rounded-xl text-sm font-bold tracking-wide bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200"
                            >
                              {t('pricing.current_plan')}
                            </button>
                          );
                        }
                        return (
                          <button
                            onClick={() => handlePlanSelect(tier)}
                            className={`mt-6 w-full py-3.5 rounded-xl text-sm font-bold tracking-wide transition-all active:scale-[0.98] ${isUltra
                              ? 'bg-purple-600 text-white shadow-lg shadow-purple-200 hover:bg-purple-700 hover:shadow-purple-300'
                              : isPro
                                ? 'bg-blue-600 text-white shadow-lg shadow-blue-200 hover:bg-blue-700 hover:shadow-blue-300'
                                : 'bg-white text-blue-600 border-2 border-blue-50 hover:border-blue-100 hover:bg-blue-50'
                              }`}
                          >
                            {isUltra ? t('pricing.upgrade_to_ultra') : isPro ? t('pricing.upgrade_to_pro') : t('pricing.upgrade_to_plus')}
                          </button>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
