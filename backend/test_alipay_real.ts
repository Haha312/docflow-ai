
import * as path from 'path';
import * as fs from 'fs';
import AlipaySdk from 'alipay-sdk';
import dotenv from 'dotenv';

dotenv.config();

// Mock User and Plan for simulation
const user = { id: 'TEST_USER_001' };
const plan = { title: 'Pro Plan', amountCNY: 0.01 };
const planType = 'monthly';

async function testAlipayReal() {
    console.log('--- Starting Real Alipay Connection Test ---');

    let alipaySdk: any;
    let AlipaySdkConstructor: any = AlipaySdk;
    let pkg: any = AlipaySdk;

    try {
        // --- 1. Import Logic (Same as payment.ts) ---
        if ((AlipaySdk as any)?.default) {
            pkg = (AlipaySdk as any).default;
            AlipaySdkConstructor = pkg;
        }
        if ((AlipaySdk as any)?.AlipaySdk) {
            AlipaySdkConstructor = (AlipaySdk as any).AlipaySdk;
        } else if (pkg?.AlipaySdk) {
            AlipaySdkConstructor = pkg.AlipaySdk;
        }

        if (typeof AlipaySdkConstructor !== 'function') {
            pkg = require('alipay-sdk');
            AlipaySdkConstructor = pkg.default || pkg.AlipaySdk || pkg;
        }

        console.log('✅ SDK Constructor Resolved');

        // --- 2. Configuration Logic (Cert Mode) ---
        const certDir = path.join(process.cwd(), 'Alipay');
        const alipayRootCertPath = path.join(certDir, 'alipayRootCert.crt');
        const alipayPublicCertPath = path.join(certDir, 'alipayCertPublicKey_RSA2.crt');

        // Find app cert
        const files = fs.readdirSync(certDir);
        const appCertFile = files.find(f => f.startsWith('appCertPublicKey_') && f.endsWith('.crt'));
        const appCertPath = appCertFile ? path.join(certDir, appCertFile) : undefined;
        const certAppId = appCertFile ? appCertFile.split('_')[1].split('.')[0] : undefined;

        console.log(`Config: AppID=${certAppId}, CertDir=${certDir}`);

        if (!appCertPath) throw new Error('App Cert not found');

        // Initialize
        alipaySdk = new AlipaySdkConstructor({
            appId: certAppId,
            privateKey: process.env.ALIPAY_PRIVATE_KEY,
            alipayRootCertPath: alipayRootCertPath,
            alipayPublicCertPath: alipayPublicCertPath,
            appCertPath: appCertPath,
            gateway: process.env.ALIPAY_GATEWAY || 'https://openapi.alipay.com/gateway.do',
            signType: 'RSA2'
        });

        console.log('✅ SDK Initialized');

        // --- 3. API Call Logic (Plain Object) ---
        const outTradeNo = `TEST_${Date.now()}`;
        const bizContent = {
            outTradeNo: outTradeNo,
            totalAmount: '0.01',
            subject: 'Test Payment',
            body: 'Test Body'
        };

        const params = {
            bizContent: bizContent,
            notifyUrl: 'http://localhost:3001/api/webhook/alipay'
        };

        console.log('Sending request to Alipay...');
        const result = await alipaySdk.exec('alipay.trade.precreate', params);

        fs.writeFileSync('alipay_result.json', JSON.stringify(result, null, 2));

        if (result.code === '10000') {
            console.log('✅ SUCCESS! QR Code generated.');
        } else {
            console.error(`❌ FAILED: ${result.code} - ${result.subMsg || result.msg}`);
        }

    } catch (e: any) {
        console.error('❌ EXCEPTION:', e.message);
        console.error(e);
    }
}

testAlipayReal();
