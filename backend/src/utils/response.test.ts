import { describe, it, expect } from 'vitest';
import { successResponse, errorResponse, isValidEmail, isValidPassword } from './response';

describe('successResponse / errorResponse', () => {
    it('successResponse wraps data with code 200 and default message', () => {
        const r = successResponse({ id: 1 });
        expect(r).toEqual({ code: 200, data: { id: 1 }, message: 'Success' });
    });

    it('errorResponse defaults to code 500 and omits data', () => {
        const r = errorResponse('boom');
        expect(r.code).toBe(500);
        expect(r.message).toBe('boom');
        expect((r as any).data).toBeUndefined();
    });

    it('errorResponse honours custom code', () => {
        expect(errorResponse('nope', 404).code).toBe(404);
    });
});

describe('isValidEmail', () => {
    it.each([
        'user@example.com',
        'a.b+tag@sub.domain.io',
        'x@y.z',
    ])('accepts %s', (email) => {
        expect(isValidEmail(email)).toBe(true);
    });

    it.each([
        '',
        'plainstring',
        'no-at-sign.com',
        'spaces in@email.com',
        '@no-local.com',
        'no-domain@',
        'no-tld@host',
    ])('rejects %s', (email) => {
        expect(isValidEmail(email)).toBe(false);
    });
});

describe('isValidPassword', () => {
    it('accepts a password with letters and digits and length >= 8', () => {
        expect(isValidPassword('abc12345')).toBe(true);
        expect(isValidPassword('LongPassword1')).toBe(true);
    });

    it('rejects passwords shorter than 8 chars', () => {
        expect(isValidPassword('abc1')).toBe(false);
        expect(isValidPassword('a1b2c3d')).toBe(false);
    });

    it('rejects passwords longer than 128 chars', () => {
        expect(isValidPassword('a1'.repeat(70))).toBe(false);
    });

    it('rejects letters-only or digits-only passwords', () => {
        expect(isValidPassword('onlyletters')).toBe(false);
        expect(isValidPassword('12345678')).toBe(false);
    });

    it('rejects non-string inputs', () => {
        expect(isValidPassword(undefined as unknown as string)).toBe(false);
        expect(isValidPassword(null as unknown as string)).toBe(false);
        expect(isValidPassword(12345678 as unknown as string)).toBe(false);
    });
});
