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
    tls: {
        rejectUnauthorized: false
    }
});

export const sendVerificationEmail = async (to: string, code: string): Promise<boolean> => {
    // If no real SMTP config, just log for dev
    if (!process.env.SMTP_HOST && !process.env.SMTP_USER) {
        console.log(`[MOCK EMAIL] To: ${to}, Code: ${code}`);
        return true;
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
