import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/authService';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const [phone, setPhone] = useState('');
  const [smsCode, setSmsCode] = useState('');
  const [captchaInput, setCaptchaInput] = useState('');
  const [captchaImage, setCaptchaImage] = useState('');
  const [captchaSessionId, setCaptchaSessionId] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [devHint, setDevHint] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { login } = useAuth();
  const { t } = useTranslation();

  React.useEffect(() => {
    return () => { if (countdownTimerRef.current) clearInterval(countdownTimerRef.current); };
  }, []);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  React.useEffect(() => {
    if (isOpen) refreshCaptcha();
  }, [isOpen]);

  const refreshCaptcha = async () => {
    setCaptchaLoading(true);
    try {
      const data = await authService.getCaptcha();
      setCaptchaImage(data.image);
      setCaptchaSessionId(data.sessionId);
    } catch (e) {
      console.error('Failed to load captcha', e);
    } finally {
      setCaptchaLoading(false);
    }
  };

  const isValidPhone = (p: string) => /^1[3-9]\d{9}$/.test(p);

  const handleSendCode = async () => {
    if (!isValidPhone(phone)) {
      setError(t('auth.error_invalid_phone', '请输入正确的手机号'));
      return;
    }
    if (!captchaInput) {
      setError(t('auth.error_fill_captcha', '请填写图形验证码'));
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      const { devCode } = await authService.sendSmsCode(phone, captchaInput, captchaSessionId);
      // dev mock:自动填入验证码并提示(生产不会有 devCode)
      if (devCode) { setSmsCode(devCode); setDevHint(`开发模式:验证码 ${devCode}(短信未配置,已自动填入)`); }
      setCountdown(60);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = setInterval(() => {
        setCountdown(prev => {
          if (prev <= 1) {
            if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
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
      await login(phone, smsCode);
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      onClose();
      setPhone('');
      setSmsCode('');
      setCaptchaInput('');
      setCountdown(0);
    } catch (err: any) {
      setError(err.message || t('auth.error_operation_failed', '操作失败,请重试'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div className="relative z-10 w-full max-w-md mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden">
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
              <h2 className="text-xl font-semibold text-gray-900">{t('auth.login_title', '登录 / 注册')}</h2>
              <p className="text-sm text-gray-500">{t('auth.sms_subtitle', '手机号未注册将自动创建账号')}</p>
            </div>
          </div>
        </div>

        <div className="px-8 pb-8">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 手机号 */}
            <div>
              <label htmlFor="phone" className="block text-sm font-medium text-gray-700 mb-1.5">{t('auth.phone', '手机号')}</label>
              <input
                id="phone"
                type="tel"
                inputMode="numeric"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
                placeholder={t('auth.phone_placeholder', '请输入手机号')}
                required
                disabled={isLoading}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
            </div>

            {/* 图形验证码 */}
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
                  className="h-[46px] w-[100px] bg-gray-100 rounded-xl overflow-hidden cursor-pointer border border-gray-200 flex items-center justify-center"
                  onClick={refreshCaptcha}
                  title={t('auth.click_to_refresh', '点击刷新')}
                >
                  {captchaLoading ? (
                    <svg className="animate-spin w-5 h-5 text-gray-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <div dangerouslySetInnerHTML={{ __html: captchaImage }} className="w-full h-full" />
                  )}
                </div>
              </div>
            </div>

            {/* 短信验证码 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">{t('auth.sms_code', '短信验证码')}</label>
              <div className="flex gap-3">
                <input
                  value={smsCode}
                  onChange={(e) => setSmsCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  placeholder={t('auth.sms_code_placeholder', '输入6位验证码')}
                  required
                  className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
                />
                <button
                  type="button"
                  onClick={handleSendCode}
                  disabled={countdown > 0 || isLoading || !isValidPhone(phone) || !captchaInput}
                  className="px-4 py-3 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors min-w-[100px]"
                >
                  {countdown > 0 ? `${countdown}s` : t('auth.get_code', '获取验证码')}
                </button>
              </div>
            </div>

            {devHint && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">{devHint}</p>
            )}

            {/* 协议同意 */}
            <label className="flex items-start gap-2 text-xs text-gray-600 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={agreedTerms}
                onChange={(e) => setAgreedTerms(e.target.checked)}
                disabled={isLoading}
                className="mt-0.5 w-3.5 h-3.5 rounded border-gray-300 text-gray-900 focus:ring-gray-900 focus:ring-offset-0"
              />
              <span>
                {t('auth.agree_prefix', '我已阅读并同意 ')}
                <a href="/terms" target="_blank" rel="noopener" className="text-gray-900 underline hover:text-gray-700">{t('auth.terms', '用户协议')}</a>
                {t('auth.agree_and', ' 和 ')}
                <a href="/privacy" target="_blank" rel="noopener" className="text-gray-900 underline hover:text-gray-700">{t('auth.privacy', '隐私政策')}</a>
              </span>
            </label>

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !agreedTerms}
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
                t('auth.login_register_btn', '登录 / 注册')
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
