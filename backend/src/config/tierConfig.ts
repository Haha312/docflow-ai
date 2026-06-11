/**
 * 共享的会员等级配置
 * 避免在多个路由文件中重复定义
 */

// 各等级的使用限制
export const TIER_LIMITS: Record<string, number> = {
    'FREE': 3,      // 终身3次免费
    'PLUS': 50,     // 50次/月
    'PRO': 200,     // 200次/月
    'ULTRA': 1000   // 1000次/月
};

// content 文本长度上限(字符数,UTF-16 单元)。防超大输入烧 token / 打满服务器。
// FREE 200K 字符(约 10 万汉字),付费 2M 字符。
export const CONTENT_LIMIT: Record<string, number> = {
    'FREE': 200_000,
    'PLUS': 2_000_000,
    'PRO': 2_000_000,
    'ULTRA': 2_000_000,
};

/** 返回该等级允许的 content 最大字符数 */
export function getContentLimit(tier: string): number {
    return CONTENT_LIMIT[tier] ?? CONTENT_LIMIT.FREE;
}

/**
 * 根据 planType 字符串推导订阅等级
 * @param planType - 如 'plus_monthly', 'pro_yearly', 'ultra_monthly' 等
 * @returns 对应的订阅等级 'PLUS' | 'PRO' | 'ULTRA'
 */
export function getTierFromPlanType(planType: string): 'PLUS' | 'PRO' | 'ULTRA' {
    if (planType.includes('ultra')) return 'ULTRA';
    if (planType.includes('pro')) return 'PRO';
    return 'PLUS';
}
