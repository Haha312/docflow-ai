/**
 * 邀请奖励配置。数值全部可用环境变量覆盖 —— 上线后发现松了紧了,改 .env 重启即可,不用改代码。
 *
 * 定档依据(2026-08 与产品确认):
 *   FREE 终身 3 次;PLUS 50 次/月 ¥29。双向各 +5、封顶 +20(4 次成功邀请),
 *   邀满是 23 次 —— 相对 3 次有 7.6 倍吸引力,又明显低于 PLUS 的 50 次/月,
 *   不至于让人靠拉人就永久免费,档位关系是正的。
 *
 * 四道闸,少一道都会被薅:
 *   1) 被邀请人「完成一次真实生成」后才发奖 —— 防注册即薅;
 *   2) 那次生成要够长(minChars)—— DocFlow 一次生成可能烧掉大量 token,
 *      传一句话就算数的话,刷号成本几乎为零;
 *   3) 每人封顶(maxBonusPerUser);
 *   4) 全站月度发放预算(monthlyBudget)—— 最终保险丝,超了当月停发。
 *   另加:同 IP 短时间内的重复邀请直接判为自邀,不发奖。
 */

const num = (key: string, fallback: number): number => {
    const v = Number(process.env[key]);
    return Number.isFinite(v) && v >= 0 ? v : fallback;
};

export const REFERRAL = {
    /** 一次成功邀请,邀请人与被邀请人各得多少次 */
    bonus: num('REFERRAL_BONUS', 5),
    /** 单个用户通过邀请最多能拿到多少次(累计) */
    maxBonusPerUser: num('REFERRAL_MAX_BONUS_PER_USER', 20),
    /** 被邀请人那次生成的最小字符数,低于此值不算「真实使用」 */
    minChars: num('REFERRAL_MIN_CHARS', 1000),
    /** 全站每月最多发放多少次额度(邀请人+被邀请人合计) */
    monthlyBudget: num('REFERRAL_MONTHLY_BUDGET', 2000),
    /** 同一 IP 在这么多小时内的重复邀请视为自邀 */
    sameIpWindowHours: num('REFERRAL_SAME_IP_WINDOW_HOURS', 24),
};

/** 邀请码字符集:去掉 0/O、1/I/l 这些手抄易混的字符 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const generateReferralCode = (length = 6): string => {
    let out = '';
    for (let i = 0; i < length; i += 1) {
        out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return out;
};
