import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * recordUsage 只有一条铁律:**永不抛异常**。
 *
 * 它跑在「文档已经生成完、还没 res.write 给用户」之间。早先那版是裸 await,
 * 插日志一失败就跳进 catch,把内存里排好的整篇文档丢掉、改发 15 字兜底版 ——
 * AI 的钱已经花了,成稿却没送出去。线上真发生过一次(账号已删,外键冲突 P2003)。
 *
 * 所以这里挨个模拟会让它炸的场景,断言它一次都不往外抛。
 */

const { calls, prismaMock, redisMock, fail } = vi.hoisted(() => {
    const calls = { created: [] as any[], deleted: [] as string[] };
    const fail = { create: null as Error | null, del: null as Error | null };
    const prismaMock = {
        usageLog: {
            create: async ({ data }: any) => {
                if (fail.create) throw fail.create;
                calls.created.push(data);
                return { id: 'log1', ...data };
            },
        },
    };
    const redisMock = {
        get: async () => null,
        set: async () => 'OK' as const,
        del: async (k: string) => {
            if (fail.del) throw fail.del;
            calls.deleted.push(k);
            return 1;
        },
    };
    return { calls, prismaMock, redisMock, fail };
});

vi.mock('../../config/database', () => ({ default: prismaMock }));
vi.mock('../redis', () => ({ default: redisMock }));

import { recordUsage } from '../usageCount';

beforeEach(() => {
    calls.created.length = 0;
    calls.deleted.length = 0;
    fail.create = null;
    fail.del = null;
    // 每个用例都要一支干净的 spy:不清的话 calls[0] 会是上一个用例留下的那条
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('recordUsage 正常路径', () => {
    it('写入一条用量并让缓存失效', async () => {
        const ok = await recordUsage('u1', 'generate_document', 'REPORT', 1234);
        expect(ok).toBe(true);
        expect(calls.created).toEqual([
            { userId: 'u1', actionType: 'generate_document', presetUsed: 'REPORT', tokenUsage: 1234 },
        ]);
        expect(calls.deleted.length).toBe(1);
    });

    it('低质量结果用不同的 actionType —— 额度计数器据此不计费', async () => {
        await recordUsage('u1', 'generate_document_lowquality', 'REPORT', 10);
        expect(calls.created[0].actionType).toBe('generate_document_lowquality');
    });
});

describe('记账失败绝不能往外抛(否则会把已生成的文档一起带走)', () => {
    it('外键冲突(账号已被删)—— 线上真实发生过的那一种', async () => {
        fail.create = Object.assign(new Error('Foreign key constraint violated'), { code: 'P2003' });
        const ok = await recordUsage('已删除的用户', 'generate_document', 'REPORT', 1234);
        expect(ok).toBe(false);            // 如实报告失败
    });

    it('数据库整个连不上', async () => {
        fail.create = new Error('Can\'t reach database server');
        await expect(recordUsage('u1', 'generate_document', 'REPORT', 1)).resolves.toBe(false);
    });

    it('日志写进去了、只是清缓存炸了 —— 算成功', async () => {
        // 账已经落库(DB 才是真实源),缓存没清上最多 60s 后自己过期。
        // 这种情况报 false 会误导人以为没记上。
        fail.del = new Error('redis connection lost');
        await expect(recordUsage('u1', 'generate_document', 'REPORT', 1)).resolves.toBe(true);
        expect(calls.created.length).toBe(1);
    });

    it('抛的不是 Error 对象也照样兜住', async () => {
        fail.create = '字符串异常' as unknown as Error;
        await expect(recordUsage('u1', 'generate_document', 'REPORT', 1)).resolves.toBe(false);
    });

    it('失败时留下可排查的日志,而不是悄无声息', async () => {
        const spy = vi.mocked(console.error);
        fail.create = new Error('boom');
        await recordUsage('u-42', 'generate_document', 'REPORT', 1);
        expect(spy).toHaveBeenCalled();
        const msg = String(spy.mock.calls[0][0]);
        expect(msg).toContain('USAGE_LOG_FAILED');
        expect(msg).toContain('u-42');       // 出事时得知道是谁
    });
});
