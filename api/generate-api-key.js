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
        console.log('Environment check:');
        console.log('- SUPABASE_URL exists:', !!process.env.SUPABASE_URL);
        console.log('- SUPABASE_SERVICE_KEY exists:', !!process.env.SUPABASE_SERVICE_KEY);
        console.log('- SUPABASE_URL value:', process.env.SUPABASE_URL);
        
        const { email, googleData } = req.body;
        console.log('Request data:', { email, googleData });
        
        if (!email) {
            return res.status(400).json({ success: false, error: 'Email required' });
        }
        
        // Try to import Supabase
        console.log('📦 Importing Supabase...');
        const { createClient } = await import('@supabase/supabase-js');
        console.log('✅ Supabase imported successfully');
        
        // Try to create Supabase client
        console.log('🔗 Creating Supabase client...');
        const supabase = createClient(
            process.env.SUPABASE_URL,
            process.env.SUPABASE_SERVICE_KEY
        );
        console.log('✅ Supabase client created');
        
        // Test simple connection
        console.log('🧪 Testing Supabase connection...');
        const { data: testData, error: testError } = await supabase
            .from('api_keys')
            .select('count')
            .limit(1);
            
        if (testError) {
            console.error('❌ Supabase connection test failed:', testError);
            throw new Error(`Supabase connection failed: ${testError.message}`);
        }
        
        console.log('✅ Supabase connection successful');
        
        // Generate API key
        const apiKey = generateApiKey(email);
        console.log('✅ API key generated:', apiKey.substring(0, 20) + '...');
        
        // Create user ID
        const userId = `user_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        
        // Save API key to database
        console.log('💾 Saving API key to database...');
        const { error: apiKeyInsertError } = await supabase
            .from('api_keys')
            .insert({
                user_id: userId,
                api_key: apiKey,
                is_active: true
            });
            
        if (apiKeyInsertError) {
            console.error('❌ Failed to save API key:', apiKeyInsertError);
            throw new Error(`Failed to save API key: ${apiKeyInsertError.message}`);
        }
        
        // Save user usage info
        console.log('👤 Creating user usage record...');
        const trialEndDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const { error: usageInsertError } = await supabase
            .from('user_usage')
            .insert({
                user_id: userId,
                plan: 'trial',
                trial_ends_at: trialEndDate.toISOString(),
                uploads_today: 0,
                uploads_this_month: 0,
                total_uploads: 0
            });
            
        if (usageInsertError) {
            console.error('❌ Failed to save user usage:', usageInsertError);
            throw new Error(`Failed to save user usage: ${usageInsertError.message}`);
        }
        
        console.log('✅ Database records created successfully');
        
        return res.status(200).json({
            success: true,
            apiKey: apiKey,
            user: {
                email: email,
                name: googleData?.name || email.split('@')[0],
                picture: googleData?.picture || null,
                userId: 'test-user-id'
            },
            trial: {
                isActive: true,
                daysRemaining: 7,
                unlimited: true,
                expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
            }
        });
        
    } catch (error) {
        console.error('❌ API Key generation failed:', error);
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        
        return res.status(500).json({
            success: false,
            error: 'API key generation failed: ' + error.message,
            details: error.stack
        });
    }
}

function generateApiKey(email) {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 15);
    const emailHash = Buffer.from(email).toString('base64').substring(0, 8);
    
    return `csvw_${emailHash}_${timestamp}_${randomStr}`;
}
