// Let's create a robust backend API endpoint for generating API keys
// This should go in your Vercel backend at /api/generate-api-key.js

export default async function handler(req, res) {
    // Add CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    // Handle preflight requests
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }
    
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed'
        });
    }
    
    try {
        console.log('🚀 API Key generation request received');
        console.log('Request body:', JSON.stringify(req.body, null, 2));
        
        const { email, googleData } = req.body;
        
        // Validate required fields
        if (!email) {
            console.error('❌ Missing email in request');
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }
        
        if (!email.includes('@')) {
            console.error('❌ Invalid email format:', email);
            return res.status(400).json({
                success: false,
                error: 'Invalid email format'
            });
        }
        
        console.log('✅ Email validation passed:', email);
        
        // Generate a simple API key (you can make this more sophisticated)
        const apiKey = generateApiKey(email);
        console.log('✅ API key generated');
        
        // Here you would typically:
        // 1. Save user to database
        // 2. Initialize trial period
        // 3. Set up user account
        
        // For now, we'll return a success response
        const responseData = {
            success: true,
            apiKey: apiKey,
            user: {
                email: email,
                name: googleData?.name || email.split('@')[0],
                picture: googleData?.picture || null,
                createdAt: new Date().toISOString()
            },
            trial: {
                isActive: true,
                daysRemaining: 7,
                unlimited: true,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            }
        };
        
        console.log('✅ Sending successful response');
        return res.status(200).json(responseData);
        
    } catch (error) {
        console.error('❌ API Key generation failed:', error);
        console.error('Error stack:', error.stack);
        
        return res.status(500).json({
            success: false,
            error: 'Internal server error: ' + error.message,
            timestamp: new Date().toISOString()
        });
    }
}

// Helper function to generate API key
function generateApiKey(email) {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 15);
    const emailHash = Buffer.from(email).toString('base64').substring(0, 8);
    
    return `csvw_${emailHash}_${timestamp}_${randomStr}`;
}

// Alternative simpler version if the above doesn't work
function generateSimpleApiKey() {
    return 'csvw_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15);
}
