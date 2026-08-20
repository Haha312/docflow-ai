import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/AuthContext';
import { authService } from '../services/authService';

/**
 * 账号设置里的「微信」一栏。
 *
 * 为什么必须有它:老用户(手机号注册)如果直接去扫码登录,后端只按 openid 认人,
 * 认不出来就会新建一个空账号 —— 用户看到的是「我的额度和订单全没了」。
 * 在这里先把微信绑到本账号上,之后扫码就能直接进这个号。
 *
 * 绑定走的是与登录同一条微信链路,区别只在 state 里带了本人 id(签过名,改不了)。
 * 扫完码微信会把整页跳回首页带 ?wxbind=,由 AuthContext 接住、Home 重新打开本弹窗。
 */
export function BindWechatSection() {
  const { user, refreshUser, wechatBind, clearWechatBind } = useAuth();
  const { t } = useTranslation();

  const [qrUrl, setQrUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(null);
  const [confirmingUnbind, setConfirmingUnbind] = useState(false);
  const panelRef = React.useRef<HTMLDivElement>(null);

  // 二维码/确认框展开在弹窗滚动区的下方,不滚过去的话用户点完只看到一条边,
  // 会以为按钮没反应(实测:250px 高的二维码只露出 14px)。
  React.useEffect(() => {
    if (!qrUrl && !confirmingUnbind) return;
    // 不用 smooth:平滑滚动靠 rAF 推进,页面没在合成时它一帧都不走(实测滚动量为 0)。
    // 刚展开的面板本来就该立刻出现在眼前,即时滚动反而少 300ms 的空等。
    panelRef.current?.scrollIntoView({ block: 'nearest' });
  }, [qrUrl, confirmingUnbind]);

  const bound = !!user?.hasWechat;

  // 扫码回跳的结果:每种失败都说清楚是哪种,否则用户只会反复重试同一个必然失败的动作
  React.useEffect(() => {
    if (!wechatBind) return;
    const MSG: Record<string, { kind: 'ok' | 'bad'; text: string }> = {
      ok: { kind: 'ok', text: t('profile.wx_bind_ok', '微信已绑定,以后可以直接扫码登录这个账号') },
      taken: { kind: 'bad', text: t('profile.wx_bind_taken', '这个微信已经绑在另一个账号上了。请先用它扫码登录那个账号并解绑,或换一个微信。') },
      already: { kind: 'bad', text: t('profile.wx_bind_already', '当前账号已经绑定了另一个微信,要更换请先解绑。') },
      err: { kind: 'bad', text: t('profile.wx_bind_err', '绑定失败,请重试') },
    };
    setNotice(MSG[wechatBind] || MSG.err);
    setQrUrl('');
    clearWechatBind();
    if (wechatBind === 'ok') void refreshUser();
  }, [wechatBind, t, clearWechatBind, refreshUser]);

  const start = async () => {
    setError('');
    setNotice(null);
    setBusy(true);
    try {
      setQrUrl(await authService.wechatBindQrUrl());
    } catch (e: any) {
      setError(e.message || t('profile.wx_bind_err', '绑定失败,请重试'));
    } finally {
      setBusy(false);
    }
  };

  const unbind = async () => {
    setError('');
    setBusy(true);
    try {
      await authService.wechatUnbind();
      await refreshUser();
      setConfirmingUnbind(false);
      setNotice({ kind: 'ok', text: t('profile.wx_unbind_ok', '已解绑微信') });
    } catch (e: any) {
      setError(e.message || t('profile.wx_unbind_failed', '解绑失败'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="profile-section rounded-xl p-4">
      <div className="profile-row flex justify-between items-center py-2">
        <span className="profile-label text-sm">{t('profile.wechat', '微信')}</span>
        <div className="flex items-center gap-3">
          <span className="profile-value text-sm font-medium">
            {bound
              ? (user?.wxNickname || t('profile.wx_bound', '已绑定'))
              : <span className="text-amber-600">{t('profile.phone_unbound', '未绑定')}</span>}
          </span>
          {!qrUrl && !confirmingUnbind && (
            <button
              type="button"
              onClick={() => (bound ? setConfirmingUnbind(true) : start())}
              disabled={busy}
              className="text-xs px-2.5 py-1 rounded-lg border border-current opacity-70 hover:opacity-100 transition-opacity disabled:opacity-40"
            >
              {bound ? t('profile.unbind', '解绑') : t('profile.bind_phone', '绑定')}
            </button>
          )}
        </div>
      </div>

      {/* 说清楚为什么值得绑 —— 不写理由,自愿绑定几乎没人点 */}
      {!bound && !qrUrl && (
        <p className="profile-quota-note mt-2 rounded-lg px-3 py-2 text-xs leading-relaxed">
          {t('profile.bind_wx_why', '绑定后可直接微信扫码登录本账号,不用等短信验证码。')}
        </p>
      )}

      {notice && (
        <p className={`mt-2 text-xs leading-relaxed ${notice.kind === 'ok' ? 'text-emerald-600' : 'text-red-500'}`}>
          {notice.text}
        </p>
      )}
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}

      {confirmingUnbind && (
        <div ref={panelRef} className="mt-3 space-y-3">
          <p className="profile-quota-note rounded-lg px-3 py-2 text-xs leading-relaxed">
            {user?.phone
              ? t('profile.wx_unbind_confirm', '解绑后将不能再用微信扫码登录,但仍可用手机号登录。确定解绑?')
              : t('profile.wx_unbind_need_phone', '当前账号只有微信这一种登录方式,解绑后将无法登录。请先绑定手机号。')}
          </p>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setConfirmingUnbind(false); setError(''); }}
              className="px-3 py-1.5 text-sm opacity-70 hover:opacity-100"
            >
              {t('common.cancel', '取消')}
            </button>
            <button
              type="button"
              onClick={unbind}
              disabled={busy || !user?.phone}
              className="px-4 py-1.5 text-sm rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-40 text-white transition-colors"
            >
              {t('profile.confirm_unbind', '确认解绑')}
            </button>
          </div>
        </div>
      )}

      {qrUrl && (
        <div ref={panelRef} className="mt-3 flex flex-col items-center gap-2">
          {/* 与登录框同一套内嵌方式:不把用户带离站点。
              外层限宽 + overflow-hidden:窄屏下二维码整体等比缩小而不是被裁掉右半边。 */}
          <div className="relative w-full max-w-[300px] overflow-hidden">
            <iframe
              src={qrUrl}
              title={t('profile.bind_wx_title', '微信扫码绑定')}
              className="block border-0 origin-top-left w-[300px] h-[250px] max-[360px]:scale-[0.75] max-[360px]:-mb-[62px]"
              sandbox="allow-scripts allow-same-origin allow-top-navigation allow-popups"
            />
          </div>
          <p className="text-xs opacity-60">{t('profile.bind_wx_hint', '用要绑定的微信扫码,完成后本页会自动刷新')}</p>
          <button
            type="button"
            onClick={() => setQrUrl('')}
            className="px-3 py-1.5 text-sm opacity-70 hover:opacity-100"
          >
            {t('common.cancel', '取消')}
          </button>
        </div>
      )}
    </div>
  );
}
