import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import app from '../server';
import prisma from '../config/database';
import redis from '../utils/redis';

const mockPrisma = prisma as any;
const mockRedis = redis as any;

describe('GET /health', () => {
    it('returns ok status', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
    });
});

describe('POST /api/auth/login', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 400 when credentials are missing', async () => {
        const res = await request(app).post('/api/auth/login').send({});
        expect(res.status).toBe(400);
    });

    it('returns 400 when password is missing', async () => {
        const res = await request(app).post('/api/auth/login').send({ email: 'test@example.com' });
        expect(res.status).toBe(400);
    });

    it('returns 401 when user does not exist', async () => {
        mockPrisma.user.findUnique.mockResolvedValue(null);
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'notfound@example.com', password: 'pass123' });
        expect(res.status).toBe(401);
    });

    it('returns 401 when password is wrong', async () => {
        const hash = await bcrypt.hash('correctPassword', 10);
        mockPrisma.user.findUnique.mockResolvedValue({
            id: 'user-1',
            email: 'user@example.com',
            passwordHash: hash,
            subscriptionStatus: 'FREE',
            subscriptionEndDate: null,
        });
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'user@example.com', password: 'wrongPassword' });
        expect(res.status).toBe(401);
    });

    it('returns token on successful login', async () => {
        const hash = await bcrypt.hash('correctPassword', 10);
        mockPrisma.user.findUnique.mockResolvedValue({
            id: 'user-1',
            email: 'user@example.com',
            passwordHash: hash,
            subscriptionStatus: 'FREE',
            subscriptionEndDate: null,
        });
        const res = await request(app)
            .post('/api/auth/login')
            .send({ email: 'user@example.com', password: 'correctPassword' });
        expect(res.status).toBe(200);
        expect(res.body.data).toHaveProperty('token');
        expect(res.body.data.user.email).toBe('user@example.com');
    });
});

describe('POST /api/auth/register', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns 400 when fields are missing', async () => {
        const res = await request(app).post('/api/auth/register').send({});
        expect(res.status).toBe(400);
    });

    it('returns 400 when email code is missing', async () => {
        const res = await request(app)
            .post('/api/auth/register')
            .send({ email: 'new@example.com', password: 'Password1!' });
        expect(res.status).toBe(400);
    });

    it('returns 400 when email verification code is invalid', async () => {
        mockRedis.get.mockResolvedValue(null);
        const res = await request(app)
            .post('/api/auth/register')
            .send({ email: 'new@example.com', password: 'Password1!', code: '123456' });
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('AUTH_INVALID_CODE');
    });

    it('returns 409 when email already exists', async () => {
        mockRedis.get.mockResolvedValue('654321');
        mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing', email: 'taken@example.com' });
        const res = await request(app)
            .post('/api/auth/register')
            .send({ email: 'taken@example.com', password: 'Password1!', code: '654321' });
        expect(res.status).toBe(409);
    });

    it('creates user and returns 201 on success', async () => {
        mockRedis.get.mockResolvedValue('999888');
        mockRedis.del.mockResolvedValue(1);
        mockPrisma.user.findUnique.mockResolvedValue(null);
        mockPrisma.user.create.mockResolvedValue({
            id: 'new-user-id',
            email: 'new@example.com',
            subscriptionStatus: 'FREE',
            createdAt: new Date().toISOString(),
        });
        const res = await request(app)
            .post('/api/auth/register')
            .send({ email: 'new@example.com', password: 'Password1!', code: '999888' });
        expect(res.status).toBe(201);
        expect(res.body.data.email).toBe('new@example.com');
    });
});
