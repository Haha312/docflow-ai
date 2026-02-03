const fetch = require('node-fetch');

async function createTestUsers() {
    console.log('🚀 Creating Test Users...');

    const users = [
        { email: 'user1@docuflow.ai', password: 'password123' },
        { email: 'user2@docuflow.ai', password: 'password123' }
    ];

    for (const user of users) {
        try {
            const response = await fetch('http://localhost:3001/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(user)
            });

            const data = await response.json();

            if (response.ok && data.code === 201) {
                console.log(`✅ Created: ${user.email} (ID: ${data.data.id})`);
            } else {
                if (data.message && data.message.includes('already exists')) {
                    console.log(`⚠️  User exists: ${user.email}`);
                } else {
                    console.log(`❌ Failed to create ${user.email}:`, data.message || response.statusText);
                }
            }
        } catch (error) {
            console.error(`❌ Error creating ${user.email}:`, error.message);
        }
    }
}

createTestUsers();
