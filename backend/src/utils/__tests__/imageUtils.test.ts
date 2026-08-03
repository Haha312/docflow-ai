import { describe, it, expect, vi, beforeEach } from 'vitest';

// 用假的 child_process.execFile 拦截外部命令,验证转换链的回退顺序与降级行为。
// 真实转换依赖运行环境装了什么(线上实测:Ubuntu 的 ImageMagick 无 EMF 解码器),
// 这里锁的是「谁先谁后、失败了怎么办」这套逻辑本身。
const calls: string[] = [];
let behavior: Record<string, 'ok' | 'enoent' | 'fail'> = {};

vi.mock('node:child_process', () => ({
    execFile: (cmd: string, _args: unknown, _opts: unknown, cb: (e: Error | null, r?: unknown) => void) => {
        calls.push(cmd);
        const mode = behavior[cmd] ?? 'enoent';
        if (mode === 'ok') return cb(null, { stdout: '', stderr: '' });
        const err: NodeJS.ErrnoException = new Error(mode === 'enoent' ? 'not found' : 'no decode delegate for EMF');
        if (mode === 'enoent') err.code = 'ENOENT';
        cb(err);
    },
}));

// 产物读写也拦掉:转换命令是假的,不会真的生成文件
vi.mock('node:fs/promises', () => ({
    writeFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => Buffer.from('fake-png-bytes')),
    unlink: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    rm: vi.fn(async () => undefined),
}));

// 注:vi.mock 会被提升到导入之前执行,故此处用普通 import 即可拿到被 mock 的依赖
import { convertVectorImagesToPng } from '../imageUtils';

/** 构造一张 EMF:偏移 40 处的 " EMF" 签名是 detectVector 的识别依据 */
const emfDataUrl = (): string => {
    const buf = Buffer.alloc(64);
    buf.write(' EMF', 40, 'ascii');
    return `<img src="data:image/x-emf;base64,${buf.toString('base64')}" />`;
};

describe('convertVectorImagesToPng — 转换链回退', () => {
    beforeEach(() => { calls.length = 0; behavior = {}; });

    it('magick 可用 → 只调 magick,不再往下回退', async () => {
        behavior = { magick: 'ok' };
        const map = { __IMG_0__: emfDataUrl() };
        const r = await convertVectorImagesToPng(map);
        expect(r).toMatchObject({ converted: 1, failed: 0, total: 1 });
        expect(calls).toEqual(['magick']);
        expect(map.__IMG_0__).toContain('data:image/png;base64,');
    });

    it('无 magick(IM7)→ 回退 convert(IM6,Ubuntu 常见)', async () => {
        behavior = { magick: 'enoent', convert: 'ok' };
        const r = await convertVectorImagesToPng({ __IMG_0__: emfDataUrl() });
        expect(r.converted).toBe(1);
        expect(calls).toEqual(['magick', 'convert']);
    });

    it('ImageMagick 装了但没有 EMF 解码器(报错而非 ENOENT)→ 回退 soffice', async () => {
        behavior = { magick: 'fail', convert: 'ok', soffice: 'ok' };
        const r = await convertVectorImagesToPng({ __IMG_0__: emfDataUrl() });
        expect(r.converted).toBe(1);
        expect(calls).toEqual(['magick', 'soffice']); // magick 非 ENOENT 失败 → 直接交给 soffice
    });

    it('三者都不可用 → 优雅降级:计入 failed,保留原图不阻断生成', async () => {
        behavior = {};
        const map = { __IMG_0__: emfDataUrl() };
        const before = map.__IMG_0__;
        const r = await convertVectorImagesToPng(map);
        expect(r).toMatchObject({ converted: 0, failed: 1, total: 1 });
        expect(map.__IMG_0__).toBe(before); // 原图保留(Word 导出仍可正常显示)
    });

    it('栅格图(PNG/JPEG)不进转换队列', async () => {
        behavior = { magick: 'ok' };
        const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const r = await convertVectorImagesToPng({ __IMG_0__: `<img src="data:image/png;base64,${png.toString('base64')}" />` });
        expect(r).toMatchObject({ converted: 0, failed: 0, total: 0 });
        expect(calls).toEqual([]);
    });
});
