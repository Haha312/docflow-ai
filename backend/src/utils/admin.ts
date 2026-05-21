import prisma from '../config/database';

/**
 * 获取管理员邮箱列表。
 * 优先级:SystemConfig.ADMIN_EMAILS > 环境变量 ADMIN_EMAILS。
 * 没有任何配置时返回空数组(没有管理员)。
 *
 * 不再硬编码任何真实邮箱 — 配置必须通过环境变量或数据库注入。
 */
export async function getAdminEmails(): Promise<string[]> {
    try {
        const config = await prisma.systemConfig.findUnique({ where: { key: 'ADMIN_EMAILS' } });
        if (config?.value) {
            return config.value
                .split(',')
                .map((e: string) => e.trim().toLowerCase())
                .filter(Boolean);
        }
    } catch {
        // SystemConfig 表可能尚未存在(全新部署),走 env fallback
    }

    return (process.env.ADMIN_EMAILS || '')
        .split(',')
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean);
}

export async function isAdmin(email: string | undefined | null): Promise<boolean> {
    if (!email) return false;
    const list = await getAdminEmails();
    return list.includes(email.toLowerCase());
}
