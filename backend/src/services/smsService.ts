/**
 * 短信验证码发送服务(腾讯云短信)。
 *
 * 生产需配置:TENCENTCLOUD_SECRET_ID / TENCENTCLOUD_SECRET_KEY / TENCENT_SMS_SDK_APP_ID /
 *            TENCENT_SMS_SIGN_NAME / TENCENT_SMS_TEMPLATE_ID(可选 TENCENT_SMS_REGION,默认 ap-guangzhou)。
 * 未配置时:开发环境走 mock(把验证码打到日志,便于本地联调);生产环境由 server.ts 启动校验拦下(fail-fast),
 *          不会落到这里发出"假成功"。
 */

// 腾讯云 SMS SDK(子包)。延迟 require 避免未装包时影响其它模块。
let smsClient: any = null;

const env = (...names: string[]): string | undefined => {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return undefined;
};

const smsConfig = () => ({
  secretId: env('TENCENTCLOUD_SECRET_ID', 'TENCENT_SMS_SECRET_ID'),
  secretKey: env('TENCENTCLOUD_SECRET_KEY', 'TENCENT_SMS_SECRET_KEY'),
  sdkAppId: env('TENCENT_SMS_SDK_APP_ID', 'SMS_SDK_APP_ID'),
  signName: env('TENCENT_SMS_SIGN_NAME', 'SMS_SIGN_NAME'),
  templateId: env('TENCENT_SMS_TEMPLATE_ID', 'SMS_TEMPLATE_ID'),
  region: env('TENCENT_SMS_REGION') || 'ap-guangzhou',
});

function isSmsConfigured(): boolean {
  const cfg = smsConfig();
  return !!(cfg.secretId && cfg.secretKey && cfg.sdkAppId && cfg.signName && cfg.templateId);
}

function getClient(): any {
  if (smsClient) return smsClient;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const tencentcloud = require('tencentcloud-sdk-nodejs-sms');
  const SmsClient = tencentcloud.sms.v20210111.Client;
  const cfg = smsConfig();
  smsClient = new SmsClient({
    credential: {
      secretId: cfg.secretId,
      secretKey: cfg.secretKey,
    },
    region: cfg.region,
    profile: { httpProfile: { endpoint: 'sms.tencentcloudapi.com' } },
  });
  return smsClient;
}

/**
 * 发送 6 位验证码短信到指定手机号(中国大陆,+86)。
 * 返回 true 表示已发出(或 mock 成功),false 表示发送失败。
 */
export async function sendSmsCode(phone: string, code: string): Promise<boolean> {
  if (!isSmsConfigured()) {
    // 仅开发环境 mock;生产缺配置会在启动时被拦截,不会走到这里。
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[MOCK SMS] -> ${phone} code=${code}`);
      return true;
    }
    console.error('[SMS] 腾讯云短信未配置,无法发送验证码');
    return false;
  }

  try {
    const client = getClient();
    const cfg = smsConfig();
    const res = await client.SendSms({
      PhoneNumberSet: [`+86${phone}`],
      SmsSdkAppId: cfg.sdkAppId,
      SignName: cfg.signName,
      TemplateId: cfg.templateId,
      TemplateParamSet: [code],
    });
    const status = res?.SendStatusSet?.[0];
    if (status && status.Code === 'Ok') return true;
    console.error('[SMS] 发送失败:', status?.Code, status?.Message);
    return false;
  } catch (err) {
    console.error('[SMS] 发送异常:', (err as Error).message);
    return false;
  }
}

export { isSmsConfigured };
