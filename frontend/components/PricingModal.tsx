
import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { paymentService } from '../services/paymentService';
import { useTranslation } from 'react-i18next';
import wechatLogo from '../image/WeChatlogo.jpg';
import { QRCodeCanvas } from 'qrcode.react';

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * Why the modal was opened. When `reason === 'quota'` the modal shows a prominent
   * "free quota exhausted" banner at the top and defaults to monthly billing
   * (lower decision friction).
   */
  reason?: 'quota';
}

type BillingCycle = 'monthly' | 'yearly';
type Tier = 'plus' | 'pro' | 'ultra';

export function PricingModal({ isOpen, onClose, reason }: PricingModalProps) {
  const { user, refreshUser } = useAuth();
  const { t } = useTranslation();
  // When triggered by quota exhaustion, default to monthly (lower decision friction)
  const [billingCycle, setBillingCycle] = useState<BillingCycle>(reason === 'quota' ? 'monthly' : 'yearly');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // New state for 2-step flow + QR Code
  const [step, setStep] = useState<'plans' | 'payment' | 'qrcode' | 'success'>('plans');
  const [selectedTier, setSelectedTier] = useState<Tier | null>(null);
  const [qrCodeData, setQrCodeData] = useState<string>('');
  const [currentOrderId, setCurrentOrderId] = useState<string>('');
  const [isMockOrder, setIsMockOrder] = useState(false);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [statusHint, setStatusHint] = useState('');

  // ESC key to close (only on plans step)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && step === 'plans') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, step, onClose]);

  useEffect(() => {
    if (isOpen) {
      // Reset state on open
      setStep('plans');
      setSelectedTier(null);
      setQrCodeData('');
      setCurrentOrderId('');
      setIsMockOrder(false);
      setIsCheckingStatus(false);
      setStatusHint('');
      setIsLoading(false);
    }
  }, [isOpen]);

  // Polling for payment status (timeout after 10 minutes)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);
  const POLL_TIMEOUT_COUNT = 300; // 300 × 2s = 10 min

  useEffect(() => {
    if (step === 'qrcode' && currentOrderId) {
      pollCountRef.current = 0;
      intervalRef.current = setInterval(async () => {
        pollCountRef.current += 1;
        // Timeout after 10 minutes
        if (pollCountRef.current >= POLL_TIMEOUT_COUNT) {
          if (intervalRef.current) clearInterval(intervalRef.current);
          setStatusHint(t('pricing.poll_timeout', '支付检测已超时，如您已完成支付请点击上方按钮手动校验'));
          return;
        }
        try {
          const status = await paymentService.checkPaymentStatus(currentOrderId);
          if (status === 'PAID') {
            if (intervalRef.current) clearInterval(intervalRef.current);
            setStep('success');
            // Refresh user profile then auto-close
            setTimeout(async () => {
              try {
                await refreshUser();
              } catch (e) {
                console.error('refreshUser failed after payment', e);
              }
              // Auto-close success screen after 2.5s
              setTimeout(() => onClose(), 2500);
            }, 500);
          }
        } catch (e) {
          console.error('Polling error', e);
        }
      }, 2000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [step, currentOrderId]);

  if (!isOpen) return null;

  const handlePlanSelect = (tier: Tier) => {
    setSelectedTier(tier);
    setStep('payment');
  };

  const handleFinalPay = async () => {
    if (!selectedTier) return;
    setError('');
    setIsLoading(true);
    try {
      const planType = `${selectedTier}_${billingCycle}`;
      const checkout = await paymentService.createCheckoutSession(planType, 'wechat');

      if (!checkout.orderId || !checkout.qrCode) {
        throw new Error(t('pricing.checkout_failed', '创建支付会话失败'));
      }

      setCurrentOrderId(checkout.orderId);
      setQrCodeData(checkout.qrCode);
      setIsMockOrder(!!checkout.isMock);
      setStep('qrcode');
    } catch (e: any) {
      setError(e?.message || t('pricing.checkout_failed', '创建支付会话失败'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleManualStatusCheck = async () => {
    if (!currentOrderId) return;
    setIsCheckingStatus(true);
    setStatusHint('');
    try {
      const status = await paymentService.checkPaymentStatus(currentOrderId);
      if (status === 'PAID') {
        setStep('success');
        setTimeout(async () => {
          try {
            await refreshUser();
          } catch (e) {
            console.error('refreshUser failed after manual check', e);
          }
          setTimeout(() => onClose(), 2500);
        }, 500);
      } else {
        setStatusHint(t('pricing.pending_hint', '未检测到账，请完成支付后再试'));
      }
    } catch {
      setStatusHint(t('pricing.status_check_failed', '状态校验失败，请稍后重试'));
    } finally {
      setIsCheckingStatus(false);
    }
  };

  const symbol = '¥';

  const pricingData: Record<Tier, any> = {
    plus: {
      title: t('pricing.plus_title'),
      monthly: { CNY: 29 },
      yearly: { CNY: 298 },
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
      monthly: { CNY: 59 },
      yearly: { CNY: 598 },
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
  // Show all tiers; lower tiers are visually disabled
  const tiers = allTiers;

  // getPrice helper - always returns CNY
  const getPrice = (tier: Tier) => {
    return pricingData[tier][billingCycle].CNY;
  };

  // Only allow backdrop click to close on the plans step
  const handleBackdropClick = () => {
    if (step === 'plans') onClose();
  };

  return (
    <div className="prism-modal fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={handleBackdropClick} />

      <div
        className="pricing-modal relative z-10 w-full max-w-4xl mx-4 bg-[#111111] border border-white/10 rounded-3xl shadow-2xl overflow-hidden transition-all duration-300 max-h-[90vh] overflow-y-auto [&::-webkit-scrollbar]:hidden"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >

        {/* ================= STEP 4: SUCCESS ================= */}
        {step === 'success' && (
          <div className="relative flex flex-col items-center justify-center p-6 animate-in fade-in zoom-in duration-500 h-full min-h-[400px]">
            <button
              onClick={onClose}
              className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
              title={t('common.close', '关闭')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
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
              <button
                onClick={onClose}
                className="ml-auto w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                title={t('common.close', '关闭')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
            </div>

            <div className="flex-1 flex flex-col items-center justify-center text-center">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                {t('pricing.scan_wechat')}
              </h2>
              <p className="text-gray-500 mb-6">
                {t('pricing.pay_amount')} <span className="font-bold text-xl text-green-600">¥{getPrice(selectedTier)}</span> {t('pricing.currency_unit')}
              </p>

              <div className="qr-paper p-4 bg-white border-green-200 border-2 rounded-3xl shadow-lg">
                {qrCodeData ? (
                  <QRCodeCanvas value={qrCodeData} size={224} includeMargin />
                ) : (
                  <div className="w-56 h-56 flex items-center justify-center text-sm text-gray-400 bg-white rounded-xl">
                    {t('pricing.loading_qr', '正在生成支付二维码...')}
                  </div>
                )}
              </div>

              <div className="mt-6 text-sm text-gray-500 max-w-xs">
                <p>{t('pricing.please_use')}{t('pricing.wechat')}{t('pricing.scan_qr_prompt')}</p>
                <p className="mt-2 text-xs text-gray-400">{t('pricing.payment_completion_notice')}</p>
                {!!currentOrderId && <p className="mt-2 text-xs text-gray-400">Order: {currentOrderId}</p>}
                {isMockOrder && <p className="mt-2 text-xs text-amber-500">{t('pricing.mock_order_hint', '当前是测试模式订单')}</p>}
              </div>

              {/* Auto-polling indicator */}
              <div className="mt-4 flex items-center gap-1.5 text-xs text-gray-400">
                <span className="inline-flex gap-0.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-bounce" style={{ animationDelay: '300ms' }} />
                </span>
                {t('pricing.auto_detecting', '自动检测支付结果中')}
              </div>

              <button
                onClick={handleManualStatusCheck}
                disabled={isCheckingStatus}
                className="mt-4 px-6 py-2 text-white rounded-full text-sm font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed bg-green-500 hover:bg-green-600"
              >
                {isCheckingStatus
                  ? t('pricing.checking_payment', '正在校验支付状态...')
                  : t('pricing.payment_completed_btn', '我已支付，立即校验')}
              </button>
              {!!statusHint && (
                <p className="mt-3 text-xs text-amber-600">{statusHint}</p>
              )}
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
              <div className="flex-1 text-center">
                <h2 className="text-xl font-bold text-gray-900">{t('pricing.confirm_payment_method')}</h2>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
                title={t('common.close', '关闭')}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
              </button>
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

              <div className="flex justify-center">
                <button
                  onClick={handleFinalPay}
                  disabled={isLoading}
                  className="group relative flex w-full max-w-sm flex-col items-center p-6 rounded-3xl border-2 border-green-500 bg-green-50/30 shadow-xl shadow-green-100 transition-all duration-300 hover:shadow-green-200 hover:scale-[1.02] disabled:opacity-60 disabled:hover:scale-100"
                >
                  <div className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-sm mb-4 group-hover:scale-110 transition-transform duration-300 overflow-hidden">
                    <img src={wechatLogo} alt={t('pricing.wechat')} className="w-16 h-16 object-cover rounded-2xl" />
                  </div>
                  <div className="text-lg font-bold text-gray-900 mb-1">{t('pricing.wechat_pay')}</div>
                  <div className="text-sm text-gray-500 font-medium">{t('pricing.wechat_official_native', '微信官方收银台动态二维码')}</div>
                  <div className="absolute top-4 right-4 text-green-500">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" /></svg>
                  </div>
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
              <div className="inline-flex items-center justify-center gap-2 text-xs text-gray-400 bg-gray-50 py-2 rounded-full px-4">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg>
                {t('pricing.secure_payment', 'SSL Secure Payment Encrypted')}
              </div>
            </div>
          </div>
        )}

        {/* ================= STEP 1: PLANS VIEW ================= */}
        {step === 'plans' && (
          <>
            {/* Quota exhausted banner (only when triggered by quota error) */}
            {reason === 'quota' && (
              <div className="px-8 pt-6 pb-0">
                <div className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 px-5 py-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center text-amber-600">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="12" y1="8" x2="12" y2="12"></line>
                      <line x1="12" y1="16" x2="12.01" y2="16"></line>
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-amber-900 text-sm">
                      {t('pricing.quota_banner_title', '免费额度已用尽')}
                    </p>
                    <p className="text-amber-800 text-xs mt-0.5">
                      {t('pricing.quota_banner_subtitle', '升级会员立即解锁,Plus 月卡 ¥29 起,到期不自动扣费')}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Header */}
            <div className="px-8 pt-10 pb-6 relative">
              <button
                onClick={onClose}
                className="absolute top-6 right-6 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
                title={t('common.close', '关闭')}
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
                    className={`pricing-cycle-option flex-1 min-w-[100px] px-6 py-2 text-sm font-medium rounded-full transition-all duration-200 ${billingCycle === 'monthly' ? 'is-active bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                      }`}
                  >
                    {t('pricing.monthly')}
                  </button>
                  <button
                    onClick={() => setBillingCycle('yearly')}
                    className={`pricing-cycle-option flex-1 min-w-[120px] px-6 py-2 text-sm font-medium rounded-full transition-all duration-200 flex items-center justify-center gap-2 whitespace-nowrap ${billingCycle === 'yearly' ? 'is-active bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                      }`}
                  >
                    {t('pricing.yearly')}
                    <span className="pricing-save-badge text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium whitespace-nowrap">{t('pricing.save_15')}</span>
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
                  const isCurrentPlanTier = user?.subscriptionStatus?.toLowerCase() === tier;
                  const isDowngrade = getTierLevel(tier) < userLevel;

                  const cardBorder = isCurrentPlanTier
                    ? isUltra
                      ? 'border-purple-300 ring-2 ring-purple-100'
                      : isPro
                        ? 'border-blue-300 ring-2 ring-blue-100'
                        : 'border-gray-300 ring-2 ring-gray-100'
                    : 'border-gray-100';

                  return (
                    <div
                      key={tier}
                      data-tier={tier}
                      className={`pricing-card relative flex flex-col rounded-[2rem] p-6 transition-all duration-300 bg-white border ${cardBorder} ${isDowngrade ? 'opacity-60 pointer-events-none' : 'hover:border-blue-200 hover:shadow-lg hover:-translate-y-1'} w-full md:w-[320px] md:flex-1 md:max-w-[340px]`}
                    >
                      {(isPro || isUltra) && (
                        <div className={`pricing-ribbon absolute -top-4 left-1/2 -translate-x-1/2 px-4 py-1.5 ${isUltra ? 'bg-purple-600' : 'bg-blue-600'} text-white text-xs font-bold tracking-wide uppercase rounded-full shadow-sm`}>
                          {isUltra ? t('pricing.exclusive') : t('pricing.recommended')}
                        </div>
                      )}

                      <div className="mb-4">
                        <h3 className="pricing-card-title text-2xl font-bold text-gray-900 tracking-tight">
                          {data.title}
                        </h3>
                        <p className="pricing-card-desc text-gray-500 mt-2 font-medium">
                          {data.quota}
                        </p>
                      </div>

                      <div className="flex items-baseline mt-4 mb-2">
                        <span className="pricing-price text-5xl font-extrabold text-gray-900 tracking-tight">
                          {symbol}{price}
                        </span>
                        <span className="pricing-period text-sm font-medium text-gray-500 ml-2">
                          {billingCycle === 'yearly' ? t('pricing.yearly') : t('pricing.monthly')}
                        </span>
                      </div>

                      <div className="h-6 flex items-center">
                        {billingCycle === 'yearly' ? (
                          <div className="pricing-save-chip inline-flex items-center px-2.5 py-0.5 rounded-full bg-green-50 text-green-700 text-xs font-bold">
                            {t('pricing.validity_yearly', { symbol, amount: Math.round(price / 12) })}
                          </div>
                        ) : (
                          <span className="text-xs text-gray-500 font-medium">{t('pricing.validity_monthly')}</span>
                        )}
                      </div>

                      <div className="pricing-separator border-t border-gray-100 my-5"></div>

                      <ul className="space-y-4 flex-1">
                        {data.features.map((f, i) => (
                          <li key={i} className="flex items-start gap-3">
                            <div className={`pricing-check mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${isUltra ? 'bg-purple-600 text-white' : isPro ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-400'}`}>
                              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                            </div>
                            <span className="pricing-feature text-gray-600 text-sm font-medium leading-tight">{f}</span>
                          </li>
                        ))}
                      </ul>

                      {(() => {
                        if (isDowngrade) {
                          return (
                            <button
                              disabled
                              className="pricing-action is-disabled mt-6 w-full py-3.5 rounded-xl text-sm font-bold bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200"
                            >
                              已有更高方案
                            </button>
                          );
                        }
                        const isCurrentPlan = isCurrentPlanTier;
                        if (isCurrentPlan) {
                          // Allow upgrade to yearly if viewing yearly tab
                          if (billingCycle === 'yearly') {
                            return (
                              <button
                                onClick={() => handlePlanSelect(tier)}
                                className="pricing-action mt-6 w-full py-3.5 rounded-xl text-sm font-bold tracking-wide transition-all active:scale-[0.98] bg-green-600 text-white shadow-lg shadow-green-200 hover:bg-green-700 hover:shadow-green-300"
                              >
                                {t('pricing.upgrade_to_yearly')}
                              </button>
                            );
                          }

                          return (
                            <button
                              disabled
                              className="pricing-action is-disabled mt-6 w-full py-3.5 rounded-xl text-sm font-bold tracking-wide bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200"
                            >
                              {t('pricing.current_plan')}
                            </button>
                          );
                        }
                        return (
                          <button
                            onClick={() => handlePlanSelect(tier)}
                            className={`pricing-action mt-6 w-full py-3.5 rounded-xl text-sm font-bold tracking-wide transition-all active:scale-[0.98] ${isUltra
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
            <div className="px-6 pb-8 -mt-2 text-center">
              <p className="text-xs text-gray-400">{t('pricing.purchase_notice')}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
