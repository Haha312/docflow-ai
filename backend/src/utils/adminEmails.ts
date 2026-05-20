import prisma from '../config/database';

const getEnvAdminEmails = (): string[] => {
    const envEmails = process.env.ADMIN_EMAILS;
    if (envEmails) {
        return envEmails.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    }
    return ['admin@docuflow.ai'];
};

export const getAdminEmails = async (): Promise<string[]> => {
    try {
        const config = await prisma.systemConfig.findUnique({ where: { key: 'ADMIN_EMAILS' } });
        if (config?.value) {
            return config.value.split(',').map((e: string) => e.trim().toLowerCase());
        }
    } catch { /* SystemConfig may not exist */ }
    return getEnvAdminEmails();
};

export const isAdminEmail = async (email: string): Promise<boolean> => {
    const adminEmails = await getAdminEmails();
    return adminEmails.includes(email.toLowerCase());
};
