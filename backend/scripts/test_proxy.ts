
import { ProxyAgent, fetch as undiciFetch } from 'undici';
import dotenv from 'dotenv';
import path from 'path';

// Load .env
dotenv.config({ path: path.join(__dirname, '../.env') });

async function testProxy() {
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
    console.log(`\n🔍 Testing Proxy Configuration...`);
    console.log(`-----------------------------------`);
    console.log(`Proxy URL: ${proxyUrl || 'NOT SET (Direct Connection)'}`);

    if (!proxyUrl) {
        console.error('❌ HTTPS_PROXY is missing in .env');
        return;
    }

    try {
        console.log('Attempting to connect to Google via Proxy...');

        const dispatcher = new ProxyAgent(proxyUrl);
        const response = await undiciFetch('https://generativelanguage.googleapis.com/v1beta/models', {
            method: 'GET',
            dispatcher
        });

        console.log(`Response Status: ${response.status}`);

        if (response.ok) {
            console.log('✅ Proxy Connection SUCCESSFUL!');
            console.log('Google API is reachable.');
            const data = await response.json();
            console.log(`API returned: ${(JSON.stringify(data)).substring(0, 100)}...`);
        } else {
            console.log('❌ Proxy Reachable, but API returned error.');
            const text = await response.text();
            console.log(`Error Body: ${text}`);
            // 400 or 403 might happen if no key provided, but connection worked.
            // Actually without key it returns error, but proves connectivity.
        }

    } catch (error: any) {
        console.error('❌ Proxy Connection FAILED');
        console.error('Error Details:', error.message);
        console.error('-----------------------------------');
        console.error('Possible Causes:');
        console.error('1. Wrong Port: Is your VPN definitely on port 7890? (Check Settings -> Connection)');
        console.error('2. Wrong Protocol: Is it an HTTP proxy? (Some use SOCKS5, needing socks-proxy-agent)');
        console.error('3. VPN not running: Is the VPN software actually open?');
    }
}

testProxy();
