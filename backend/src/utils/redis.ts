import Redis from 'ioredis';

class MockRedis {
    private store = new Map<string, { value: string; expiry: number | null }>();

    constructor() {
        console.warn('Redis unavailable. Using in-memory MockRedis.');
    }

    async get(key: string): Promise<string | null> {
        const item = this.store.get(key);
        if (!item) return null;
        if (item.expiry && Date.now() > item.expiry) {
            this.store.delete(key);
            return null;
        }
        return item.value;
    }

    async set(key: string, value: string, mode?: string, duration?: number): Promise<'OK'> {
        let expiry: number | null = null;
        if (mode === 'EX' && typeof duration === 'number') {
            expiry = Date.now() + duration * 1000;
        }
        this.store.set(key, { value, expiry });
        return 'OK';
    }

    async del(key: string): Promise<number> {
        return this.store.delete(key) ? 1 : 0;
    }

    async incr(key: string): Promise<number> {
        const item = this.store.get(key);
        // 过期的 key 视为不存在
        if (item && item.expiry && Date.now() > item.expiry) {
            this.store.delete(key);
        }
        const existing = this.store.get(key);
        const next = (existing ? parseInt(existing.value, 10) || 0 : 0) + 1;
        this.store.set(key, { value: String(next), expiry: existing?.expiry ?? null });
        return next;
    }

    async expire(key: string, seconds: number): Promise<number> {
        const item = this.store.get(key);
        if (!item) return 0;
        item.expiry = Date.now() + seconds * 1000;
        return 1;
    }

    on(_event: string, _callback: (...args: any[]) => void): void {
        // no-op for compatibility
    }
}

interface RedisLike {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, mode?: string, duration?: number): Promise<'OK' | string>;
    del(key: string): Promise<number>;
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
    on(event: string, callback: (...args: any[]) => void): void;
}

if (process.env.NODE_ENV === 'production' && !process.env.REDIS_URL) {
    throw new Error('REDIS_URL is required in production.');
}

const redis: RedisLike = process.env.REDIS_URL
    ? (new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 }) as unknown as RedisLike)
    : new MockRedis();

redis.on('error', () => {
    // keep silent to avoid noisy logs in fallback scenarios
});

export default redis;
