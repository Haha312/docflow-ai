require('dotenv').config();
const OpenAI = require('openai');

async function testGemini() {
    console.log('🚀 Testing Gemini via OpenAI Compatible Endpoint (NON-STREAM)...');

    // Explicitly trim key
    const apiKey = process.env.GOOGLE_API_KEY ? process.env.GOOGLE_API_KEY.trim() : '';
    console.log('Key:', apiKey.substring(0, 10) + '...');

    const client = new OpenAI({
        apiKey: apiKey,
        baseURL: process.env.GEMINI_OPENAI_BASE_URL
    });

    try {
        const response = await client.chat.completions.create({
            model: "gemini-3-pro-preview",
            messages: [
                { "role": "user", "content": "Hello" }
            ],
            stream: false
        });

        console.log('✅ Response:', response.choices[0].message.content);
    } catch (error) {
        console.error('❌ Failed:', error.message);
    }
}

testGemini();
