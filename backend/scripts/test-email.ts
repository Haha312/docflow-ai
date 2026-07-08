
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

// Load env vars
dotenv.config();

console.log('Testing SMTP Configuration...');
console.log('Host:', process.env.SMTP_HOST);
console.log('Port:', process.env.SMTP_PORT);
console.log('Secure:', process.env.SMTP_SECURE);
console.log('User:', process.env.SMTP_USER);
console.log('From:', process.env.SMTP_FROM);

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
    // Debug options
    logger: true,
    debug: true,
    tls: {
        // do not fail on invalid certs
        rejectUnauthorized: false
    }
});

async function main() {
    try {
        console.log('Sending test email...');
        const info = await transporter.sendMail({
            from: process.env.SMTP_FROM,
            to: process.env.SMTP_USER, // Send to self
            subject: 'DocFlow SMTP Test',
            text: 'If you see this, SMTP is working!',
        });
        console.log('Message sent: %s', info.messageId);
        console.log('Preview URL: %s', nodemailer.getTestMessageUrl(info));
    } catch (error) {
        console.error('Error occurred:', error);
    }
}

main();
