import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bindReferral, rewardOnFirstRealUse } from '../referral';
import { REFERRAL } from '../../config/referralConfig';

/**
 * 邀请奖励的四道闸。每一道都要能单独拦住 —— 少一道就会被薅:
 *   1) 被邀请人完成一次真实生成后才发奖(防注册即薅)
 *   2) 那次生成要够长(DocFlow 一次生成可能烧掉大量 token,传一句话不能算数)
 *   3) 每人封顶
 *   4) 全站月度预算
 * 另加:同 IP 短时间内重复邀请判为自邀。
 */

// vi.mock 会被提升到文件顶部,所以假 prisma 必须放进 vi.hoisted 里,否则 mock 工厂访问不到它
const { db, prismaMock } = vi.hoisted(() => {
    const db = {
        user: new Map<string, { id: string; bonusQuota: number; referralCode?: string | null }>(),
        referral: [] as any[],
    };
    const prismaMock = {
        user: {
            findUnique: async ({ where, select }: any) => {
                const u = where.id ? db.user.get(where.id)
                    : [...db.user.values()].find((x) => x.referralCode === where.referralCode);
                if (!u) return null;
                return select ? Object.fromEntries(Object.keys(select).map((k) => [k, (u as any)[k]])) : u;
            },
            update: async ({ where, data }: any) => {
                const u = db.user.get(where.id)!;
                if (data.bonusQuota?.increment != null) u.bonusQuota += data.bonusQuota.increment;
                if (data.referralCode !== undefined) u.referralCode = data.referralCode;
                return u;
            },
        },
        referral: {
            findUnique: async ({ where }: any) => db.referral.find((r) => r.inviteeId === where.inviteeId) ?? null,
            create: async ({ data }: any) => { const r = { id: `r${db.referral.length}`, ...data }; db.referral.push(r); return r; },
            update: async ({ where, data }: any) => {
                const r = db.referral.find((x) => x.id === where.id)!;
                Object.assign(r, data); return r;
            },
            count: async ({ where }: any) => db.referral.filter((r) => {
                if (where.status && r.status !== where.status) return false;
                if (where.referrerId && r.referrerId !== where.referrerId) return false;
                if (where.signupIp && r.signupIp !== where.signupIp) return false;
                return true;
            }).length,
            groupBy: async () => [],
        },
        $transaction: async (ops: any[]) => Promise.all(ops),
    };
    return { db, prismaMock };
});

vi.mock('@prisma/client', () => ({
    ReferralStatus: { PENDING: 'PENDING', REWARDED: 'REWARDED', REJECTED: 'REJECTED' },
}));
vi.mock('../../config/database', () => ({ default: prismaMock }));


const addUser = (id: string, bonusQuota = 0, referralCode: string | null = null) =>
    db.user.set(id, { id, bonusQuota, referralCode });

beforeEach(() => {
    db.user.clear();
    db.referral.length = 0;
    vi.clearAllMocks();
});

describe('邀请绑定', () => {
    it('正常绑定为待发放,此时一分钱奖励都不发', async () => {
        addUser('A', 0, 'CODEAA'); addUser('B');
        await bindReferral('B', 'CODEAA', '1.1.1.1');
        expect(db.referral[0]).toMatchObject({ referrerId: 'A', inviteeId: 'B', status: 'PENDING' });
        expect(db.user.get('A')!.bonusQuota).toBe(0);
        expect(db.user.get('B')!.bonusQuota).toBe(0);
    });

    it('自己邀自己 → 不登记', async () => {
        addUser('A', 0, 'CODEAA');
        await bindReferral('A', 'CODEAA', '1.1.1.1');
        expect(db.referral).toHaveLength(0);
    });

    it('一个人只能被邀请一次', async () => {
        addUser('A', 0, 'CODEAA'); addUser('C', 0, 'CODECC'); addUser('B');
        await bindReferral('B', 'CODEAA', '1.1.1.1');
        await bindReferral('B', 'CODECC', '2.2.2.2');
        expect(db.referral).toHaveLength(1);
    });

    it('码无效 → 静默跳过,不影响注册', async () => {
        addUser('B');
        await expect(bindReferral('B', 'NOSUCH', '1.1.1.1')).resolves.toBeUndefined();
        expect(db.referral).toHaveLength(0);
    });

    it('同 IP 重复邀请 → 判为自邀,登记但拒绝', async () => {
        addUser('A', 0, 'CODEAA'); addUser('B'); addUser('C');
        await bindReferral('B', 'CODEAA', '9.9.9.9');
        await bindReferral('C', 'CODEAA', '9.9.9.9');
        expect(db.referral[1].status).toBe('REJECTED');
        expect(db.referral[1].rejectReason).toContain('同 IP');
    });
});

describe('发奖的四道闸', () => {
    const bindPending = () => {
        addUser('A', 0, 'CODEAA'); addUser('B');
        db.referral.push({ id: 'r0', referrerId: 'A', inviteeId: 'B', status: 'PENDING' });
    };

    it('闸1:没有真实生成就没有奖励(只绑定不发)', async () => {
        bindPending();
        expect(db.user.get('A')!.bonusQuota).toBe(0);
    });

    it('闸2:内容太短不算真实使用', async () => {
        bindPending();
        const r = await rewardOnFirstRealUse('B', REFERRAL.minChars - 1);
        expect(r.rewarded).toBe(false);
        expect(r.reason).toContain('不足');
        expect(db.user.get('A')!.bonusQuota).toBe(0);
    });

    it('内容够长 → 双方各得 bonus', async () => {
        bindPending();
        const r = await rewardOnFirstRealUse('B', REFERRAL.minChars);
        expect(r.rewarded).toBe(true);
        expect(db.user.get('A')!.bonusQuota).toBe(REFERRAL.bonus);
        expect(db.user.get('B')!.bonusQuota).toBe(REFERRAL.bonus);
    });

    it('同一条邀请不会重复发奖', async () => {
        bindPending();
        await rewardOnFirstRealUse('B', REFERRAL.minChars);
        const again = await rewardOnFirstRealUse('B', REFERRAL.minChars);
        expect(again.rewarded).toBe(false);
        expect(db.user.get('A')!.bonusQuota).toBe(REFERRAL.bonus);
    });

    it('闸3:邀请人已拿满封顶 → 不再增加,被邀请人照常拿', async () => {
        addUser('A', REFERRAL.maxBonusPerUser, 'CODEAA'); addUser('B');
        db.referral.push({ id: 'r0', referrerId: 'A', inviteeId: 'B', status: 'PENDING' });
        await rewardOnFirstRealUse('B', REFERRAL.minChars);
        expect(db.user.get('A')!.bonusQuota).toBe(REFERRAL.maxBonusPerUser);
        expect(db.user.get('B')!.bonusQuota).toBe(REFERRAL.bonus);
    });

    it('闸3:接近封顶时只补到封顶,不超发', async () => {
        addUser('A', REFERRAL.maxBonusPerUser - 2, 'CODEAA'); addUser('B');
        db.referral.push({ id: 'r0', referrerId: 'A', inviteeId: 'B', status: 'PENDING' });
        await rewardOnFirstRealUse('B', REFERRAL.minChars);
        expect(db.user.get('A')!.bonusQuota).toBe(REFERRAL.maxBonusPerUser);
    });

    it('闸4:全站月度预算用完 → 停发', async () => {
        bindPending();
        const perReward = REFERRAL.bonus * 2;
        const already = Math.ceil(REFERRAL.monthlyBudget / perReward);
        for (let i = 0; i < already; i += 1) {
            db.referral.push({ id: `hist${i}`, status: 'REWARDED', rewardedAt: new Date() });
        }
        const r = await rewardOnFirstRealUse('B', REFERRAL.minChars);
        expect(r.rewarded).toBe(false);
        expect(r.reason).toContain('预算');
        expect(db.user.get('A')!.bonusQuota).toBe(0);
    });

    it('被拒绝的邀请(自邀)永远不发奖', async () => {
        addUser('A', 0, 'CODEAA'); addUser('B');
        db.referral.push({ id: 'r0', referrerId: 'A', inviteeId: 'B', status: 'REJECTED' });
        const r = await rewardOnFirstRealUse('B', REFERRAL.minChars * 10);
        expect(r.rewarded).toBe(false);
        expect(db.user.get('A')!.bonusQuota).toBe(0);
    });
});

describe('配置数值与产品约定一致', () => {
    it('双向各 5 次、封顶 20 次', () => {
        expect(REFERRAL.bonus).toBe(5);
        expect(REFERRAL.maxBonusPerUser).toBe(20);
    });

    it('邀满后的总额度明显低于 PLUS 的 50 次/月,不倒挂档位', () => {
        const freeWithBonus = 3 + REFERRAL.maxBonusPerUser;
        expect(freeWithBonus).toBe(23);
        expect(freeWithBonus).toBeLessThan(50);
    });
});
