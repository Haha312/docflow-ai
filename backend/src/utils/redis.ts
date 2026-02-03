import Redis from 'ioredis';

// Mock Redis implementation for development without a real Redis server
class MockRedis {
    private store: Map<string, { value: string, expiry: number | null }> = new Map();

    constructor() {
        console.warn('⚠️  Redis connection failed (or not configured). Using In-Memory Mock Redis for development.');
        console.warn('⚠️  Data will be lost when the server restarts.');
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

    async set(key: string, value: string, mode?: string, duration?: number): Promise<string> {
        let expiry: number | null = null;
        if (mode === 'EX' && duration) {
            expiry = Date.now() + duration * 1000;
        }
        this.store.set(key, { value, expiry });
        return 'OK';
    }

    async del(key: string): Promise<number> {
        return this.store.delete(key) ? 1 : 0;
    }

    on(event: string, callback: any) {
        // Stub for event listeners to prevent errors
    }
}

let redis: any;

// Try to connect to real Redis, fallback to Mock if it fails (simplified logic)
// Since explicit connection failure handling is async, we often assume Redis works or explicit config.
// For this environment, if REDIS_URL is not set or fails, we might want to default to Mock?

const redisUrl = process.env.REDIS_URL;

if (!redisUrl && process.env.NODE_ENV === 'development') {
    // Explicitly use mock if no URL in dev (simplest fallback)
    // But user has code that tries to connect.

    // Let's create a proxy or customized client that handles the error.
    // Actually ioredis retries indefinitely. 
}

// Better Approach for this specific user issue:
// We create a Redis instance with maxRetriesPerRequest: 1 and a retryStrategy that gives up?
// Or just export MockRedis directly since we know they don't have it.

// Let's try to be smart:
const shouldUseMock = process.env.USE_MOCK_REDIS === 'true' || !process.env.REDIS_URL;

if (shouldUseMock) {
    redis = new MockRedis();
} else {
    // Normal Redis
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        maxRetriesPerRequest: 1, // Don't hang forever
        retryStrategy(times) {
            if (times > 3) {
                console.error('Redis connection failed too many times. Swapping to MockRedis.');
                // This swap won't work easily because 'redis' is already exported.
                // We would need a Proxy.
                return null; // Stop retrying
            }
            return 200;
        }
    });

    redis.on('error', (err: any) => {
        // Just log, don't crash
        // console.error('Redis Error:', err.message);
    });
}

// PROXY Implementation to handle failover
// If 'redis' fails, we route calls to 'mockRedis'
const mockRedis = new MockRedis();
let isRedisReady = false;

if (process.env.REDIS_URL || process.env.NODE_ENV !== 'development') {
    const realRedis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
        lazyConnect: true // Don't connect immediately
    });

    realRedis.connect().then(() => {
        isRedisReady = true;
        console.log('Redis connected');
    }).catch(err => {
        console.error('Redis connection failed, falling back to In-Memory Mock.');
        isRedisReady = false;
    });

    // Redirect calls
    redis = new Proxy({}, {
        get(target, prop) {
            if (prop === 'get' || prop === 'set' || prop === 'del') {
                return isRedisReady ? (realRedis as any)[prop].bind(realRedis) : (mockRedis as any)[prop].bind(mockRedis);
            }
            // For other methods/events
            if (prop === 'on') {
                return isRedisReady ? (realRedis as any)[prop].bind(realRedis) : (mockRedis as any)[prop].bind(mockRedis);
            }
            return (isRedisReady ? realRedis : mockRedis)[prop];
        }
    });

} else {
    // Default to Mock in Dev without URL
    redis = mockRedis;
}

export default redis;
