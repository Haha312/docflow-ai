import prisma from '../config/database';

/**
 * 获取管理员手机号列表。
 * 优先级:SystemConfig.ADMIN_PHONES > 环境变量 ADMIN_PHONES。
 * 没有任何配置时返回空数组(没有管理员)。
 *
 * 不硬编码任何真实手机号 — 配置必须通过环境变量或数据库注入。
 */
export async function getAdminPhones(): Promise<string[]> {
    try {
        const config = await prisma.systemConfig.findUnique({ where: { key: 'ADMIN_PHONES' } });
        if (config?.value) {
            return config.value
                .split(',')
                .map((p: string) => p.trim())
                .filter(Boolean);
        }
    } catch {
        // SystemConfig 表可能尚未存在(全新部署),走 env fallback
    }

    return (process.env.ADMIN_PHONES || '')
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean);
}

export async function isAdmin(phone: string | undefined | null): Promise<boolean> {
    if (!phone) return false;
    const list = await getAdminPhones();
    return list.includes(phone);
}

/**
 * 管理员调整赠送次数的规则(纯函数,路由与测试共用同一口径):
 *  - 只收非零整数,绝对值封顶 10000(防手滑多敲个零);
 *  - 结果落在 bonusQuota 上,减到 0 为止(bonusQuota 永不为负,
 *    否则会倒扣档位本身的额度,把付费用户扣成负资产)。
 */
export const applyQuotaDelta = (
    current: number,
    delta: unknown,
): { ok: true; value: number } | { ok: false; error: string } => {
    const n = Number(delta);
    if (!Number.isInteger(n) || n === 0 || Math.abs(n) > 10000) {
        return { ok: false, error: 'addQuota 须为非零整数,绝对值不超过 10000' };
    }
    return { ok: true, value: Math.max(0, current + n) };
};
