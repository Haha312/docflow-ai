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
