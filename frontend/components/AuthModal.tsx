import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/authService';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Registration States
  const [captchaImage, setCaptchaImage] = useState('');
  const [captchaSessionId, setCaptchaSessionId] = useState('');
  const [captchaInput, setCaptchaInput] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [countdown, setCountdown] = useState(0);

  const { login, register } = useAuth();
  const { t } = useTranslation();

  // Load Captcha when switching to register
  React.useEffect(() => {
    if (isOpen && mode === 'register') {
      refreshCaptcha();
    }
  }, [isOpen, mode]);

  const refreshCaptcha = async () => {
    try {
      const data = await authService.getCaptcha();
      setCaptchaImage(data.image);
      setCaptchaSessionId(data.sessionId);
    } catch (e) {
      console.error('Failed to load captcha', e);
    }
  };

  const handleSendCode = async () => {
    if (!email || !captchaInput) {
      setError(t('auth.error_fill_captcha', '请填写邮箱和图形验证码'));
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      await authService.sendEmailCode(email, captchaInput, captchaSessionId);
      setCountdown(60);
      const timer = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            clearInterval(timer);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (e: any) {
      setError(e.message || t('auth.error_send_failed', '发送失败'));
      refreshCaptcha();
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      if (mode === 'login') {
        await login(email, password);
      } else {
        await register(email, password, emailCode);
      }
      onClose();
      setEmail('');
      setPassword('');
      setCaptchaInput('');
      setEmailCode('');
      setCountdown(0);
    } catch (err: any) {
      setError(err.message || t('auth.error_operation_failed', '操作失败,请重试'));
    } finally {
      setIsLoading(false);
    }
  };

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative z-10 w-full max-w-md mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-8 pt-8 pb-6">
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>

          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-gray-900 rounded-xl flex items-center justify-center">
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                <circle cx="12" cy="7" r="4"></circle>
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">{mode === 'login' ? t('auth.welcome_back', '欢迎回来') : t('auth.create_account', '创建账号')}</h2>
              <p className="text-sm text-gray-500">{mode === 'login' ? t('auth.login_to_continue', '登录以继续使用') : t('auth.register_to_start', '注册开始使用')}</p>
            </div>
          </div>
        </div>

        {/* Form */}
        <div className="px-8 pb-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('auth.email_address', '邮箱地址')}
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                disabled={isLoading}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('auth.password', '密码')}
              </label>
              <div className="relative">
                <input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('auth.password_placeholder', '至少 6 位字符')}
                  minLength={6}
                  required
                  disabled={isLoading}
                  className="w-full px-4 py-3 pr-12 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all disabled:bg-gray-100 disabled:cursor-not-allowed"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  tabIndex={-1}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
                >
                  {showPassword ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                  )}
                </button>
              </div>
            </div>

            {mode === 'register' && (
              <>
                {/* Captcha */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('auth.captcha', '图形验证码')}</label>
                  <div className="flex gap-3">
                    <input
                      value={captchaInput}
                      onChange={(e) => setCaptchaInput(e.target.value)}
                      placeholder={t('auth.captcha_placeholder', '输入右侧字符')}
                      className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                    />
                    <div
                      className="h-[46px] w-[100px] bg-gray-100 rounded-xl overflow-hidden cursor-pointer border border-gray-200"
                      onClick={refreshCaptcha}
                      dangerouslySetInnerHTML={{ __html: captchaImage }}
                      title={t('auth.click_to_refresh', '点击刷新')}
                    />
                  </div>
                </div>

                {/* Email Code */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('auth.email_code', '邮箱验证码')}</label>
                  <div className="flex gap-3">
                    <input
                      value={emailCode}
                      onChange={(e) => setEmailCode(e.target.value)}
                      placeholder={t('auth.email_code_placeholder', '输入6位验证码')}
                      className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                    />
                    <button
                      type="button"
                      onClick={handleSendCode}
                      disabled={countdown > 0 || isLoading || !email || !captchaInput}
                      className="px-4 py-3 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors min-w-[100px]"
                    >
                      {countdown > 0 ? `${countdown}s` : t('auth.get_code', '获取验证码')}
                    </button>
                  </div>
                </div>
              </>
            )}

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 bg-gray-900 text-white font-medium rounded-xl hover:bg-gray-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {t('auth.processing', '处理中...')}
                </span>
              ) : (
                mode === 'login' ? t('auth.login_btn', '登录') : t('auth.create_account', '创建账号')
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-gray-100 text-center text-sm text-gray-500">
            {mode === 'login' ? (
              <p>
                {t('auth.no_account', '还没有账号? ')}
                <button
                  type="button"
                  onClick={switchMode}
                  disabled={isLoading}
                  className="text-gray-900 font-medium hover:underline disabled:text-gray-400"
                >
                  {t('auth.register_now', '立即注册')}
                </button>
              </p>
            ) : (
              <p>
                {t('auth.has_account', '已有账号? ')}
                <button
                  type="button"
                  onClick={switchMode}
                  disabled={isLoading}
                  className="text-gray-900 font-medium hover:underline disabled:text-gray-400"
                >
                  {t('auth.login_now', '立即登录')}
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
