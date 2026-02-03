require('dotenv').config();
const OpenAI = require('openai');

async function listModels() {
    console.log('🚀 Listing Models from:', process.env.GEMINI_OPENAI_BASE_URL);

    if (!process.env.GEMINI_OPENAI_BASE_URL) {
        console.error('❌ Base URL not set');
        return;
    }

    const client = new OpenAI({
        apiKey: process.env.GOOGLE_API_KEY,
        baseURL: process.env.GEMINI_OPENAI_BASE_URL
    });

    try {
        const list = await client.models.list();
        console.log('✅ Available Models:');
        list.data.forEach(m => console.log(` - ${m.id}`));
    } catch (error) {
        console.error('❌ Failed to list models:', error.message);
    }
}

listModels();
