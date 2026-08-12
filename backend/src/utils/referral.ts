import { ReferralStatus } from '@prisma/client';
import prisma from '../config/database';
import { REFERRAL, generateReferralCode } from '../config/referralConfig';

/** 取(或首次生成)用户的邀请码。码有唯一约束,重复了就重试。 */
export const ensureReferralCode = async (userId: string): Promise<string> => {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { referralCode: true } });
    if (user?.referralCode) return user.referralCode;

    for (let attempt = 0; attempt < 8; attempt += 1) {
        const code = generateReferralCode();
        try {
            const updated = await prisma.user.update({ where: { id: userId }, data: { referralCode: code } });
            return updated.referralCode!;
        } catch {
            // 撞码了,换一个再试
        }
    }
    throw new Error('生成邀请码失败:连续 8 次撞码');
};

/** 本月已发放的奖励次数(邀请人 + 被邀请人合计)—— 全站预算的分母 */
const rewardedThisMonth = async (): Promise<number> => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const count = await prisma.referral.count({
        where: { status: ReferralStatus.REWARDED, rewardedAt: { gte: monthStart } },
    });
    return count * REFERRAL.bonus * 2;   // 一条成功邀请发两份
};

/**
 * 绑定邀请关系。只登记,不发奖 —— 奖励等被邀请人真正用起来之后再说。
 * 任何一条不满足就静默跳过:邀请失败不该阻断注册。
 */
export const bindReferral = async (
    inviteeId: string,
    code: string,
    signupIp?: string,
): Promise<void> => {
    try {
        const normalized = (code || '').trim().toUpperCase();
        if (!normalized) return;

        const referrer = await prisma.user.findUnique({ where: { referralCode: normalized }, select: { id: true } });
        if (!referrer || referrer.id === inviteeId) return;          // 码无效,或自己邀自己

        const existing = await prisma.referral.findUnique({ where: { inviteeId } });
        if (existing) return;                                        // 一个人只能被邀请一次

        // 同 IP 短时间内反复邀请 → 判为自邀,登记但标记拒绝(留痕,便于事后核查)
        let rejectReason: string | null = null;
        if (signupIp) {
            const since = new Date(Date.now() - REFERRAL.sameIpWindowHours * 3600_000);
            const sameIp = await prisma.referral.count({
                where: { referrerId: referrer.id, signupIp, createdAt: { gte: since } },
            });
            if (sameIp > 0) rejectReason = `同 IP ${REFERRAL.sameIpWindowHours} 小时内重复邀请`;
        }

        await prisma.referral.create({
            data: {
                referrerId: referrer.id,
                inviteeId,
                code: normalized,
                signupIp: signupIp ?? null,
                status: rejectReason ? ReferralStatus.REJECTED : ReferralStatus.PENDING,
                rejectReason,
            },
        });
    } catch (error) {
        console.error('[referral] 绑定失败(不影响注册):', error);
    }
};

/**
 * 被邀请人完成一次「够长的」真实生成后调用 —— 这里才发奖。
 * 全程静默失败:发奖出问题绝不能影响用户拿到自己的成稿。
 */
export const rewardOnFirstRealUse = async (
    inviteeId: string,
    contentChars: number,
): Promise<{ rewarded: boolean; reason?: string }> => {
    try {
        if (contentChars < REFERRAL.minChars) {
            return { rewarded: false, reason: `内容不足 ${REFERRAL.minChars} 字符,不计为真实使用` };
        }

        const referral = await prisma.referral.findUnique({ where: { inviteeId } });
        if (!referral || referral.status !== ReferralStatus.PENDING) {
            return { rewarded: false, reason: '无待发放的邀请' };
        }

        if (await rewardedThisMonth() + REFERRAL.bonus * 2 > REFERRAL.monthlyBudget) {
            return { rewarded: false, reason: '本月邀请奖励预算已用完' };
        }

        const [referrer, invitee] = await Promise.all([
            prisma.user.findUnique({ where: { id: referral.referrerId }, select: { bonusQuota: true } }),
            prisma.user.findUnique({ where: { id: inviteeId }, select: { bonusQuota: true } }),
        ]);
        if (!referrer || !invitee) return { rewarded: false, reason: '用户不存在' };

        // 各自按封顶裁一刀:邀请人可能已经拿满,被邀请人几乎不会
        const referrerGain = Math.max(0, Math.min(REFERRAL.bonus, REFERRAL.maxBonusPerUser - referrer.bonusQuota));
        const inviteeGain = Math.max(0, Math.min(REFERRAL.bonus, REFERRAL.maxBonusPerUser - invitee.bonusQuota));

        await prisma.$transaction([
            prisma.user.update({ where: { id: referral.referrerId }, data: { bonusQuota: { increment: referrerGain } } }),
            prisma.user.update({ where: { id: inviteeId }, data: { bonusQuota: { increment: inviteeGain } } }),
            prisma.referral.update({
                where: { id: referral.id },
                data: { status: ReferralStatus.REWARDED, rewardedAt: new Date() },
            }),
        ]);
        console.log(`[referral] 发奖:邀请人 +${referrerGain}、被邀请人 +${inviteeGain}`);
        return { rewarded: true };
    } catch (error) {
        console.error('[referral] 发奖失败(不影响交付):', error);
        return { rewarded: false, reason: '发奖异常' };
    }
};

/** 邀请页要展示的数据 */
export const referralStats = async (userId: string) => {
    const [code, made, user] = await Promise.all([
        ensureReferralCode(userId),
        prisma.referral.groupBy({ by: ['status'], where: { referrerId: userId }, _count: true }),
        prisma.user.findUnique({ where: { id: userId }, select: { bonusQuota: true } }),
    ]);
    const countOf = (s: ReferralStatus) => made.find((m) => m.status === s)?._count ?? 0;
    return {
        code,
        bonusQuota: user?.bonusQuota ?? 0,
        invited: countOf(ReferralStatus.PENDING) + countOf(ReferralStatus.REWARDED),
        rewarded: countOf(ReferralStatus.REWARDED),
        pending: countOf(ReferralStatus.PENDING),
        remainingBonus: Math.max(0, REFERRAL.maxBonusPerUser - (user?.bonusQuota ?? 0)),
        rules: {
            bonus: REFERRAL.bonus,
            maxBonusPerUser: REFERRAL.maxBonusPerUser,
            minChars: REFERRAL.minChars,
        },
    };
};
