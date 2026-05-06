/**
 * Smoke test for DeepSeek API connectivity.
 *
 * Usage:
 *   cd backend
 *   node test_deepseek_connection.js
 *
 * Requires .env to contain DEEPSEEK_API_KEY.
 * Optional: DEEPSEEK_MODEL (defaults to deepseek-v4-pro).
 */
require('dotenv').config();
const OpenAI = require('openai');

async function testDeepseek() {
    console.log('Testing DeepSeek API connectivity...');

    const apiKey = (process.env.DEEPSEEK_API_KEY || '').trim();
    const model = (process.env.DEEPSEEK_MODEL || 'deepseek-v4-pro').trim();

    if (!apiKey) {
        console.error('FAIL: DEEPSEEK_API_KEY is not set in .env');
        process.exit(1);
    }

    console.log('Model:', model);
    console.log('Key:  ', apiKey.substring(0, 8) + '...');

    const client = new OpenAI({
        apiKey,
        baseURL: 'https://api.deepseek.com/v1',
    });

    try {
        const t0 = Date.now();
        const response = await client.chat.completions.create({
            model,
            messages: [
                { role: 'system', content: 'You are a concise assistant.' },
                { role: 'user', content: 'Reply with the single word: PONG' },
            ],
            stream: false,
            max_tokens: 16,
        });
        const dt = Date.now() - t0;
        const reply = response.choices?.[0]?.message?.content?.trim();
        console.log(`OK in ${dt}ms — model returned: ${JSON.stringify(reply)}`);
        console.log('Usage:', response.usage);
    } catch (err) {
        console.error('FAIL:', err?.status || '', err?.message || err);
        if (err?.error) console.error('Detail:', err.error);
        process.exit(1);
    }
}

testDeepseek();
