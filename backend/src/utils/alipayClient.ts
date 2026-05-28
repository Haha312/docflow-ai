/**
 * 共享的支付宝 SDK 初始化。
 *
 * 支持两种模式:
 *   - Key 模式: 提供 ALIPAY_APP_ID + ALIPAY_PRIVATE_KEY + ALIPAY_PUBLIC_KEY
 *   - Cert 模式: 提供 ALIPAY_APP_ID + ALIPAY_PRIVATE_KEY + Alipay/ 目录下的三张证书
 *     (alipayRootCert.crt + alipayCertPublicKey_RSA2.crt + appCertPublicKey_*.crt)
 *
 * 未配置时返回 null,调用方应该自行处理(返回 503)。
 */
import AlipaySdk from 'alipay-sdk';
import * as fs from 'fs';
import * as path from 'path';

export interface AlipayClientHandle {
    sdk: ReturnType<typeof newSdk>;
    appId: string;
}

function newSdk(config: Record<string, unknown>) {
    // alipay-sdk 在不同 module 版本下导出方式不同,做一次兼容
    let Ctor: unknown = AlipaySdk;
    if (typeof Ctor !== 'function') {
        const pkg = require('alipay-sdk');
        Ctor = pkg.default || pkg.AlipaySdk || pkg;
    }
    const C = Ctor as new (cfg: Record<string, unknown>) => unknown;
    return new C(config) as { exec: (method: string, params: Record<string, unknown>) => Promise<Record<string, unknown>>; checkNotifySign: (params: Record<string, unknown>) => boolean };
}

export function getAlipayClient(): AlipayClientHandle | null {
    const alipayAppId = process.env.ALIPAY_APP_ID;
    const alipayPrivateKey = process.env.ALIPAY_PRIVATE_KEY;
    const alipayPublicKey = process.env.ALIPAY_PUBLIC_KEY;

    if (!alipayPrivateKey) return null;

    const certDir = path.join(process.cwd(), 'Alipay');
    const alipayRootCertPath = path.join(certDir, 'alipayRootCert.crt');
    const alipayPublicCertPath = path.join(certDir, 'alipayCertPublicKey_RSA2.crt');
    const appCertFiles = fs.existsSync(certDir)
        ? fs.readdirSync(certDir).filter((f) => f.startsWith('appCertPublicKey_') && f.endsWith('.crt'))
        : [];
    const appCertPath = appCertFiles.length > 0 ? path.join(certDir, appCertFiles[0]) : null;

    const hasKeyMode = !!(alipayAppId && alipayPublicKey);
    const hasCertMode = !!(appCertPath && fs.existsSync(alipayRootCertPath) && fs.existsSync(alipayPublicCertPath));

    if (!hasKeyMode && !hasCertMode) return null;

    const sdkConfig: Record<string, unknown> = {
        privateKey: alipayPrivateKey,
        gateway: process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do',
        signType: 'RSA2',
    };

    let resolvedAppId = alipayAppId;
    if (hasCertMode && appCertPath) {
        resolvedAppId = alipayAppId || path.basename(appCertPath).split('_')[1].split('.')[0];
        sdkConfig.appId = resolvedAppId;
        sdkConfig.alipayRootCertPath = alipayRootCertPath;
        sdkConfig.alipayPublicCertPath = alipayPublicCertPath;
        sdkConfig.appCertPath = appCertPath;
    } else {
        sdkConfig.appId = alipayAppId;
        sdkConfig.alipayPublicKey = alipayPublicKey;
    }

    return {
        sdk: newSdk(sdkConfig),
        appId: resolvedAppId || '',
    };
}
