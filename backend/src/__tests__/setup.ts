import { vi } from 'vitest';

process.env.JWT_SECRET = 'test-secret-key-min-32-chars-long!!';
process.env.NODE_ENV = 'test';

vi.mock('../config/database', () => ({
    default: {
        user: {
            findUnique: vi.fn(),
            create: vi.fn(),
        },
        usageLog: {
            count: vi.fn(),
        },
        systemConfig: {
            findUnique: vi.fn().mockResolvedValue(null),
        },
    },
}));

vi.mock('../utils/redis', () => ({
    default: {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn(),
    },
}));

vi.mock('../services/emailService', () => ({
    sendVerificationEmail: vi.fn().mockResolvedValue(true),
}));
