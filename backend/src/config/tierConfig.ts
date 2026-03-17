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
