import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import prisma from '../config/database';
import redis from './redis';

/**
 * 微信开放平台·网站应用扫码登录(scope=snsapi_login)。
 *
 * 整条链路:
 *   /start    → 生成微信二维码页地址(前端内嵌 iframe,不把用户带离站点)
 *   用户扫码  → 微信回跳 /callback?code&state
 *   /callback → 用 code 换 openid → 建号或登录 → 发一张 60 秒一次性票 → 302 回首页带票
 *   /finish   → 前端拿票换正式 JWT
 *
 * 为什么绕一道「票」而不直接把 JWT 放进回跳地址:URL 会留在浏览器历史、
 * Referer 和 nginx 访问日志里。JWT 泄漏等于账号被接管,票则 60 秒失效且用后即废。
 */

const TICKET_TTL_SEC = 60;
const STATE_TTL = '5m';

/** 配置读取:数据库(后台可改)优先于环境变量,与模型 API Key 同一套口径 */
export const getWechatConfig = async (): Promise<{ appid: string; secret: string }> => {
    let dbAppid = '';
    let dbSecret = '';
    try {
        const rows = await prisma.systemConfig.findMany({
            where: { key: { in: ['WXLOGIN_APPID', 'WXLOGIN_SECRET'] } },
        });
        for (const r of rows) {
            if (r.key === 'WXLOGIN_APPID') dbAppid = r.value || '';
            if (r.key === 'WXLOGIN_SECRET') dbSecret = r.value || '';
        }
    } catch {
        // SystemConfig 表不可用时回落环境变量,不阻断登录
    }
    return {
        appid: dbAppid || process.env.WXLOGIN_APPID || '',
        secret: dbSecret || process.env.WXLOGIN_SECRET || '',
    };
};

export const isWechatLoginConfigured = async (): Promise<boolean> => {
    const { appid, secret } = await getWechatConfig();
    return !!(appid && secret);
};

/**
 * state 防 CSRF:签一个 5 分钟的 JWT,回调时验签。
 * 邀请码也塞进 state —— 微信只回传 state 这一个自定义参数,放 query 里会丢。
 */
export const signState = (payload: { ref?: string; bind?: string }): string => {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET 未配置');
    // bind = 要把这个微信绑到哪个账号。必须签进 state,不能放明文 query ——
    // 否则任何人改一下参数,就能把自己的微信绑到别人账号上,等于账号被接管。
    return jwt.sign(
        { t: 'wxstate', ref: payload.ref || undefined, bind: payload.bind || undefined },
        secret,
        { expiresIn: STATE_TTL, algorithm: 'HS256' },
    );
};

export const verifyState = (state: string): { ok: boolean; ref?: string; bind?: string } => {
    try {
        const secret = process.env.JWT_SECRET;
        if (!secret) return { ok: false };
        const p = jwt.verify(state, secret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
        if (p.t !== 'wxstate') return { ok: false };
        return {
            ok: true,
            ref: typeof p.ref === 'string' ? p.ref : undefined,
            bind: typeof p.bind === 'string' ? p.bind : undefined,
        };
    } catch {
        return { ok: false };
    }
};

/** 拼微信二维码页地址。href 指向同域的样式表,用来去掉微信自带的标题边框 */
export const buildQrUrl = (opts: {
    appid: string;
    callbackUrl: string;
    state: string;
    styleHref?: string;
}): string => {
    const base = 'https://open.weixin.qq.com/connect/qrconnect'
        + `?appid=${encodeURIComponent(opts.appid)}`
        + `&redirect_uri=${encodeURIComponent(opts.callbackUrl)}`
        + '&response_type=code&scope=snsapi_login'
        + `&state=${encodeURIComponent(opts.state)}`;
    // self_redirect=false:扫码后由顶层窗口跳转,而不是在 iframe 里跳
    // —— 少了它,整个站会被套进 iframe 再渲染一遍。
    const style = opts.styleHref ? `&href=${encodeURIComponent(opts.styleHref)}` : '';
    return `${base}&self_redirect=false&styletype=${style}#wechat_redirect`;
};

// ── 一次性票 ────────────────────────────────────────────────
const ticketKey = (t: string) => `wxticket:${t}`;

export const issueTicket = async (userId: string): Promise<string> => {
    const ticket = crypto.randomBytes(24).toString('hex');
    await redis.set(ticketKey(ticket), userId, 'EX', TICKET_TTL_SEC);
    return ticket;
};

/** 用后即废:先删再判,避免同一张票被并发换走两次 */
export const consumeTicket = async (ticket: string): Promise<string | null> => {
    if (!ticket || !/^[a-f0-9]{48}$/.test(ticket)) return null;
    const key = ticketKey(ticket);
    const userId = await redis.get(key);
    if (!userId) return null;
    await redis.del(key);
    return userId;
};

// ── 微信接口 ────────────────────────────────────────────────
export interface WechatIdentity {
    openid: string;
    unionid?: string;
    nickname?: string;
}

/** 用 code 换 openid;昵称尽力而为,拿不到不影响登录 */
export const exchangeCodeForIdentity = async (
    code: string,
    cfg: { appid: string; secret: string },
): Promise<WechatIdentity | null> => {
    const tokenUrl = 'https://api.weixin.qq.com/sns/oauth2/access_token'
        + `?appid=${encodeURIComponent(cfg.appid)}`
        + `&secret=${encodeURIComponent(cfg.secret)}`
        + `&code=${encodeURIComponent(code)}`
        + '&grant_type=authorization_code';

    const tr = await fetch(tokenUrl);
    const tok = await tr.json() as { openid?: string; unionid?: string; access_token?: string; errcode?: number };
    if (!tok.openid) {
        // 不打印 errmsg 全文:里面可能带上 appid 片段
        console.warn('[wxlogin] 换取 access_token 失败', { errcode: tok.errcode });
        return null;
    }

    let nickname: string | undefined;
    try {
        const ur = await fetch(
            `https://api.weixin.qq.com/sns/userinfo?access_token=${encodeURIComponent(tok.access_token || '')}`
            + `&openid=${encodeURIComponent(tok.openid)}`,
        );
        const ui = await ur.json() as { nickname?: string };
        if (ui?.nickname) nickname = String(ui.nickname).slice(0, 64);
    } catch {
        // 昵称拿不到就空着,不阻断登录
    }

    return { openid: tok.openid, unionid: tok.unionid, nickname };
};

/**
 * 按 openid 找号或建号。
 * 只用 openid 匹配:unionid 是跨应用的,拿它匹配会让「以后新增应用」意外并号。
 * 存量用户若已有 unionid 而这次缺,不覆盖成空。
 */
export const findOrCreateByWechat = async (
    id: WechatIdentity,
): Promise<{ userId: string; isNew: boolean }> => {
    const existing = await prisma.user.findUnique({ where: { wxOpenid: id.openid } });
    if (existing) {
        const patch: Record<string, string> = {};
        if (id.unionid && !existing.wxUnionid) patch.wxUnionid = id.unionid;
        if (id.nickname && id.nickname !== existing.wxNickname) patch.wxNickname = id.nickname;
        if (Object.keys(patch).length) {
            await prisma.user.update({ where: { id: existing.id }, data: patch });
        }
        return { userId: existing.id, isNew: false };
    }

    const created = await prisma.user.create({
        data: {
            wxOpenid: id.openid,
            wxUnionid: id.unionid || null,
            wxNickname: id.nickname || null,
            subscriptionStatus: 'FREE',
        },
    });
    return { userId: created.id, isNew: true };
};

/** 绑定结果。每种失败都要能对用户说清楚原因,不能笼统报「绑定失败」 */
export type BindResult =
    | { ok: true; alreadyMine: boolean }
    | { ok: false; reason: 'no_user' | 'taken_by_other' | 'already_other_wx' };

/**
 * 把微信身份绑到指定账号。
 * 三种拒绝各有各的说法:
 *  - taken_by_other:这个微信已经是别人的账号了,再绑过来等于账号互串
 *  - already_other_wx:本账号已绑了另一个微信,要换得先解绑(避免默默顶掉)
 */
export const bindWechatToUser = async (
    userId: string,
    id: WechatIdentity,
): Promise<BindResult> => {
    const me = await prisma.user.findUnique({ where: { id: userId } });
    if (!me) return { ok: false, reason: 'no_user' };

    if (me.wxOpenid === id.openid) {
        // 重复扫同一个微信 —— 当成功处理,顺手补全可能缺失的昵称
        if (id.nickname && id.nickname !== me.wxNickname) {
            await prisma.user.update({ where: { id: userId }, data: { wxNickname: id.nickname } });
        }
        return { ok: true, alreadyMine: true };
    }
    if (me.wxOpenid) return { ok: false, reason: 'already_other_wx' };

    const other = await prisma.user.findUnique({ where: { wxOpenid: id.openid } });
    if (other && other.id !== userId) return { ok: false, reason: 'taken_by_other' };

    await prisma.user.update({
        where: { id: userId },
        data: { wxOpenid: id.openid, wxUnionid: id.unionid || null, wxNickname: id.nickname || null },
    });
    return { ok: true, alreadyMine: false };
};

/**
 * 解绑微信。必须留下至少一种能登回来的方式 ——
 * 只用微信注册、没绑手机号的账号一旦解绑,人就被永久锁在门外了。
 */
export const unbindWechat = async (
    userId: string,
): Promise<{ ok: true } | { ok: false; reason: 'no_user' | 'not_bound' | 'would_lock_out' }> => {
    const me = await prisma.user.findUnique({ where: { id: userId } });
    if (!me) return { ok: false, reason: 'no_user' };
    if (!me.wxOpenid) return { ok: false, reason: 'not_bound' };
    if (!me.phone) return { ok: false, reason: 'would_lock_out' };
    await prisma.user.update({
        where: { id: userId },
        data: { wxOpenid: null, wxUnionid: null, wxNickname: null },
    });
    return { ok: true };
};
