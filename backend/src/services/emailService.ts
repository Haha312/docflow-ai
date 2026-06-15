import nodemailer from 'nodemailer';

// Create Transporter
// For production, use environment variables for SMTP config
// For dev, we can use a mock or just log if no config present
const transporter = nodemailer.createTransport({
    // Generic SMTP fallback or use a specific service like 'gmail'
    host: process.env.SMTP_HOST || 'smtp.example.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER || 'user',
        pass: process.env.SMTP_PASS || 'pass',
    },
    // 不再关闭 TLS 证书校验(默认验证,防中间人)
});

const isSmtpConfigured = (): boolean => !!(process.env.SMTP_HOST || process.env.SMTP_USER);

/**
 * SMTP 未配置时的处理:dev 视为成功(不真发,也不打印敏感内容);
 * 生产记 error 并返回 false(邮件为选填通知,失败由调用方非阻断处理)。
 */
function smtpUnconfigured(label: string): boolean {
    if (process.env.NODE_ENV === 'production') {
        console.error(`[email] SMTP 未配置,${label} 邮件未发送`);
        return false;
    }
    console.log(`[email] (dev) SMTP 未配置,跳过 ${label} 邮件`);
    return true;
}

/**
 * 续费提醒邮件 (会员到期前 7/3/1 天发送)。复用同一个 transporter。
 */
export const sendRenewalReminder = async (
    to: string,
    daysLeft: number,
    planName: string,
    expiryDate: Date
): Promise<boolean> => {
    if (!isSmtpConfigured()) return smtpUnconfigured('renewal');

    const frontendUrl = (process.env.FRONTEND_URL || '').split(',')[0] || 'https://docuflow.ai';
    const upgradeUrl = `${frontendUrl}/?upgrade=1`;
    const expiryStr = expiryDate.toISOString().split('T')[0];

    try {
        const info = await transporter.sendMail({
            from: process.env.SMTP_FROM || '"DocFlow AI" <no-reply@docuflow.ai>',
            to,
            subject: `DocFlow AI - 您的 ${planName} 会员还有 ${daysLeft} 天到期`,
            text: `您的 ${planName} 会员将于 ${expiryStr} 到期 (剩余 ${daysLeft} 天)。立即续费以保持完整权益:${upgradeUrl}`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 560px; margin: 0 auto;">
                    <h2 style="color: #000;">DocFlow AI</h2>
                    <p>您好,</p>
                    <p>您的 <strong>${planName}</strong> 会员将于 <strong>${expiryStr}</strong> 到期(剩余 <strong style="color:#dc2626;">${daysLeft}</strong> 天)。</p>
                    <p>到期后账号将自动降级为免费版,文档生成次数将受限。立即续费,保持完整权益。</p>
                    <p style="margin: 30px 0;">
                        <a href="${upgradeUrl}" style="background:#4F46E5;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600;">立即续费</a>
                    </p>
                    <p style="font-size:12px;color:#888;">如已续费或暂不需要,请忽略此邮件。</p>
                </div>
            `,
        });
        console.log('Renewal reminder sent: %s', info.messageId);
        return true;
    } catch (error) {
        console.error('Error sending renewal reminder:', error);
        return false;
    }
};

/**
 * 支付成功确认邮件。在 webhook 把订单标记为 PAID 之后调用,失败不阻断主流程。
 */
export const sendPaymentSuccess = async (
    to: string,
    planName: string,
    amount: number,
    currency: string,
    endDate: Date
): Promise<boolean> => {
    if (!isSmtpConfigured()) return smtpUnconfigured('payment');

    const frontendUrl = (process.env.FRONTEND_URL || '').split(',')[0] || 'https://docuflow.ai';
    const endStr = endDate.toISOString().split('T')[0];
    const amountStr = `${currency.toUpperCase()} ${amount.toFixed(2)}`;

    try {
        const info = await transporter.sendMail({
            from: process.env.SMTP_FROM || '"DocFlow AI" <no-reply@docuflow.ai>',
            to,
            subject: `DocFlow AI - 您的 ${planName} 已激活`,
            text: `感谢您的购买!您的 ${planName} 会员已激活,金额 ${amountStr},有效期至 ${endStr}。访问:${frontendUrl}`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; color: #333; max-width: 560px; margin: 0 auto;">
                    <h2 style="color: #000;">DocFlow AI</h2>
                    <p>您好,</p>
                    <p>感谢您的购买!您的 <strong>${planName}</strong> 会员已激活。</p>
                    <table style="width:100%;margin:20px 0;border-collapse:collapse;">
                        <tr><td style="padding:8px 0;color:#666;">订阅方案</td><td style="padding:8px 0;text-align:right;"><strong>${planName}</strong></td></tr>
                        <tr><td style="padding:8px 0;color:#666;">金额</td><td style="padding:8px 0;text-align:right;"><strong>${amountStr}</strong></td></tr>
                        <tr><td style="padding:8px 0;color:#666;">有效期至</td><td style="padding:8px 0;text-align:right;"><strong>${endStr}</strong></td></tr>
                    </table>
                    <p style="margin: 30px 0;">
                        <a href="${frontendUrl}" style="background:#111;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;display:inline-block;font-weight:600;">开始使用</a>
                    </p>
                    <p style="font-size:12px;color:#888;">如需发票或对订单有疑问,请回复此邮件联系客服。</p>
                </div>
            `,
        });
        console.log('Payment success email sent: %s', info.messageId);
        return true;
    } catch (error) {
        console.error('Error sending payment success email:', error);
        return false;
    }
};

export const sendVerificationEmail = async (to: string, code: string): Promise<boolean> => {
    // If no real SMTP config, just log for dev
    if (!isSmtpConfigured()) {
        return smtpUnconfigured('verification');
    }

    try {
        const info = await transporter.sendMail({
            from: process.env.SMTP_FROM || '"DocFlow AI" <no-reply@docuflow.ai>',
            to,
            subject: 'DocFlow AI - 邮箱验证码',
            text: `您的验证码是: ${code}。有效期 10 分钟。`,
            html: `
                <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
                    <h2 style="color: #000;">DocFlow AI</h2>
                    <p>您好，</p>
                    <p>您正在注册或登录 DocFlow AI，您的验证码是：</p>
                    <h1 style="color: #4F46E5; letter-spacing: 5px;">${code}</h1>
                    <p>该验证码 10 分钟内有效。如果这不是您本人的操作，请忽略此邮件。</p>
                </div>
            `,
        });
        console.log('Message sent: %s', info.messageId);
        return true;
    } catch (error) {
        console.error('Error sending email:', error);
        return false;
    }
};
