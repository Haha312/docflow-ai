import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/authService';
import { translateBackendError } from '../i18n';

/**
 * 账号设置里的「手机号」一栏。
 *
 * 微信扫码注册的账号没有手机号 —— 这意味着换手机、微信封号或误删应用后,
 * 账号连同已购额度都找不回来,客服也联系不上本人。所以这里给一个自愿绑定的入口
 * (不强制:强制会把还在观望的新用户挡在门外)。
 *
 * 复用后端已有的 change-phone 两步接口:它对 phone=null 的账号天然可用,
 * 且会校验号码未被占用、成功后递增 tokenVersion 并换发新令牌。
 */
export function BindPhoneSection() {
  const { user, refreshUser } = useAuth();
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [captchaImage, setCaptchaImage] = useState('');
  const [captchaSessionId, setCaptchaSessionId] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const timerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  React.useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  const hasPhone = !!user?.phone;
  const isValid = (p: string) => /^1[3-9]\d{9}$/.test(p);

  const loadCaptcha = async () => {
    try {
      const d = await authService.getCaptcha();
      setCaptchaImage(d.image);
      setCaptchaSessionId(d.sessionId);
      setCaptcha('');
    } catch {
      setError(t('profile.captcha_load_failed', '图形码加载失败,请重试'));
    }
  };

  const start = async () => {
    setOpen(true);
    setError('');
    setDone(false);
    await loadCaptcha();
  };

  const sendCode = async () => {
    if (!isValid(phone)) { setError(t('auth.error_invalid_phone', '请输入正确的手机号')); return; }
    if (!captcha) { setError(t('auth.error_fill_captcha', '请填写图形验证码')); return; }
    setError('');
    setBusy(true);
    try {
      await authService.requestPhoneChange(phone, captcha, captchaSessionId);
      setCountdown(60);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => {
        setCountdown((n) => {
          if (n <= 1) { if (timerRef.current) clearInterval(timerRef.current); return 0; }
          return n - 1;
        });
      }, 1000);
    } catch (e: any) {
      setError(translateBackendError(e.message) || t('auth.error_send_failed', '发送失败'));
      void loadCaptcha();   // 图形码是一次性的,失败后必须换一张
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!code) { setError(t('profile.enter_code', '请输入验证码')); return; }
    setError('');
    setBusy(true);
    try {
      await authService.confirmPhoneChange(code);
      await refreshUser();
      setDone(true);
      setOpen(false);
      setPhone(''); setCode(''); setCaptcha('');
    } catch (e: any) {
      setError(translateBackendError(e.message) || t('profile.bind_failed', '绑定失败,请重试'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="profile-section rounded-xl p-4">
      <div className="profile-row flex justify-between items-center py-2">
        <span className="profile-label text-sm">{t('profile.phone', '手机号')}</span>
        <div className="flex items-center gap-3">
          <span className="profile-value text-sm font-medium">
            {hasPhone
              ? `${user!.phone!.slice(0, 3)}****${user!.phone!.slice(-4)}`
              : <span className="text-amber-600">{t('profile.phone_unbound', '未绑定')}</span>}
          </span>
          {!open && (
            <button
              type="button"
              onClick={start}
              className="text-xs px-2.5 py-1 rounded-lg border border-current opacity-70 hover:opacity-100 transition-opacity"
            >
              {hasPhone ? t('profile.change_phone', '更换') : t('profile.bind_phone', '绑定')}
            </button>
          )}
        </div>
      </div>

      {/* 未绑定时说清楚「为什么要绑」—— 不写理由的话,自愿绑定几乎没人点 */}
      {!hasPhone && !open && (
        <p className="profile-quota-note mt-2 rounded-lg px-3 py-2 text-xs leading-relaxed">
          {t('profile.bind_phone_why', '绑定后可用手机号登录。微信换号或应用被清理时,账号和已购额度还能找回。')}
        </p>
      )}

      {done && (
        <p className="mt-2 text-xs text-emerald-600">{t('profile.bind_done', '手机号已绑定')}</p>
      )}

      {open && (
        <div className="mt-3 space-y-3">
          <input
            type="tel"
            inputMode="numeric"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
            placeholder={t('auth.phone_placeholder', '请输入手机号')}
            className="w-full px-3 py-2 rounded-lg text-sm bg-gray-50 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900"
          />

          <div className="flex gap-2">
            <input
              value={captcha}
              onChange={(e) => setCaptcha(e.target.value)}
              placeholder={t('auth.captcha_placeholder', '输入右侧字符')}
              className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm bg-gray-50 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            <button
              type="button"
              onClick={loadCaptcha}
              title={t('auth.refresh_captcha', '换一张')}
              className="shrink-0 w-[100px] h-[38px] rounded-lg overflow-hidden border border-gray-200 bg-white"
              dangerouslySetInnerHTML={{ __html: captchaImage }}
            />
          </div>

          <div className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              placeholder={t('auth.sms_code_placeholder', '输入6位验证码')}
              className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm bg-gray-50 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900"
            />
            <button
              type="button"
              onClick={sendCode}
              disabled={busy || countdown > 0 || !isValid(phone) || !captcha}
              className="shrink-0 px-3 py-2 text-sm rounded-lg bg-gray-900 text-white disabled:bg-gray-200 disabled:text-gray-400 transition-colors min-w-[92px]"
            >
              {countdown > 0 ? `${countdown}s` : t('auth.get_code', '获取验证码')}
            </button>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setOpen(false); setError(''); }}
              className="px-3 py-1.5 text-sm opacity-70 hover:opacity-100"
            >
              {t('common.cancel', '取消')}
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={busy || !code}
              className="px-4 py-1.5 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white transition-colors"
            >
              {hasPhone ? t('profile.confirm_change', '确认更换') : t('profile.confirm_bind', '确认绑定')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
