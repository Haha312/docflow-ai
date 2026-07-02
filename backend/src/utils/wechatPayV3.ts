import crypto from 'crypto';
import * as fs from 'fs';
import { fetch as undiciFetch } from 'undici';

export interface WechatV3Config {
    appId: string;
    mchId: string;
    certSerial: string;
    apiV3Key: string;
    privateKeyPath: string;
    publicKeyPath?: string;
    publicKeyId?: string;
}

export interface WechatV3Readiness {
    ok: boolean;
    missingEnv: string[];
    missingFiles: string[];
    invalid: string[];
}

const env = (...names: string[]): string | undefined => {
    for (const name of names) {
        const value = process.env[name];
        if (value) return value;
    }
    return undefined;
};

export function getWechatV3Config(): WechatV3Config | null {
    const appId = env('WXPAY_APPID', 'WECHAT_APP_ID');
    const mchId = env('WXPAY_MCHID', 'WECHAT_MCH_ID');
    const certSerial = env('WXPAY_CERT_SERIAL', 'WECHAT_CERT_SERIAL');
    const apiV3Key = env('WXPAY_APIV3_KEY', 'WECHAT_APIV3_KEY');
    const privateKeyPath = env('WXPAY_PRIVATE_KEY_PATH', 'WECHAT_PRIVATE_KEY_PATH');
    if (!appId || !mchId || !certSerial || !apiV3Key || !privateKeyPath) return null;
    return {
        appId,
        mchId,
        certSerial,
        apiV3Key,
        privateKeyPath,
        publicKeyPath: env('WXPAY_PUBLIC_KEY_PATH', 'WECHAT_PUBLIC_KEY_PATH'),
        publicKeyId: env('WXPAY_PUBLIC_KEY_ID', 'WECHAT_PUBLIC_KEY_ID'),
    };
}

export const isWechatV3Configured = (): boolean => !!getWechatV3Config();

export function checkWechatV3Readiness(): WechatV3Readiness {
    const requiredEnv: Record<string, string | undefined> = {
        WXPAY_APPID: env('WXPAY_APPID', 'WECHAT_APP_ID'),
        WXPAY_MCHID: env('WXPAY_MCHID', 'WECHAT_MCH_ID'),
        WXPAY_CERT_SERIAL: env('WXPAY_CERT_SERIAL', 'WECHAT_CERT_SERIAL'),
        WXPAY_APIV3_KEY: env('WXPAY_APIV3_KEY', 'WECHAT_APIV3_KEY'),
        WXPAY_PRIVATE_KEY_PATH: env('WXPAY_PRIVATE_KEY_PATH', 'WECHAT_PRIVATE_KEY_PATH'),
        WXPAY_PUBLIC_KEY_PATH: env('WXPAY_PUBLIC_KEY_PATH', 'WECHAT_PUBLIC_KEY_PATH'),
        WXPAY_PUBLIC_KEY_ID: env('WXPAY_PUBLIC_KEY_ID', 'WECHAT_PUBLIC_KEY_ID'),
    };

    const missingEnv = Object.entries(requiredEnv)
        .filter(([, value]) => !value)
        .map(([name]) => name);

    const invalid: string[] = [];
    const apiV3Key = requiredEnv.WXPAY_APIV3_KEY;
    if (apiV3Key && Buffer.byteLength(apiV3Key, 'utf8') !== 32) {
        invalid.push('WXPAY_APIV3_KEY must be 32 bytes');
    }

    const missingFiles: string[] = [];
    const privateKeyPath = requiredEnv.WXPAY_PRIVATE_KEY_PATH;
    if (privateKeyPath && !fs.existsSync(privateKeyPath)) {
        missingFiles.push('WXPAY_PRIVATE_KEY_PATH');
    }

    const publicKeyPath = requiredEnv.WXPAY_PUBLIC_KEY_PATH;
    if (publicKeyPath && !fs.existsSync(publicKeyPath)) {
        missingFiles.push('WXPAY_PUBLIC_KEY_PATH');
    }

    return {
        ok: missingEnv.length === 0 && missingFiles.length === 0 && invalid.length === 0,
        missingEnv,
        missingFiles,
        invalid,
    };
}

const randomNonceStr = (): string => crypto.randomBytes(16).toString('hex');

const getPrivateKey = (cfg: WechatV3Config): string => fs.readFileSync(cfg.privateKeyPath, 'utf8');

const sign = (message: string, privateKey: string): string =>
    crypto.createSign('RSA-SHA256').update(message).end().sign(privateKey, 'base64');

const buildAuthorization = (
    cfg: WechatV3Config,
    method: string,
    urlPathWithQuery: string,
    body: string
): string => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = randomNonceStr();
    const signature = sign(`${method}\n${urlPathWithQuery}\n${timestamp}\n${nonce}\n${body}\n`, getPrivateKey(cfg));
    const authParams = [
        `mchid="${cfg.mchId}"`,
        `nonce_str="${nonce}"`,
        `signature="${signature}"`,
        `timestamp="${timestamp}"`,
        `serial_no="${cfg.certSerial}"`,
    ].join(',');
    return `WECHATPAY2-SHA256-RSA2048 ${authParams}`;
};

export async function createWechatV3NativeOrder(opts: {
    description: string;
    outTradeNo: string;
    amountFen: number;
    notifyUrl: string;
    attach: string;
}): Promise<string> {
    const cfg = getWechatV3Config();
    if (!cfg) throw new Error('WeChat Pay V3 is not configured');

    if (!fs.existsSync(cfg.privateKeyPath)) {
        throw new Error(`WeChat private key not found at ${cfg.privateKeyPath}`);
    }

    const path = '/v3/pay/transactions/native';
    const body = JSON.stringify({
        appid: cfg.appId,
        mchid: cfg.mchId,
        description: opts.description,
        out_trade_no: opts.outTradeNo,
        notify_url: opts.notifyUrl,
        amount: { total: opts.amountFen, currency: 'CNY' },
        attach: opts.attach,
    });

    const resp = await undiciFetch(`https://api.mch.weixin.qq.com${path}`, {
        method: 'POST',
        headers: {
            Authorization: buildAuthorization(cfg, 'POST', path, body),
            Accept: 'application/json',
            'Content-Type': 'application/json',
        },
        body,
    });
    const text = await resp.text();
    let data: { code_url?: string; message?: string; code?: string } = {};
    try {
        data = JSON.parse(text) as typeof data;
    } catch {
        data = { message: text };
    }
    if (!resp.ok || !data.code_url) {
        throw new Error(data.message || data.code || `WeChat Pay V3 order failed (${resp.status})`);
    }
    return data.code_url;
}

export async function queryWechatV3Order(outTradeNo: string): Promise<string | null> {
    const cfg = getWechatV3Config();
    if (!cfg) return null;
    const encoded = encodeURIComponent(outTradeNo);
    const path = `/v3/pay/transactions/out-trade-no/${encoded}`;
    const query = `mchid=${encodeURIComponent(cfg.mchId)}`;
    const pathWithQuery = `${path}?${query}`;
    const resp = await undiciFetch(`https://api.mch.weixin.qq.com${pathWithQuery}`, {
        method: 'GET',
        headers: {
            Authorization: buildAuthorization(cfg, 'GET', pathWithQuery, ''),
            Accept: 'application/json',
        },
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { trade_state?: string };
    return data.trade_state || null;
}

export async function refundWechatV3Order(opts: {
    outTradeNo: string;
    outRefundNo: string;
    totalFeeFen: number;
    refundFeeFen: number;
    reason?: string;
}): Promise<{ success: boolean; refundId?: string; errCode?: string; errMsg?: string }> {
    const cfg = getWechatV3Config();
    if (!cfg) return { success: false, errMsg: 'WeChat Pay V3 is not configured' };
    if (!fs.existsSync(cfg.privateKeyPath)) {
        return { success: false, errMsg: `WeChat private key not found at ${cfg.privateKeyPath}` };
    }

    const path = '/v3/refund/domestic/refunds';
    const body = JSON.stringify({
        out_trade_no: opts.outTradeNo,
        out_refund_no: opts.outRefundNo,
        reason: opts.reason || 'User initiated refund',
        amount: {
            refund: opts.refundFeeFen,
            total: opts.totalFeeFen,
            currency: 'CNY',
        },
    });

    const resp = await undiciFetch(`https://api.mch.weixin.qq.com${path}`, {
        method: 'POST',
        headers: {
            Authorization: buildAuthorization(cfg, 'POST', path, body),
            Accept: 'application/json',
            'Content-Type': 'application/json',
        },
        body,
    });
    const text = await resp.text();
    let data: { refund_id?: string; status?: string; code?: string; message?: string } = {};
    try {
        data = JSON.parse(text) as typeof data;
    } catch {
        data = { message: text };
    }

    if (!resp.ok || !data.refund_id) {
        return {
            success: false,
            errCode: data.code || String(resp.status),
            errMsg: data.message || 'WeChat Pay V3 refund failed',
        };
    }

    return { success: true, refundId: data.refund_id };
}

export function verifyWechatV3Webhook(headers: Record<string, string | string[] | undefined>, rawBody: string): boolean {
    const cfg = getWechatV3Config();
    if (!cfg?.publicKeyPath || !fs.existsSync(cfg.publicKeyPath)) return false;

    const timestamp = String(headers['wechatpay-timestamp'] || '');
    const nonce = String(headers['wechatpay-nonce'] || '');
    const signature = String(headers['wechatpay-signature'] || '');
    const serial = String(headers['wechatpay-serial'] || '');
    if (!timestamp || !nonce || !signature || !serial) return false;
    if (cfg.publicKeyId && serial !== cfg.publicKeyId) return false;

    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(`${timestamp}\n${nonce}\n${rawBody}\n`);
    verifier.end();
    return verifier.verify(fs.readFileSync(cfg.publicKeyPath, 'utf8'), signature, 'base64');
}

export function decryptWechatV3Resource(resource: {
    ciphertext: string;
    nonce: string;
    associated_data?: string;
}): Record<string, unknown> {
    const cfg = getWechatV3Config();
    if (!cfg) throw new Error('WeChat Pay V3 is not configured');
    const encrypted = Buffer.from(resource.ciphertext, 'base64');
    const authTag = encrypted.subarray(encrypted.length - 16);
    const data = encrypted.subarray(0, encrypted.length - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(cfg.apiV3Key, 'utf8'), Buffer.from(resource.nonce, 'utf8'));
    decipher.setAuthTag(authTag);
    if (resource.associated_data) {
        decipher.setAAD(Buffer.from(resource.associated_data, 'utf8'));
    }
    const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
    return JSON.parse(plain) as Record<string, unknown>;
}
