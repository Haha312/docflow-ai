const fetch = require('node-fetch');

async function testBackend() {
    console.log('🧪 DocuFlow AI 后端功能测试\n');
    console.log('='.repeat(50));

    let authToken = '';
    let userId = '';

    // 1. 健康检查
    console.log('\n1️⃣ 测试健康检查...');
    try {
        const response = await fetch('http://localhost:3001/health');
        const data = await response.json();
        console.log('✅ 健康检查通过:', data);
    } catch (error) {
        console.log('❌ 健康检查失败:', error.message);
        return;
    }

    // 2. 用户注册
    console.log('\n2️⃣ 测试用户注册...');
    try {
        const email = `test${Date.now()}@docuflow.ai`;
        const response = await fetch('http://localhost:3001/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: 'test123456' })
        });
        const data = await response.json();

        if (data.code === 201) {
            userId = data.data.id;
            console.log('✅ 注册成功:', { email, userId });
        } else {
            console.log('❌ 注册失败:', data.message);
            return;
        }
    } catch (error) {
        console.log('❌ 注册失败:', error.message);
        return;
    }

    // 等待一下
    await new Promise(resolve => setTimeout(resolve, 500));

    // 3. 用户登录
    console.log('\n3️⃣ 测试用户登录...');
    try {
        const email = `test${Date.now() - 500}@docuflow.ai`;
        const response = await fetch('http://localhost:3001/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: 'test123456' })
        });
        const data = await response.json();

        if (data.code === 200) {
            authToken = data.data.token;
            console.log('✅ 登录成功');
            console.log('   Token:', authToken.substring(0, 20) + '...');
        } else {
            console.log('❌ 登录失败:', data.message);
            return;
        }
    } catch (error) {
        console.log('❌ 登录失败:', error.message);
        return;
    }

    // 4. 获取用户信息
    console.log('\n4️⃣ 测试获取用户信息...');
    try {
        const response = await fetch('http://localhost:3001/api/auth/me', {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        const data = await response.json();

        if (data.code === 200) {
            console.log('✅ 获取用户信息成功:');
            console.log('   用户:', data.data.user.email);
            console.log('   订阅状态:', data.data.user.subscriptionStatus);
            console.log('   剩余额度:', data.data.remainingQuota);
        } else {
            console.log('❌ 获取用户信息失败:', data.message);
        }
    } catch (error) {
        console.log('❌ 获取用户信息失败:', error.message);
    }

    // 5. 测试文档生成 (简单测试,不实际生成)
    console.log('\n5️⃣ 测试文档生成接口...');
    try {
        const response = await fetch('http://localhost:3001/api/generate', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content: '<p>测试内容</p>',
                preset: 'minimalist',
                fileName: 'test.docx',
                styleConfig: {
                    fontFamily: 'SimSun',
                    baseSize: '16px',
                    lineHeight: '1.5',
                    headingFont: 'SimHei',
                    headingNumbering: 'decimal',
                    bodyAlign: 'justify',
                    textIndent: '2em',
                    spacingBefore: '0.5em',
                    spacingAfter: '0.5em',
                    h1Size: '24px',
                    h1Bold: true,
                    h1Italic: false,
                    h1Align: 'center',
                    h1Indent: '0',
                    h2Size: '20px',
                    h2Bold: true,
                    h2Italic: false,
                    h2Align: 'left',
                    h2Indent: '0',
                    h3Size: '18px',
                    h3Bold: true,
                    h3Italic: false,
                    h3Indent: '0',
                    h4Size: '16px',
                    h4Bold: true,
                    h4Italic: false,
                    h4Indent: '0',
                    tableFont: 'SimSun',
                    tableSize: '14px',
                    tableCaptionFont: 'SimHei',
                    tableCaptionSize: '14px',
                    tableCaptionAlign: 'center',
                    tableNumbering: 'arabic',
                    figureFont: 'SimSun',
                    figureSize: '14px',
                    figureNumbering: 'arabic'
                }
            })
        });

        if (response.headers.get('content-type')?.includes('text/event-stream')) {
            console.log('✅ 文档生成接口响应正常 (SSE 流)');
            console.log('   注意: 实际生成需要有效的 GOOGLE_API_KEY');
        } else {
            const data = await response.json();
            if (data.code === 500 && data.message.includes('GOOGLE_API_KEY')) {
                console.log('⚠️  文档生成接口正常,但缺少 GOOGLE_API_KEY');
            } else {
                console.log('❌ 文档生成失败:', data.message);
            }
        }
    } catch (error) {
        console.log('❌ 文档生成失败:', error.message);
    }

    // 6. 测试支付接口 (Stripe)
    console.log('\n6️⃣ 测试 Stripe 支付接口...');
    try {
        const response = await fetch('http://localhost:3001/api/payment/create-checkout-session', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                planType: 'monthly',
                paymentMethod: 'stripe'
            })
        });
        const data = await response.json();

        if (data.code === 503) {
            console.log('⚠️  Stripe 未配置 (符合预期)');
        } else if (data.code === 200) {
            console.log('✅ Stripe 支付接口正常');
            console.log('   Session ID:', data.data.sessionId);
        } else {
            console.log('❌ Stripe 支付失败:', data.message);
        }
    } catch (error) {
        console.log('❌ Stripe 支付失败:', error.message);
    }

    // 7. 测试支付接口 (支付宝)
    console.log('\n7️⃣ 测试支付宝支付接口...');
    try {
        const response = await fetch('http://localhost:3001/api/payment/create-checkout-session', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                planType: 'monthly',
                paymentMethod: 'alipay'
            })
        });
        const data = await response.json();

        if (data.code === 503) {
            console.log('⚠️  支付宝未配置 (符合预期)');
        } else if (data.code === 200) {
            console.log('✅ 支付宝支付接口正常');
            console.log('   Order ID:', data.data.orderId);
        } else {
            console.log('❌ 支付宝支付失败:', data.message);
        }
    } catch (error) {
        console.log('❌ 支付宝支付失败:', error.message);
    }

    // 8. 测试未认证访问
    console.log('\n8️⃣ 测试未认证访问保护...');
    try {
        const response = await fetch('http://localhost:3001/api/auth/me');
        const data = await response.json();

        if (data.code === 401) {
            console.log('✅ 认证保护正常工作');
        } else {
            console.log('❌ 认证保护失败');
        }
    } catch (error) {
        console.log('❌ 测试失败:', error.message);
    }

    console.log('\n' + '='.repeat(50));
    console.log('✅ 后端功能测试完成!\n');
}

testBackend().catch(console.error);
