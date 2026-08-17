import React, { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/authService';
import { translateBackendError } from '../i18n';
import { LegalModal, LegalType } from './LegalModal';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const [phone, setPhone] = useState('');
  // 预填已有的邀请码(?ref= 链接进来时 authService 已存过);手动输入的走同一个键
  const [inviteCode, setInviteCode] = useState<string>(() => {
    try { return localStorage.getItem('docflow_ref') || ''; } catch { return ''; }
  });
  const [smsCode, setSmsCode] = useState('');
  const [captchaInput, setCaptchaInput] = useState('');
  const [captchaImage, setCaptchaImage] = useState('');
  const [captchaSessionId, setCaptchaSessionId] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [showCaptcha, setShowCaptcha] = useState(false); // 图形码「按需」出示:仅当后端(短时间多次发送)返回 AUTH_CAPTCHA_REQUIRED 才显示
  const [legalType, setLegalType] = useState<LegalType>(null); // 用户协议/隐私「当场弹层」
  const [countdown, setCountdown] = useState(0);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [devHint, setDevHint] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 微信扫码:未配置凭据时整个页签都不出现,免得用户点一个必然失败的入口
  const [tab, setTab] = useState<'sms' | 'wechat'>('sms');
  const [wechatOn, setWechatOn] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const [qrError, setQrError] = useState('');
  const [qrExpired, setQrExpired] = useState(false);
  const [qrNonce, setQrNonce] = useState(0);   // 自增即重新拉一张新码
  // 页签配色随主题走。不用 CSS 类 —— 弹窗子树里 .prism-modal 那批 !important
  // 规则会接管背景/文字色,主题选择器压不过去(实测)。行内样式不参与那场竞争。
  const [isDark, setIsDark] = useState<boolean>(
    () => (typeof document !== 'undefined'
      && document.documentElement.getAttribute('data-doc-theme') === 'dark'),
  );

  React.useEffect(() => {
    const root = document.documentElement;
    const sync = () => setIsDark(root.getAttribute('data-doc-theme') === 'dark');
    sync();
    const mo = new MutationObserver(sync);
    mo.observe(root, { attributes: true, attributeFilter: ['data-doc-theme'] });
    return () => mo.disconnect();
  }, []);

  const { login, wechatError, clearWechatError } = useAuth();
  const { t } = useTranslation();

  React.useEffect(() => {
    return () => { if (countdownTimerRef.current) clearInterval(countdownTimerRef.current); };
  }, []);

  React.useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    authService.wechatEnabled().then((on) => { if (!cancelled) setWechatOn(on); });
    return () => { cancelled = true; };
  }, [isOpen]);

  // 扫码失败回跳后:直接切到微信页签并把原因说清楚,而不是让用户对着首页发愣
  React.useEffect(() => {
    if (!isOpen || !wechatError) return;
    setTab('wechat');
    const MSG: Record<string, string> = {
      state: t('auth.wxerr_expired', '二维码已过期,请重新扫码'),
      nocode: t('auth.wxerr_cancelled', '扫码未完成,请重新扫码'),
      exchange: t('auth.wxerr_exchange', '微信授权失败,请重新扫码'),
      finish: t('auth.wxerr_expired', '二维码已过期,请重新扫码'),
      unconfigured: t('auth.wxerr_unconfigured', '微信登录暂未开通'),
    };
    setError(MSG[wechatError] || t('auth.wxerr_generic', '微信登录失败,请重试'));
    clearWechatError();
  }, [isOpen, wechatError, t, clearWechatError]);

  // 二维码地址按需拉取:切到微信页签才请求,且每次重开弹窗都取新的
  // (state 里签了 5 分钟有效期,复用旧地址会扫出「已过期」)
  React.useEffect(() => {
    if (!isOpen || tab !== 'wechat') return;
    let cancelled = false;
    let expireTimer: ReturnType<typeof setTimeout> | undefined;
    setQrError('');
    setQrUrl('');
    setQrExpired(false);
    authService.wechatQrUrl()
      .then((u) => {
        if (cancelled) return;
        setQrUrl(u);
        // state 只签了 5 分钟。到期不提示的话,用户会扫一个注定失败的码,
        // 然后对着「扫了没反应」一脸茫然 —— 提前 10 秒标记过期。
        expireTimer = setTimeout(() => { if (!cancelled) setQrExpired(true); }, 290_000);
      })
      .catch((e) => { if (!cancelled) setQrError(e.message || '二维码加载失败'); });
    return () => { cancelled = true; if (expireTimer) clearTimeout(expireTimer); };
  }, [isOpen, tab, qrNonce]);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  React.useEffect(() => {
    // 不再"一打开就弹图形码";仅在后端要求(短时间多次发送)时才出示。
    if (isOpen) { setShowCaptcha(false); setCaptchaInput(''); }
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
    if (showCaptcha && !captchaInput) {
      setError(t('auth.error_fill_captcha', '请填写图形验证码'));
      return;
    }
    setError('');
    setIsLoading(true);
    try {
      const { devCode } = await authService.sendSmsCode(phone, showCaptcha ? captchaInput : '', showCaptcha ? captchaSessionId : '');
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
      // 后端因"短时间多次发送"要求图形码 → 出示图形码并让用户重试(不消耗倒计时)。
      if (e?.message === 'AUTH_CAPTCHA_REQUIRED') {
        setShowCaptcha(true);
        setCaptchaInput('');
        await refreshCaptcha();
        setError(t('auth.error_need_captcha', '操作过于频繁,请输入图形验证码后重试'));
      } else {
        setError(translateBackendError(e.message) || t('auth.error_send_failed', '发送失败'));
        if (showCaptcha) refreshCaptcha();
      }
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
      setError(translateBackendError(err.message) || t('auth.error_operation_failed', '操作失败,请重试'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="prism-modal auth-modal fixed inset-0 z-50 flex items-center justify-center px-4">
      <button
        type="button"
        className="modal-backdrop absolute inset-0"
        onClick={onClose}
        aria-label={t('common.close', '关闭')}
      />

      {/* max-h + 纵向可滚:矮屏(横屏手机、320×640 老机型)上弹窗会比视口高,
          原来是 overflow-hidden —— 底部的登录按钮直接被截掉且划不到,等于登不了。 */}
      <div className="auth-panel modal-surface relative z-10 w-full max-w-md rounded-2xl shadow-2xl overflow-x-hidden overflow-y-auto max-h-[calc(100vh-2rem)]">
        <div className="px-8 pt-8 pb-6">
          <button
            onClick={onClose}
            className="modal-close absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full transition-colors"
            aria-label={t('common.close', '关闭')}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>

          <div className="flex items-center gap-3 mb-3">
            <img src="/icon.svg" alt="DocFlow" className="w-10 h-10 rounded-xl" />
            <div>
              <h2 className="text-xl font-semibold text-gray-900">{t('auth.login_title', '登录 / 注册')}</h2>
              <p className="text-sm text-gray-500">{t('auth.sms_subtitle', '手机号未注册将自动创建账号')}</p>
            </div>
          </div>
          {/* 注册钩子:登录框是转化的第一触点,只有黑白灰会显得冷。
              绿色是品牌色(邀请弹窗/宣传物料同色),点到为止,不抢内容。 */}
          <div className="flex items-center gap-2 rounded-xl bg-emerald-50 border border-emerald-100 px-3.5 py-2.5">
            <svg className="w-4 h-4 text-emerald-600 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 12v10H4V12" /><path d="M2 7h20v5H2z" /><path d="M12 22V7" />
              <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z" /><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z" />
            </svg>
            <p className="text-sm text-emerald-800">{t('auth.signup_gift', '新用户注册即送 3 次免费排版,无需绑卡')}</p>
          </div>
        </div>

        <div className="px-8 pb-8">
          {/* 两种登录方式并列。只有配好微信凭据时才出现页签,否则保持原来的单一表单 */}
          {wechatOn && (
            <div
              className="flex gap-1 p-1 mb-5 rounded-xl"
              role="tablist"
              style={{ backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.07)' }}
            >
              {([
                ['sms', t('auth.tab_sms', '手机号')],
                ['wechat', t('auth.tab_wechat', '微信扫码')],
              ] as const).map(([key, label]) => {
                const active = tab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => { setTab(key); setError(''); }}
                    className="auth-tab flex-1 py-2 text-sm font-medium rounded-lg transition-colors"
                    style={active
                      ? {
                          backgroundColor: isDark ? '#2f2f2f' : '#ffffff',
                          color: isDark ? '#f4f4f5' : '#111827',
                          boxShadow: isDark ? 'none' : '0 1px 2px rgba(0,0,0,.06)',
                        }
                      : { backgroundColor: 'transparent', color: isDark ? '#a1a1aa' : '#4b5563' }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          {/* 协议同意:两种登录方式共用同一道门槛。
              原来只挡手机号那侧,微信侧仅有一句提示 —— 同一个产品两套标准,说不通。 */}
          <label className="flex items-start gap-2 mb-4 text-xs text-gray-600 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={agreedTerms}
              onChange={(e) => setAgreedTerms(e.target.checked)}
              disabled={isLoading}
              className="mt-0.5 w-3.5 h-3.5 rounded border-gray-300 text-gray-900 focus:ring-gray-900 focus:ring-offset-0"
            />
            <span>
              {t('auth.agree_prefix', '我已阅读并同意 ')}
              <button type="button" onClick={() => setLegalType('terms')} className="text-gray-900 underline hover:text-gray-700">{t('auth.terms', '用户协议')}</button>
              {t('auth.agree_and', ' 和 ')}
              <button type="button" onClick={() => setLegalType('privacy')} className="text-gray-900 underline hover:text-gray-700">{t('auth.privacy', '隐私与保密条款')}</button>
            </span>
          </label>

          {wechatOn && tab === 'wechat' ? (
            <div className="flex flex-col items-center">
              {/* 微信官方二维码页。用 iframe 内嵌而非跳走 —— 跳出去再回来,用户容易以为流程断了 */}
              {/* 窄屏(320px 老机型)上内容区只剩 224px,固定 300px 会把二维码右边切掉。
                  外层限宽 + 内层等比缩放:二维码整体缩小而不是被裁,扫码仍然可用。 */}
              {/* 微信侧的错误(扫码回跳带回的原因)必须显示在这里 ——
                  它原来只渲染在手机号表单内部,微信页签下等于石沉大海。 */}
              {error && (
                <div className="w-full max-w-[300px] mb-3 flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">
                  <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>{error}</span>
                </div>
              )}

              {qrUrl && !qrError && (
                <div className="relative w-full max-w-[300px] overflow-hidden">
                  <iframe
                    src={qrUrl}
                    title={t('auth.tab_wechat', '微信扫码')}
                    className="block border-0 origin-top-left w-[300px] h-[340px] max-[360px]:scale-[0.75] max-[360px]:-mb-[85px]"
                    sandbox="allow-scripts allow-same-origin allow-top-navigation allow-popups"
                  />

                  {/* 没勾协议时挡住二维码:两种登录方式同一道门槛,
                      不能手机号那侧强制勾选、微信侧扫了就进。 */}
                  {!agreedTerms && (
                    <div className="absolute inset-0 flex items-center justify-center bg-white/85 backdrop-blur-[1px] rounded-lg">
                      <p className="px-6 text-center text-sm text-gray-600">
                        {t('auth.agree_before_scan', '请先勾选上方协议,再扫码登录')}
                      </p>
                    </div>
                  )}

                  {/* 二维码过期:换成可点的刷新,而不是让用户扫一个注定失败的码 */}
                  {qrExpired && agreedTerms && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/92 rounded-lg">
                      <p className="text-sm text-gray-500">{t('auth.qr_expired', '二维码已过期')}</p>
                      <button
                        type="button"
                        onClick={() => { setError(''); setQrNonce((n) => n + 1); }}
                        className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition-colors"
                      >
                        {t('auth.qr_refresh', '点击刷新')}
                      </button>
                    </div>
                  )}
                </div>
              )}
              {!qrUrl && !qrError && (
                <div className="w-full max-w-[300px] h-[340px] flex items-center justify-center text-sm text-gray-400">
                  {t('auth.qr_loading', '二维码加载中…')}
                </div>
              )}
              {qrError && (
                <div className="w-full max-w-[300px] py-10 text-center">
                  <p className="text-sm text-red-500 mb-3">{qrError}</p>
                  <button
                    type="button"
                    onClick={() => setTab('sms')}
                    className="text-sm text-emerald-600 hover:text-emerald-500"
                  >
                    {t('auth.use_sms_instead', '改用手机号登录')}
                  </button>
                </div>
              )}
              <p className="text-xs text-gray-400 mt-3 text-center px-4">
                {t('auth.wechat_hint', '用微信扫码即表示同意用户协议与隐私政策;首次扫码将自动创建账号')}
              </p>
            </div>
          ) : (
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

            {/* 图形验证码:仅在后端要求(短时间多次发送)时才出示,不再一上来就弹 */}
            {showCaptcha && (
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
                  className="auth-captcha-box h-[46px] w-[100px] bg-gray-100 rounded-xl overflow-hidden cursor-pointer border border-gray-200 flex items-center justify-center"
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
            )}

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
                  disabled={countdown > 0 || isLoading || !isValidPhone(phone) || (showCaptcha && !captchaInput)}
                  className="px-4 py-3 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors min-w-[100px]"
                >
                  {countdown > 0 ? `${countdown}s` : t('auth.get_code', '获取验证码')}
                </button>
              </div>
            </div>

            {/* 邀请码(选填)。链接邀请(?ref=)会自动带上;这个输入口给「只拿到一串码」的
                场景 —— 抖音等平台不让挂外链,好友只能口头/评论区传码,没有入口码就废了。
                写入 docflow_ref 后 authService.login 会自动带给后端,与链接邀请同一条路。 */}
            <div>
              <label htmlFor="invite-code" className="block text-sm font-medium text-gray-700 mb-1.5">
                {t('auth.invite_code', '邀请码')}
                <span className="ml-1.5 text-xs font-normal text-gray-400">{t('auth.invite_code_optional', '选填,双方各得次数')}</span>
              </label>
              <input
                id="invite-code"
                value={inviteCode}
                onChange={(e) => {
                  const v = e.target.value.trim().toUpperCase().slice(0, 12);
                  setInviteCode(v);
                  try {
                    if (v) localStorage.setItem('docflow_ref', v);
                    else localStorage.removeItem('docflow_ref');
                  } catch { /* 隐私模式下不可用,忽略 */ }
                }}
                placeholder={t('auth.invite_code_placeholder', '好友给你的邀请码')}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm tracking-[0.2em] focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent"
              />
            </div>

            {devHint && (
              <p className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">{devHint}</p>
            )}

            {error && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-red-600 text-sm">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || !agreedTerms}
              className="w-full py-3 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
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
          )}
        </div>
      </div>
      <LegalModal type={legalType} onClose={() => setLegalType(null)} />
    </div>
  );
}
