import { describe, it, expect } from 'vitest';
import { successResponse, errorResponse, isValidEmail, isValidPassword } from '../response';

describe('response helpers', () => {
    describe('successResponse', () => {
        it('wraps data with code 200 and default message', () => {
            const r = successResponse({ id: 1 });
            expect(r.code).toBe(200);
            expect(r.data).toEqual({ id: 1 });
            expect(typeof r.message).toBe('string');
        });

        it('uses custom message when provided', () => {
            const r = successResponse({ ok: true }, '注册成功');
            expect(r.message).toBe('注册成功');
        });
    });

    describe('errorResponse', () => {
        it('returns error code and message', () => {
            const r = errorResponse('AUTH_NO_TOKEN', 401);
            expect(r.code).toBe(401);
            expect(r.message).toBe('AUTH_NO_TOKEN');
        });
    });

    describe('isValidEmail', () => {
        it.each([
            ['user@example.com', true],
            ['test.foo+bar@sub.example.co.uk', true],
            ['no-at-sign', false],
            ['missing@', false],
            ['@nodomain.com', false],
            ['', false],
        ])('isValidEmail(%j) === %s', (input, expected) => {
            expect(isValidEmail(input)).toBe(expected);
        });
    });

    describe('isValidPassword', () => {
        it('rejects too-short passwords', () => {
            expect(isValidPassword('abc')).toBe(false);
        });

        it('accepts reasonable passwords', () => {
            expect(isValidPassword('SecurePass123!')).toBe(true);
        });
    });
});
