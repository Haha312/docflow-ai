import { describe, it, expect } from 'vitest';
import { applyQuotaDelta } from '../admin';

// 管理员手动加/减次数。规则很小,但错一处就是真金白银:
// 负数把 bonusQuota 扣穿会倒扣档位额度;不设上限会有手滑多敲零的事故。
describe('applyQuotaDelta', () => {
    it('正数累加', () => {
        expect(applyQuotaDelta(5, 10)).toEqual({ ok: true, value: 15 });
        expect(applyQuotaDelta(0, 1)).toEqual({ ok: true, value: 1 });
    });

    it('负数纠错,减到 0 为止,绝不为负', () => {
        expect(applyQuotaDelta(5, -3)).toEqual({ ok: true, value: 2 });
        expect(applyQuotaDelta(5, -100)).toEqual({ ok: true, value: 0 });
    });

    it('零、非整数、超限、非数字都拒绝', () => {
        for (const bad of [0, 1.5, 10001, -10001, 'abc', null, NaN, Infinity]) {
            const r = applyQuotaDelta(5, bad);
            expect(r.ok, `应拒绝 ${String(bad)}`).toBe(false);
        }
    });

    it('字符串形态的整数照收(表单来的就是字符串)', () => {
        expect(applyQuotaDelta(0, '20')).toEqual({ ok: true, value: 20 });
    });
});
