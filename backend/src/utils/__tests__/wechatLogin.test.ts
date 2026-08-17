import { describe, it, expect, beforeEach, vi } from 'vitest';

// prisma / redis 都要在模块顶层被替换,故放进 vi.hoisted
const { db, store, prismaMock, redisMock } = vi.hoisted(() => {
    const db = {
        users: new Map<string, any>(),
        config: new Map<string, string>(),
        seq: 0,
    };
    const store = new Map<string, string>();
    const prismaMock = {
        user: {
            findUnique: async ({ where }: any) => {
                if (where.id) return db.users.get(where.id) ?? null;
                if (where.wxOpenid !== undefined) {
                    return [...db.users.values()].find((u) => u.wxOpenid === where.wxOpenid) ?? null;
                }
                return null;
            },
            create: async ({ data }: any) => {
                // 唯一约束:同一个 openid 不允许建两个号
                if (data.wxOpenid && [...db.users.values()].some((u) => u.wxOpenid === data.wxOpenid)) {
                    throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
                }
                const u = { id: `u${++db.seq}`, wxUnionid: null, wxNickname: null, ...data };
                db.users.set(u.id, u);
                return u;
            },
            update: async ({ where, data }: any) => {
                const u = db.users.get(where.id);
                Object.assign(u, data);
                return u;
            },
        },
        systemConfig: {
            findMany: async ({ where }: any) =>
                where.key.in
                    .filter((k: string) => db.config.has(k))
                    .map((k: string) => ({ key: k, value: db.config.get(k) })),
        },
    };
    const redisMock = {
        get: async (k: string) => store.get(k) ?? null,
        set: async (k: string, v: string) => { store.set(k, v); return 'OK' as const; },
        del: async (k: string) => (store.delete(k) ? 1 : 0),
    };
    return { db, store, prismaMock, redisMock };
});

vi.mock('../../config/database', () => ({ default: prismaMock }));
vi.mock('../redis', () => ({ default: redisMock }));

import {
    signState, verifyState, buildQrUrl, issueTicket, consumeTicket,
    findOrCreateByWechat, getWechatConfig,
} from '../wechatLogin';

beforeEach(() => {
    db.users.clear();
    db.config.clear();
    db.seq = 0;
    store.clear();
    process.env.JWT_SECRET = 'test-secret-for-wechat-login';
    delete process.env.WXLOGIN_APPID;
    delete process.env.WXLOGIN_SECRET;
});

describe('state 防 CSRF', () => {
    it('自己签的能验过,邀请码原样带回', () => {
        const r = verifyState(signState({ ref: 'ABC123' }));
        expect(r.ok).toBe(true);
        expect(r.ref).toBe('ABC123');
    });

    it('伪造、篡改、空的一律不认', () => {
        expect(verifyState('').ok).toBe(false);
        expect(verifyState('not-a-jwt').ok).toBe(false);
        expect(verifyState(signState({}) + 'x').ok).toBe(false);
    });

    it('别的用途的 JWT 不能拿来当 state 用', () => {
        // 用同一把密钥签的普通 token(比如登录 token)不该被 state 校验放行
        const jwt = require('jsonwebtoken');
        const other = jwt.sign({ userId: 'u1' }, process.env.JWT_SECRET!, { algorithm: 'HS256' });
        expect(verifyState(other).ok).toBe(false);
    });
});

describe('一次性票', () => {
    it('能换回用户,且只能换一次', async () => {
        const t = await issueTicket('u42');
        expect(await consumeTicket(t)).toBe('u42');
        expect(await consumeTicket(t)).toBeNull();   // 重放必须失败
    });

    it('乱填的票直接拒,不去查存储', async () => {
        for (const bad of ['', 'abc', 'X'.repeat(48), 'a'.repeat(47)]) {
            expect(await consumeTicket(bad)).toBeNull();
        }
    });

    it('票是随机的,不可预测', async () => {
        const set = new Set(await Promise.all([1, 2, 3, 4, 5].map(() => issueTicket('u1'))));
        expect(set.size).toBe(5);
        for (const t of set) expect(t).toMatch(/^[a-f0-9]{48}$/);
    });
});

describe('二维码地址', () => {
    const url = () => buildQrUrl({
        appid: 'wxtest123', callbackUrl: 'https://d.example.com/api/auth/wechat/callback',
        state: 'STATE', styleHref: 'https://d.example.com/wxqr.css',
    });

    it('参数齐全且回调地址被正确转义', () => {
        const u = url();
        expect(u).toContain('appid=wxtest123');
        expect(u).toContain('scope=snsapi_login');
        expect(u).toContain(encodeURIComponent('https://d.example.com/api/auth/wechat/callback'));
        expect(u).toContain('#wechat_redirect');
    });

    it('self_redirect=false —— 否则扫码后整个站会被套进 iframe 再渲染一遍', () => {
        expect(url()).toContain('self_redirect=false');
    });
});

describe('按 openid 建号/登录', () => {
    it('首次登录建号,再次登录复用同一个账号', async () => {
        const a = await findOrCreateByWechat({ openid: 'o1', nickname: '张三' });
        expect(a.isNew).toBe(true);
        const b = await findOrCreateByWechat({ openid: 'o1', nickname: '张三' });
        expect(b.isNew).toBe(false);
        expect(b.userId).toBe(a.userId);
        expect(db.users.size).toBe(1);
    });

    it('unionid 缺失时不会把已存的覆盖成空', async () => {
        const { userId } = await findOrCreateByWechat({ openid: 'o1', unionid: 'un-1' });
        await findOrCreateByWechat({ openid: 'o1' });          // 这次微信没回传 unionid
        expect(db.users.get(userId).wxUnionid).toBe('un-1');
    });

    it('已有账号后来才拿到 unionid,会补上', async () => {
        const { userId } = await findOrCreateByWechat({ openid: 'o1' });
        await findOrCreateByWechat({ openid: 'o1', unionid: 'un-late' });
        expect(db.users.get(userId).wxUnionid).toBe('un-late');
    });

    it('不同 openid 是不同的人', async () => {
        const a = await findOrCreateByWechat({ openid: 'o1' });
        const b = await findOrCreateByWechat({ openid: 'o2' });
        expect(a.userId).not.toBe(b.userId);
        expect(db.users.size).toBe(2);
    });

    it('新号是 FREE 档,不带手机号', async () => {
        const { userId } = await findOrCreateByWechat({ openid: 'o1' });
        const u = db.users.get(userId);
        expect(u.subscriptionStatus).toBe('FREE');
        expect(u.phone).toBeUndefined();
    });
});

describe('凭据读取', () => {
    it('数据库配置优先于环境变量(后台改完即时生效)', async () => {
        process.env.WXLOGIN_APPID = 'from-env';
        process.env.WXLOGIN_SECRET = 'env-secret';
        db.config.set('WXLOGIN_APPID', 'from-db');
        db.config.set('WXLOGIN_SECRET', 'db-secret');
        expect(await getWechatConfig()).toEqual({ appid: 'from-db', secret: 'db-secret' });
    });

    it('数据库没配就回落环境变量', async () => {
        process.env.WXLOGIN_APPID = 'from-env';
        process.env.WXLOGIN_SECRET = 'env-secret';
        expect(await getWechatConfig()).toEqual({ appid: 'from-env', secret: 'env-secret' });
    });

    it('都没配就是空(前端据此隐藏入口)', async () => {
        expect(await getWechatConfig()).toEqual({ appid: '', secret: '' });
    });
});
