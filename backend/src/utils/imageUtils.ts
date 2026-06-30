import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const execFileAsync = promisify(execFile);

export interface ImageMap {
    [placeholder: string]: string;
}

export const extractImagesAsPlaceholders = (html: string): { textOnly: string; imageMap: ImageMap } => {
    const imageMap: ImageMap = {};
    const imgRegex = /<img\s+[^>]*src=["'][^"']*["'][^>]*>/gi;
    let index = 0;

    const textOnly = html.replace(imgRegex, (match) => {
        const placeholder = `__IMG_${index}__`;
        imageMap[placeholder] = match;
        index++;
        return placeholder;
    });

    return { textOnly, imageMap };
};

export const restoreImages = (text: string, imageMap: ImageMap): string => {
    let result = text;
    for (const [placeholder, imgTag] of Object.entries(imageMap)) {
        result = result.split(placeholder).join(imgTag);
    }
    return result;
};

// ── 矢量图识别(按魔数,不信任 MIME —— 前端解析时会把未知格式默认标成 image/png)──
// EMF: 偏移 40 处有 " EMF" 签名;WMF: placeable(D7 CD C6 9A)或 standard(01 00 09 00)。
const detectVector = (buf: Buffer): 'emf' | 'wmf' | null => {
    if (buf.length >= 44 && buf[40] === 0x20 && buf[41] === 0x45 && buf[42] === 0x4D && buf[43] === 0x46) return 'emf';
    if (buf.length >= 4 && buf[0] === 0xD7 && buf[1] === 0xCD && buf[2] === 0xC6 && buf[3] === 0x9A) return 'wmf'; // placeable WMF
    // 标准(非 placeable)WMF:仅凭前 4 字节 01 00 09 00 太弱、易把任意二进制误判 → 追加校验 mtVersion(偏移4)=0x0100/0x0300。
    if (buf.length >= 6 && buf[0] === 0x01 && buf[1] === 0x00 && buf[2] === 0x09 && buf[3] === 0x00
        && buf[4] === 0x00 && (buf[5] === 0x01 || buf[5] === 0x03)) return 'wmf';
    return null;
};

/**
 * 把 imageMap 里的 EMF/WMF 矢量图(Visio/CAD 绘制)用 ImageMagick 转成 PNG。
 * 背景:EMF/WMF 浏览器无法渲染、docx 库的 ImageRun 也不支持 → 不转换则预览破图、导出也丢图。
 * 一处转换即同时修好「网页预览」与「导出 Word」(两者都用同一份还原后的全文)。
 * 需运行环境装有 ImageMagick(magick);缺失或单张失败时【优雅降级】:保留原图、不阻断生成,
 * 仅返回计数供上层提示。原地修改 imageMap。
 */
export const convertVectorImagesToPng = async (
    imageMap: ImageMap,
    opts?: { concurrency?: number; onProgress?: (done: number, total: number) => void },
): Promise<{ converted: number; failed: number; total: number }> => {
    // 1) 先筛出真正需要转换的矢量图(解码 + 魔数判定),栅格图(PNG/JPEG)直接跳过 —— 不进转换队列。
    const jobs: Array<{ key: string; imgTag: string; buf: Buffer; kind: 'emf' | 'wmf' }> = [];
    for (const [key, imgTag] of Object.entries(imageMap)) {
        const m = imgTag.match(/src="data:image\/[^;]+;base64,([^"]+)"/i);
        if (!m) continue;
        let buf: Buffer;
        try { buf = Buffer.from(m[1], 'base64'); } catch { continue; }
        const kind = detectVector(buf);
        if (!kind) continue;
        jobs.push({ key, imgTag, buf, kind });
    }
    const total = jobs.length;
    let converted = 0, failed = 0, done = 0, magickMissing = false;
    if (total === 0) return { converted, failed, total };

    // 2) 有界并发池(默认 3):限制同时运行的 ImageMagick 进程数,避免内存/CPU 尖峰;
    //    每张单独 25s 超时;缺 magick 后续直接判失败不再 spawn。onProgress 供上层发 SSE 心跳保活。
    let next = 0;
    const worker = async (): Promise<void> => {
        while (true) {
            const idx = next++;
            if (idx >= jobs.length) return;
            const job = jobs[idx];
            if (magickMissing) { failed++; done++; opts?.onProgress?.(done, total); continue; }
            const stamp = `${Date.now()}_${Math.random().toString(36).slice(2)}_${idx}`;
            const tmpIn = join(tmpdir(), `docflow_${stamp}.${job.kind}`);
            const tmpOut = join(tmpdir(), `docflow_${stamp}.png`);
            try {
                await writeFile(tmpIn, job.buf);
                await execFileAsync('magick', [tmpIn, tmpOut], { timeout: 25000 });
                const png = await readFile(tmpOut);
                imageMap[job.key] = job.imgTag.replace(/src="data:image\/[^;]+;base64,[^"]+"/i, `src="data:image/png;base64,${png.toString('base64')}"`);
                converted++;
            } catch (e: any) {
                failed++;
                if (e?.code === 'ENOENT') {
                    magickMissing = true;
                    console.warn('[VECTOR_IMG] 未找到 ImageMagick(magick) —— EMF/WMF 矢量图无法转换,将无法在预览/导出中显示');
                } else {
                    console.warn(`[VECTOR_IMG] 转换 ${job.key} 失败: ${e?.message}`);
                }
            } finally {
                unlink(tmpIn).catch(() => {});
                unlink(tmpOut).catch(() => {});
                done++;
                opts?.onProgress?.(done, total);
            }
        }
    };
    const pool = Math.max(1, Math.min(opts?.concurrency ?? 3, jobs.length));
    await Promise.all(Array.from({ length: pool }, () => worker()));
    return { converted, failed, total };
};
