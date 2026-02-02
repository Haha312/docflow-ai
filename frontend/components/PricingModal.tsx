import React, { useState, useEffect, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { paymentService } from '../services/paymentService';

interface PricingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type PaymentMethod = 'alipay' | 'stripe';
type BillingCycle = 'monthly' | 'yearly';
type Tier = 'pro' | 'pro_plus' | 'ultra';

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
      if (isChina) setPaymentMethod('alipay');
      else setPaymentMethod('stripe');
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
      monthly: { CNY: 38, USD: 4.99 },
      yearly: { CNY: 388, USD: 49.99 },
      badge: '入门优选',
      features: ['<strong>豆包 + Gemini 2.5</strong>', '每月 <strong>30 docs</strong> 生成额度', '去除水印', '标准客服支持']
    }, pro_plus: {
      title: 'Pro+',
      popular: true,
      monthly: { CNY: 98, USD: 12.99 },
      yearly: { CNY: 988, USD: 129.99 },
      badge: '最受欢迎',
      features: ['<strong>GPT-5 + Claude 3.5 + Gemini 3 Pro Preview</strong>', '每月 <strong>100 docs</strong> 生成额度', '高级学术预设', '优先客服支持']
    },
    ultra: {
      title: 'Ultra',
      monthly: { CNY: 228, USD: 29.99 },
      yearly: { CNY: 2288, USD: 299.99 },
      badge: '旗舰尊享',
      features: ['<strong>GPT-5 + Claude 3.5 Opus + Gemini 3 Pro Preview</strong>', '每月 <strong>300 docs</strong> 生成额度', '处理 2M+ Token 超长文档', '专属排版顾问']
    }
  };

  const tiers: Tier[] = ['pro', 'pro_plus', 'ultra'];

  const getPrice = (tier: Tier) => pricingData[tier][billingCycle][currency];

  const paymentOptions = [
    { id: 'alipay', label: '支付宝 (Alipay)', icon: '💰' },
    { id: 'stripe', label: '信用卡 / Debit Card', icon: '💳' }
  ];
  const selectedMethodLabel = paymentOptions.find(p => p.id === paymentMethod)?.label;

  return (
    <div className="modal-overlay" onClick={onClose}>
      {/* Dynamic Background Mesh */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] bg-blue-500/20 rounded-full blur-[120px] animate-pulse-slow"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-500/20 rounded-full blur-[100px] animate-pulse-slow delay-1000"></div>
      </div>

      <div className="modal-content glass-panel" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>

        <div className="header z-10 relative">
          <h2>解锁 <span className="text-gradient">无限潜能</span></h2>
          <p>选择最适合您的 AI 增强方案</p>
        </div>

        <div className="controls-row z-10 relative">
          {/* Method Dropdown */}
          <div className="method-dropdown-wrapper" ref={dropdownRef}>
            <button
              className={`method-trigger glass-input ${isDropdownOpen ? 'active' : ''}`}
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            >
              <span>{selectedMethodLabel}</span>
              <svg className={`chevron ${isDropdownOpen ? 'rotate' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
            {isDropdownOpen && (
              <div className="method-menu glass-menu">
                {paymentOptions.map(opt => (
                  <button
                    key={opt.id}
                    className={`method-item ${paymentMethod === opt.id ? 'selected' : ''}`}
                    onClick={() => { setPaymentMethod(opt.id as any); setIsDropdownOpen(false); }}
                  >
                    <span className="method-icon">{opt.icon}</span>
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Billing Toggle */}
          <div className="billing-toggle glass-toggle">
            <button
              className={billingCycle === 'monthly' ? 'active' : ''}
              onClick={() => setBillingCycle('monthly')}
            >
              月付
            </button>
            <button
              className={billingCycle === 'yearly' ? 'active' : ''}
              onClick={() => setBillingCycle('yearly')}
            >
              年付 <span className="discount-badge">省 20%</span>
            </button>
          </div>
        </div>

        <div className="tier-grid z-10 relative">
          {tiers.map(tier => {
            const data = pricingData[tier];
            const price = getPrice(tier);
            const isUltra = tier === 'ultra';
            const isProPlus = tier === 'pro_plus';

            return (
              <div key={tier} className={`tier-card ${isUltra ? 'ultra-card' : isProPlus ? 'pro-plus-card' : 'basic-card'}`}>
                {isProPlus && (
                  <div className="popular-badge">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="gold" stroke="none">
                      <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z" />
                    </svg>
                    MOST POPULAR
                  </div>
                )}
                {isUltra && <div className="ultra-badge">👑 Ultimate</div>}

                <div className="card-header">
                  <h3 className={`tier-title ${tier}`}>{data.title}</h3>
                  <div className="price-block">
                    <span className="symbol">{symbol}</span>
                    <span className="amount">{price}</span>
                    <span className="period">/{billingCycle === 'yearly' ? '年' : '月'}</span>
                  </div>
                  <p className="monthly-equivalent">
                    {billingCycle === 'yearly' ? `相当于 ${symbol}${Math.round(price / 12)}/月` : '按月灵活订阅'}
                  </p>
                </div>

                <div className="divider"></div>

                <ul className="features">
                  {data.features.map((f, i) => (
                    <li key={i}>
                      <div className="check-circle">
                        <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="3" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      </div>
                      <span dangerouslySetInnerHTML={{ __html: f }} />
                    </li>
                  ))}
                </ul>

                <button
                  className={`action-btn ${isUltra ? 'btn-ultra' : isProPlus ? 'btn-primary' : 'btn-glass'}`}
                  onClick={() => handleSubscribe(tier)}
                  disabled={isLoading}
                >
                  {isLoading ? 'Processing...' : (isUltra ? '升级至 Ultra' : '立即订阅')}
                </button>
              </div>
            );
          })}
        </div>

        {error && <div className="error-toast glass-toast">{error}</div>}
      </div>

      <style>{`
                .modal-overlay {
                    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
                    background: rgba(10, 10, 15, 0.7);
                    backdrop-filter: blur(12px);
                    z-index: 1000;
                    display: flex; align-items: center; justify-content: center;
                    animation: fadeIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
                }
                
                .glass-panel {
                    background: rgba(255, 255, 255, 0.85);
                    backdrop-filter: blur(24px);
                    border: 1px solid rgba(255, 255, 255, 0.5);
                    box-shadow: 0 40px 80px -12px rgba(0, 0, 0, 0.2), inset 0 0 0 1px rgba(255,255,255,0.5);
                }

                /* Dark mode support logic could be here, but sticking to light glass */
                
                .modal-content {
                    width: 95%; max-width: 1080px;
                    border-radius: 32px;
                    padding: 48px;
                    position: relative;
                    max-height: 95vh;
                    overflow-y: auto;
                    display: flex; flex-direction: column;
                }
                
                .text-gradient {
                    background: linear-gradient(135deg, #2563eb, #9333ea);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                    font-weight: 800;
                }

                .header h2 { font-size: 2.5rem; margin: 0 0 8px; font-weight: 700; color: #1f2937; letter-spacing: -0.02em; }
                .header p { color: #6b7280; font-size: 1.1rem; }
                .header { text-align: center; margin-bottom: 40px; }

                /* Premium Toggles */
                .glass-input, .glass-toggle {
                    background: rgba(255, 255, 255, 0.6);
                    border: 1px solid rgba(209, 213, 219, 0.5);
                    backdrop-filter: blur(8px);
                    box-shadow: 0 2px 4px rgba(0,0,0,0.02);
                }
                .glass-menu {
                    background: rgba(255, 255, 255, 0.95);
                    backdrop-filter: blur(16px);
                    border: 1px solid rgba(209, 213, 219, 0.5);
                    box-shadow: 0 20px 40px rgba(0,0,0,0.1);
                }

                .controls-row { display: flex; justify-content: center; gap: 20px; margin-bottom: 40px; flex-wrap: wrap; }
                
                .billing-toggle {
                     padding: 4px; border-radius: 100px; display: flex;
                }
                .billing-toggle button {
                    padding: 10px 24px; border-radius: 100px; border: none; background: transparent;
                    font-weight: 600; color: #6b7280; cursor: pointer; transition: all 0.3s;
                    display: flex; align-items: center; gap: 8px;
                }
                .billing-toggle button.active {
                    background: #fff; color: #111827; box-shadow: 0 4px 12px rgba(0,0,0,0.08);
                }
                .discount-badge {
                    background: #dbeafe; color: #1e40af; font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: 700;
                }

                /* Method Dropdown */
                .method-dropdown-wrapper { position: relative; min-width: 220px; }
                .method-trigger {
                    width: 100%; padding: 0 20px; height: 48px; border-radius: 12px;
                    display: flex; align-items: center; justify-content: space-between;
                    cursor: pointer; font-weight: 500; color: #374151; transition: all 0.2s;
                }
                .method-trigger:hover { background: rgba(255,255,255,0.9); }
                .method-menu {
                    position: absolute; top: 100%; left: 0; width: 100%; margin-top: 8px; border-radius: 16px; overflow: hidden;
                }
                .method-item {
                    width: 100%; padding: 12px 20px; border: none; background: transparent;
                    text-align: left; font-weight: 500; cursor: pointer; color: #374151;
                    display: flex; align-items: center; gap: 10px; transition: background 0.2s;
                }
                .method-item:hover { background: rgba(0,0,0,0.03); }
                .method-item.selected { background: #eff6ff; color: #2563eb; }

                /* Cards Grid */
                .tier-grid {
                    display: grid; grid-template-columns: repeat(3, 1fr); gap: 32px;
                    margin-bottom: 20px;
                }
                @media (max-width: 860px) { .tier-grid { grid-template-columns: 1fr; } }

                .tier-card {
                    position: relative;
                    padding: 32px; border-radius: 28px;
                    display: flex; flex-direction: column;
                    transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
                }
                
                /* Basic Card */
                .basic-card {
                    background: rgba(255, 255, 255, 0.5);
                    border: 1px solid rgba(255, 255, 255, 0.6);
                }
                .basic-card:hover { transform: translateY(-8px); background: rgba(255, 255, 255, 0.8); }

                /* Pro+ Card (Glass/Gradient) */
                .pro-plus-card {
                    background: linear-gradient(145deg, rgba(239, 246, 255, 0.8), rgba(255, 255, 255, 0.9));
                    border: 1px solid rgba(59, 130, 246, 0.3);
                    box-shadow: 0 20px 40px -10px rgba(59, 130, 246, 0.15);
                }
                .pro-plus-card:hover { transform: translateY(-12px); box-shadow: 0 30px 60px -12px rgba(59, 130, 246, 0.25); }

                /* Ultra Card (Black/Gold Premium) */
                .ultra-card {
                    background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
                    color: white;
                    border: 1px solid #334155;
                    box-shadow: 0 20px 50px -10px rgba(15, 23, 42, 0.5);
                }
                .ultra-card:hover { 
                    transform: translateY(-12px); 
                    box-shadow: 0 30px 80px -10px rgba(15, 23, 42, 0.7);
                }
                .ultra-card .tier-title {
                    background: linear-gradient(90deg, #fbbf24, #f59e0b);
                    -webkit-background-clip: text;
                    -webkit-text-fill-color: transparent;
                }
                .ultra-card h3, .ultra-card .amount, .ultra-card .symbol, .ultra-card .period, .ultra-card .features li {
                    color: white;
                }
                .ultra-card .monthly-equivalent { color: #94a3b8; }
                .ultra-card .check-circle { background: rgba(251, 191, 36, 0.2); color: #fbbf24; }
                .ultra-card .divider { background: rgba(255,255,255,0.1); }
                
                /* Badges */
                .popular-badge {
                    position: absolute; top: -16px; left: 50%; transform: translateX(-50%);
                    background: linear-gradient(90deg, #3b82f6, #8b5cf6); /* Blue to Purple */
                    color: white;
                    padding: 6px 16px; border-radius: 100px; 
                    font-size: 12px; font-weight: 800;
                    letter-spacing: 0.05em; text-transform: uppercase;
                    box-shadow: 0 4px 12px rgba(59, 130, 246, 0.4);
                    display: flex; align-items: center; gap: 4px;
                    z-index: 10;
                    white-space: nowrap;
                }
                .ultra-badge {
                    position: absolute; top: -12px; left: 50%; transform: translateX(-50%);
                    background: linear-gradient(90deg, #d97706, #b45309); color: white;
                    padding: 6px 16px; border-radius: 100px; font-size: 12px; font-weight: 700;
                    letter-spacing: 0.05em; text-transform: uppercase;
                    box-shadow: 0 4px 12px rgba(217, 119, 6, 0.4);
                }
                
                /* Typography */
                .tier-title { font-size: 1.5rem; font-weight: 800; margin-bottom: 20px; }
                .pro_plus { color: #2563eb; }
                .pro { color: #1f2937; }

                .price-block { display: flex; align-items: baseline; justify-content: center; }
                .amount { font-size: 3.5rem; font-weight: 800; letter-spacing: -2px; line-height: 1; }
                .symbol { font-size: 1.5rem; font-weight: 500; margin-right: 4px; vertical-align: super; }
                .period { font-size: 1rem; color: #6b7280; font-weight: 500; }
                .monthly-equivalent { text-align: center; font-size: 0.85rem; color: #6b7280; margin-top: 12px; font-weight: 500; }

                .divider { height: 1px; background: rgba(0,0,0,0.06); margin: 32px 0; }

                .features { list-style: none; padding: 0; margin: 0; text-align: left; flex: 1; }
                .features li { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 16px; font-size: 0.95rem; line-height: 1.5; color: #374151; }
                .check-circle { 
                    width: 20px; height: 20px; border-radius: 50%; 
                    background: #dbeafe; color: #2563eb; 
                    display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 2px;
                }

                /* Buttons */
                .action-btn {
                    width: 100%; padding: 16px; border-radius: 16px; font-size: 1rem; font-weight: 600;
                    cursor: pointer; transition: all 0.3s; border: none; margin-top: 32px;
                }
                .btn-glass { 
                    background: white; border: 1px solid #e5e7eb; color: #1f2937; 
                }
                .btn-glass:hover { border-color: #d1d5db; background: #f9fafb; transform: translateY(-2px); }

                .btn-primary { 
                    background: linear-gradient(135deg, #2563eb, #4f46e5); color: white;
                    box-shadow: 0 8px 20px -4px rgba(37, 99, 235, 0.4);
                }
                .btn-primary:hover { box-shadow: 0 12px 24px -4px rgba(37, 99, 235, 0.5); transform: translateY(-2px); }

                .btn-ultra {
                    background: linear-gradient(135deg, #fbbf24, #d97706); color: #FFF;
                    box-shadow: 0 8px 20px -4px rgba(217, 119, 6, 0.4); color: #fff;
                    text-shadow: 0 1px 2px rgba(0,0,0,0.1);
                }
                .btn-ultra:hover { box-shadow: 0 12px 24px -4px rgba(217, 119, 6, 0.5); transform: translateY(-2px); }

                .modal-close {
                    position: absolute; top: 24px; right: 24px; width: 40px; height: 40px;
                    background: rgba(0,0,0,0.05); border-radius: 50%; border: none; cursor: pointer;
                    display: flex; align-items: center; justify-content: center;
                    color: #4b5563; transition: all 0.2s;
                }
                .modal-close:hover { background: rgba(0,0,0,0.1); color: #1f2937; transform: rotate(90deg); }

                .animate-pulse-slow { animation: pulse 8s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
                @keyframes pulse {
                    0%, 100% { opacity: 0.5; transform: scale(1); }
                    50% { opacity: 0.2; transform: scale(1.1); }
                }
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
            `}</style>
    </div>
  );
}
