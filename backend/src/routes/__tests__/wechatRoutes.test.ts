import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import express from 'express';
import http from 'http';
import type { Server } from 'http';

/**
 * 微信扫码登录的四个接口跑真链路。
 *
 * 为什么必须有这个:utils 的单测只覆盖纯函数,路由本身(参数校验、错误重定向、
 * 票据发放与消费、封禁拦截)一次都没执行过 —— 而线上出问题的恰恰是这些接缝。
 * 这里挂真实 router、起真 http、发真请求,只把 prisma / redis / 微信接口替换掉。
 */

const { db, store, prismaMock, redisMock } = vi.hoisted(() => {
    const db = { users: new Map<string, any>(), config: new Map<string, string>(), seq: 0 };
    const store = new Map<string, string>();
    const prismaMock = {
        user: {
            findUnique: async ({ where }: any) => {
                if (where.id) return db.users.get(where.id) ?? null;
                if (where.phone !== undefined) return [...db.users.values()].find((u) => u.phone === where.phone) ?? null;
                if (where.wxOpenid !== undefined) return [...db.users.values()].find((u) => u.wxOpenid === where.wxOpenid) ?? null;
                return null;
            },
            create: async ({ data }: any) => {
                const u = { id: `u${++db.seq}`, wxUnionid: null, wxNickname: null, phone: null, email: null, subscriptionEndDate: null, tokenVersion: 0, ...data };
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
                where.key.in.filter((k: string) => db.config.has(k)).map((k: string) => ({ key: k, value: db.config.get(k) })),
            findUnique: async ({ where }: any) =>
                db.config.has(where.key) ? { key: where.key, value: db.config.get(where.key) } : null,
        },
        usageLog: { count: async () => 0, groupBy: async () => [] },
    };
    const redisMock = {
        get: async (k: string) => store.get(k) ?? null,
        set: async (k: string, v: string) => { store.set(k, v); return 'OK' as const; },
        del: async (k: string) => (store.delete(k) ? 1 : 0),
        incr: async (k: string) => { const n = Number(store.get(k) ?? '0') + 1; store.set(k, String(n)); return n; },
        expire: async () => 1,
        ttl: async () => 60,
    };
    return { db, store, prismaMock, redisMock };
});

vi.mock('../../config/database', () => ({ default: prismaMock }));
vi.mock('../../utils/redis', () => ({ default: redisMock }));

let server: Server;
let base = '';
const realFetch = globalThis.fetch;

beforeAll(async () => {
    process.env.JWT_SECRET = 'integration-test-secret';
    process.env.FRONTEND_URL = 'https://docflow.test';
    process.env.PUBLIC_URL = 'https://docflow.test';
    const authRoutes = (await import('../auth')).default;
    const app = express();
    app.use(express.json());
    app.use('/api/auth', authRoutes);
    await new Promise<void>((resolve) => {
        server = app.listen(0, () => {
            base = `http://127.0.0.1:${(server.address() as any).port}`;
            resolve();
        });
    });
});

afterAll(() => {
    globalThis.fetch = realFetch;
    server?.close();
});

beforeEach(() => {
    db.users.clear();
    db.config.clear();
    db.seq = 0;
    store.clear();
    globalThis.fetch = realFetch;
    // 必须清掉:开发机 .env 里若配了真凭据,「未配置」这组用例会被污染成已配置
    // (实测踩过 —— 凭据一填进本地 .env,两条断言当场翻红)。
    delete process.env.WXLOGIN_APPID;
    delete process.env.WXLOGIN_SECRET;
});

/** 微信的两个接口都替换掉:换 token / 取昵称 */
const mockWechatApi = (identity: { openid?: string; unionid?: string; errcode?: number }) => {
    globalThis.fetch = (async (url: any, init?: any) => {
        const u = String(url);
        if (u.includes('/sns/oauth2/access_token')) {
            return new Response(JSON.stringify(
                identity.openid
                    ? { openid: identity.openid, unionid: identity.unionid, access_token: 'at' }
                    : { errcode: identity.errcode ?? 40029 },
            ));
        }
        if (u.includes('/sns/userinfo')) return new Response(JSON.stringify({ nickname: '测试昵称' }));
        return realFetch(url, init);
    }) as typeof fetch;
};

const configure = () => {
    db.config.set('WXLOGIN_APPID', 'wxtestappid123456');
    db.config.set('WXLOGIN_SECRET', 'testsecret');
};

/**
 * 不用 fetch —— Node 的 fetch 即便 redirect:'manual' 也会去解析 Location 的域名,
 * 而我们的回调故意跳向 docflow.test(不存在的域),会 ENOTFOUND。
 * 直接用 http 模块拿原始响应,重定向对我们来说本来就是要断言的东西。
 */
const get = (path: string): Promise<{ status: number; headers: Record<string, string>; text: string; json: () => any }> =>
    new Promise((resolve, reject) => {
        http.get(base + path, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve({
                status: res.statusCode ?? 0,
                headers: res.headers as Record<string, string>,
                text: body,
                json: () => JSON.parse(body),
            }));
        }).on('error', reject);
    });

describe('GET /wechat/status', () => {
    it('没配凭据 → enabled false(前端据此隐藏入口)', async () => {
        const d = (await get('/api/auth/wechat/status')).json();
        expect(d.data.enabled).toBe(false);
    });

    it('配了凭据 → enabled true', async () => {
        configure();
        const d = (await get('/api/auth/wechat/status')).json();
        expect(d.data.enabled).toBe(true);
    });
});

describe('GET /wechat/start', () => {
    it('没配凭据 → 404,不返回半个二维码地址', async () => {
        expect((await get('/api/auth/wechat/start?json=1')).status).toBe(404);
    });

    it('返回的二维码地址参数完整,回调地址与授权回调域同域', async () => {
        configure();
        const d = (await get('/api/auth/wechat/start?json=1')).json();
        const url = d.data.url as string;
        expect(url).toContain('open.weixin.qq.com/connect/qrconnect');
        expect(url).toContain('appid=wxtestappid123456');
        expect(url).toContain('scope=snsapi_login');
        expect(url).toContain(encodeURIComponent('https://docflow.test/api/auth/wechat/callback'));
        expect(url).toContain('self_redirect=false');
    });

    it('不带 json 时是 302 直跳', async () => {
        configure();
        const r = await get('/api/auth/wechat/start');
        expect(r.status).toBe(302);
        expect(r.headers['location']).toContain('qrconnect');
    });
});

describe('GET /wechat/callback', () => {
    /** 走一遍 start 拿到合法 state(它是签过名的,不能手造) */
    const freshState = async (ref?: string) => {
        const d = (await get(`/api/auth/wechat/start?json=1${ref ? `&ref=${ref}` : ''}`)).json();
        return new URL(d.data.url).searchParams.get('state')!;
    };

    it('state 伪造 → 回首页带 wxerr,绝不建号', async () => {
        configure();
        const r = await get('/api/auth/wechat/callback?code=x&state=forged');
        expect(r.status).toBe(302);
        expect(r.headers['location']).toContain('wxerr=state');
        expect(db.users.size).toBe(0);
    });

    it('没有 code → wxerr=nocode', async () => {
        configure();
        const r = await get(`/api/auth/wechat/callback?state=${encodeURIComponent(await freshState())}`);
        expect(r.headers['location']).toContain('wxerr=nocode');
    });

    it('微信换 token 失败 → wxerr=exchange,不建号', async () => {
        configure();
        mockWechatApi({ errcode: 40029 });
        const r = await get(`/api/auth/wechat/callback?code=bad&state=${encodeURIComponent(await freshState())}`);
        expect(r.headers['location']).toContain('wxerr=exchange');
        expect(db.users.size).toBe(0);
    });

    it('正常扫码 → 建号 + 回跳带一次性票(票在 URL,令牌不在)', async () => {
        configure();
        mockWechatApi({ openid: 'openid-A', unionid: 'union-A' });
        const r = await get(`/api/auth/wechat/callback?code=ok&state=${encodeURIComponent(await freshState())}`);
        const loc = r.headers['location']!;
        expect(loc).toMatch(/^https:\/\/docflow\.test\/\?wxlogin=[a-f0-9]{48}$/);
        expect(loc).not.toContain('eyJ');            // 不能是 JWT
        expect(db.users.size).toBe(1);
        const u = [...db.users.values()][0];
        expect(u.wxOpenid).toBe('openid-A');
        expect(u.wxUnionid).toBe('union-A');
        expect(u.subscriptionStatus).toBe('FREE');
    });

    it('同一个微信号再扫一次 → 复用账号,不重复建号', async () => {
        configure();
        mockWechatApi({ openid: 'openid-A' });
        await get(`/api/auth/wechat/callback?code=ok&state=${encodeURIComponent(await freshState())}`);
        await get(`/api/auth/wechat/callback?code=ok2&state=${encodeURIComponent(await freshState())}`);
        expect(db.users.size).toBe(1);
    });
});

describe('POST /wechat/finish', () => {
    const finish = (ticket: string): Promise<{ status: number; json: () => any }> =>
        new Promise((resolve, reject) => {
            const body = JSON.stringify({ ticket });
            const u = new URL(base + '/api/auth/wechat/finish');
            const req = http.request({
                hostname: u.hostname, port: u.port, path: u.pathname, method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
            }, (res) => {
                let t = '';
                res.on('data', (c) => { t += c; });
                res.on('end', () => resolve({ status: res.statusCode ?? 0, json: () => JSON.parse(t) }));
            });
            req.on('error', reject);
            req.end(body);
        });

    /** 完整走到拿票这一步 */
    const getTicket = async () => {
        configure();
        mockWechatApi({ openid: 'openid-A' });
        const s = (await get('/api/auth/wechat/start?json=1')).json();
        const state = new URL(s.data.url).searchParams.get('state')!;
        const r = await get(`/api/auth/wechat/callback?code=ok&state=${encodeURIComponent(state)}`);
        return new URL(r.headers['location']!).searchParams.get('wxlogin')!;
    };

    it('拿票换到正式令牌与用户信息', async () => {
        const d = (await finish(await getTicket())).json();
        expect(d.data.token.split('.')).toHaveLength(3);      // 是 JWT
        expect(d.data.user.id).toBeTruthy();
        expect(d.data.user.subscriptionStatus).toBe('FREE');
    });

    it('同一张票不能用第二次(防重放)', async () => {
        const t = await getTicket();
        expect((await finish(t)).status).toBe(200);
        expect((await finish(t)).status).toBe(400);
    });

    it('乱填的票直接 400', async () => {
        for (const bad of ['', 'abc', 'z'.repeat(48)]) {
            expect((await finish(bad)).status).toBe(400);
        }
    });

    it('封禁用户拿到票也登不进来', async () => {
        const t = await getTicket();
        const uid = [...db.users.keys()][0];
        store.set(`banned:${uid}`, '1');
        expect((await finish(t)).status).toBe(403);
    });
});

describe('微信用户在后台的可管理性', () => {
    /** 走完整链路造一个「只有微信、没有手机号」的用户 */
    const makeWechatUser = async () => {
        configure();
        mockWechatApi({ openid: 'openid-admin-test', unionid: 'union-1' });
        const d = (await get('/api/auth/wechat/start?json=1')).json();
        const state = new URL(d.data.url).searchParams.get('state')!;
        await get(`/api/auth/wechat/callback?code=ok&state=${encodeURIComponent(state)}`);
        return [...db.users.values()][0];
    };

    it('微信用户没有手机号和邮箱 —— 后台不能只靠这两项认人', async () => {
        const u = await makeWechatUser();
        expect(u.phone ?? null).toBeNull();
        expect(u.email ?? null).toBeNull();
        // 昵称是唯一能认出人的东西,必须存下来
        expect(u.wxNickname).toBe('测试昵称');
    });

    it('额度与档位字段和手机用户完全一致(加次数/改档位天然可用)', async () => {
        const u = await makeWechatUser();
        expect(u.subscriptionStatus).toBe('FREE');
        expect(u.bonusQuota ?? 0).toBe(0);
        expect(u.id).toBeTruthy();          // 封禁/加次数/统计全按 id,与登录方式无关
    });
});
