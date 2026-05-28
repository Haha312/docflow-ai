/**
 * 微信支付 v2 共享 helpers (XML + MD5)。
 *
 * 注意: 这里实现的是 v2 API,微信 2024 年以后推荐 v3 (HMAC-SHA256 + 证书)。
 * v2 仍然能用,但建议长期迁移到 v3。退款接口需要双向 SSL 证书
 * (apiclient_cert.p12),路径通过 WECHAT_CERT_PATH 环境变量配置。
 */
import crypto from 'crypto';
import * as fs from 'fs';
import { Response } from 'express';
import { fetch as undiciFetch, Agent } from 'undici';

export interface WechatConfig {
    appId: string;
    mchId: string;
    apiKey: string;
}

export function getWechatConfig(): WechatConfig | null {
    const appId = process.env.WECHAT_APP_ID;
    const mchId = process.env.WECHAT_MCH_ID;
    const apiKey = process.env.WECHAT_API_KEY;
    if (!appId || !mchId || !apiKey) return null;
    return { appId, mchId, apiKey };
}

export const randomNonceStr = (): string => crypto.randomBytes(16).toString('hex');

/**
 * 解析微信支付返回的简单 XML (一层结构,支持 CDATA)。
 */
export const parseSimpleXml = (xml: string): Record<string, string> => {
    const result: Record<string, string> = {};
    const regex = /<([^/>]+)><!\[CDATA\[(.*?)\]\]><\/\1>|<([^/>]+)>([^<]*)<\/\3>/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(xml)) !== null) {
        const key = match[1] || match[3];
        const value = (match[2] ?? match[4] ?? '').trim();
        result[key] = value;
    }
    return result;
};

export const toXml = (params: Record<string, string | number>): string => {
    const body = Object.entries(params)
        .map(([k, v]) => `<${k}><![CDATA[${String(v)}]]></${k}>`)
        .join('');
    return `<xml>${body}</xml>`;
};

/**
 * 微信 v2 MD5 签名。
 */
export const signWechat = (params: Record<string, string | number>, apiKey: string): string => {
    const qs = Object.keys(params)
        .filter((k) => k !== 'sign' && params[k] !== undefined && params[k] !== '')
        .sort()
        .map((k) => `${k}=${params[k]}`)
        .join('&');
    return crypto.createHash('md5').update(`${qs}&key=${apiKey}`, 'utf8').digest('hex').toUpperCase();
};

/**
 * 对比签名时使用常量时间比较,防止时序攻击。
 */
export const verifyWechatSign = (params: Record<string, string>, apiKey: string): boolean => {
    const received = params.sign || '';
    const expected = signWechat(params, apiKey);
    if (received.length !== expected.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(received), Buffer.from(expected));
    } catch {
        return false;
    }
};

export const respondWechatXml = (res: Response, ok: boolean, msg = 'OK'): void => {
    const xml = toXml({ return_code: ok ? 'SUCCESS' : 'FAIL', return_msg: msg });
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    res.send(xml);
};

/**
 * 申请微信退款 (secapi/pay/refund),需要双向 SSL 证书 apiclient_cert.p12。
 *
 * 环境变量:
 *   WECHAT_CERT_PATH      - p12 证书文件路径 (默认 process.cwd()/Wechat/apiclient_cert.p12)
 *   WECHAT_CERT_PASSWORD  - p12 证书密码 (一般是 mch_id)
 *   WECHAT_REFUND_URL     - 退款接口 URL (默认 https://api.mch.weixin.qq.com/secapi/pay/refund)
 */
export async function wechatRefund(opts: {
    outTradeNo: string;
    outRefundNo: string;
    totalFeeFen: number;
    refundFeeFen: number;
    reason?: string;
}): Promise<{ success: boolean; refundId?: string; errCode?: string; errMsg?: string }> {
    const cfg = getWechatConfig();
    if (!cfg) return { success: false, errMsg: 'WeChat Pay not configured' };

    const certPath = process.env.WECHAT_CERT_PATH || `${process.cwd()}/Wechat/apiclient_cert.p12`;
    const certPassword = process.env.WECHAT_CERT_PASSWORD || cfg.mchId;
    if (!fs.existsSync(certPath)) {
        return { success: false, errMsg: `WeChat cert not found at ${certPath}` };
    }

    const params: Record<string, string | number> = {
        appid: cfg.appId,
        mch_id: cfg.mchId,
        nonce_str: randomNonceStr(),
        out_trade_no: opts.outTradeNo,
        out_refund_no: opts.outRefundNo,
        total_fee: opts.totalFeeFen,
        refund_fee: opts.refundFeeFen,
        refund_desc: opts.reason || 'User initiated refund',
    };
    params.sign = signWechat(params, cfg.apiKey);

    const url = process.env.WECHAT_REFUND_URL || 'https://api.mch.weixin.qq.com/secapi/pay/refund';

    // 双向 TLS: undici Agent + pfx
    const pfxBuf = fs.readFileSync(certPath);
    const agent = new Agent({
        connect: {
            pfx: [{ buf: pfxBuf, passphrase: certPassword }],
        },
    });

    const resp = await undiciFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8' },
        body: toXml(params),
        dispatcher: agent,
    });
    const xml = await resp.text();
    const data = parseSimpleXml(xml);

    if (data.return_code !== 'SUCCESS' || data.result_code !== 'SUCCESS') {
        return {
            success: false,
            errCode: data.err_code || data.return_code,
            errMsg: data.err_code_des || data.return_msg || 'WeChat refund failed',
        };
    }

    return {
        success: true,
        refundId: data.refund_id,
    };
}
