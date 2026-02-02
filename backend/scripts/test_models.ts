
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from backend .env
dotenv.config({ path: path.join(__dirname, '../.env') });

async function listModels() {
    const apiKey = process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        console.error('❌ No GOOGLE_API_KEY found in .env');
        process.exit(1);
    }
    console.log('Using API Key:', apiKey.substring(0, 10) + '...');

    const ai = new GoogleGenAI({ apiKey });

    try {
        console.log('Fetching available models...');
        // Note: The SDK might store models under ai.models
        // Using raw request approach if SDK typings are obscure, but let's try standard list
        // Based on docs: ai.models.list()

        // However, looking at @google/genai usage in generate.ts:
        // const ai = new GoogleGenAI({ apiKey });
        // const responseStream = await ai.models.generateContentStream(...)

        // Usually list models is via specific endpoint. 
        // Let's try to infer from common practices or use a direct rest call if needed.
        // But for this SDK (GoogleGenAI Web SDK or Node SDK?), usually it is not directly exposed 
        // in the main class in some versions.
        // Actually, for '@google/genai' (Vertex vs Studio), let's assume it has a method or we treat it as 1.5.0

        // Wait, @google/genai is the new SDK.
        // It might be `ai.models.list()`

        // Let's try to run a simple generate with a very standard model to verify connectivity first,
        // and if that fails, we know it's not the model name.
        // actually, let's just attempt to use a standard model 'gemini-1.5-flash' in this script.

        const modelsToCheck = [
            'gemini-1.5-flash',
            'gemini-1.5-pro',
            'gemini-2.0-flash-exp',
            'gemini-pro'
        ];

        console.log('\nTesting Model Availability:');
        for (const model of modelsToCheck) {
            try {
                process.stdout.write(`Testing ${model}... `);
                await ai.models.generateContent({
                    model: model,
                    contents: [{ role: 'user', parts: [{ text: 'Hi' }] }]
                });
                console.log('✅ AVAILABLE');
            } catch (e: any) {
                if (e.message?.includes('404') || e.message?.includes('not found')) {
                    console.log('❌ NOT FOUND');
                } else {
                    console.log(`⚠️ ERROR: ${e.message.split('\n')[0]}`);
                }
            }
        }

    } catch (error) {
        console.error('Error listing models:', error);
    }
}

listModels();
