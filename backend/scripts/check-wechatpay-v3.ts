import dotenv from 'dotenv';
import { checkWechatV3Readiness, getWechatV3Config } from '../src/utils/wechatPayV3';

dotenv.config();

const readiness = checkWechatV3Readiness();
const cfg = getWechatV3Config();

console.log('WeChat Pay V3 config check');
console.log('===========================');
console.log(`Configured: ${readiness.ok ? 'yes' : 'no'}`);
console.log(`App ID: ${cfg?.appId ? 'present' : 'missing'}`);
console.log(`Mch ID: ${cfg?.mchId ? 'present' : 'missing'}`);
console.log(`Merchant cert serial: ${cfg?.certSerial ? 'present' : 'missing'}`);
console.log(`Private key path: ${cfg?.privateKeyPath ? 'present' : 'missing'}`);
console.log(`Platform public key path: ${cfg?.publicKeyPath ? 'present' : 'not set'}`);
console.log(`Platform public key id: ${cfg?.publicKeyId ? 'present' : 'not set'}`);

if (readiness.missingEnv.length) {
    console.log(`Missing env: ${readiness.missingEnv.join(', ')}`);
}
if (readiness.missingFiles.length) {
    console.log(`Missing files: ${readiness.missingFiles.join(', ')}`);
}
if (readiness.invalid.length) {
    console.log(`Invalid values: ${readiness.invalid.join(', ')}`);
}

process.exit(readiness.ok ? 0 : 1);
