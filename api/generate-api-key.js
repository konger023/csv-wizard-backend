import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

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
        
        const { email, googleData } = req.body;
        console.log('Request data:', { email, googleDataName: googleData?.name });
        
        if (!email) {
            return res.status(400).json({ success: false, error: 'Email required' });
        }
        
        // Check if user already exists
        console.log('🔍 Checking for existing user...');
        const { data: existingApiKey, error: checkError } = await supabase
            .from('api_keys')
            .select('api_key, user_id, is_active')
            .eq('user_email', email) // Assuming you have user_email column, or we'll use a different approach
            .eq('is_active', true)
            .single();
            
        if (existingApiKey && !checkError) {
            console.log('✅ Found existing active API key for user');
            
            // Get user usage info
            const { data: usageData } = await supabase
                .from('user_usage')
                .select('*')
                .eq('user_id', existingApiKey.user_id)
                .single();
                
            const trialEnd = new Date(usageData?.trial_ends_at);
            const now = new Date();
            const daysRemaining = Math.max(0, Math.ceil((trialEnd - now) / (24 * 60 * 60 * 1000)));
            
            return res.status(200).json({
                success: true,
                apiKey: existingApiKey.api_key,
                user: {
                    email: email,
                    name: googleData?.name || email.split('@')[0],
                    picture: googleData?.picture || null,
                    userId: existingApiKey.user_id
                },
                trial: {
                    isActive: usageData?.plan === 'trial' && now < trialEnd,
                    daysRemaining: daysRemaining,
                    unlimited: true,
                    expiresAt: usageData?.trial_ends_at
                }
            });
        }
        
        // Generate new user and API key
        console.log('👤 Creating new user...');
        
        // Generate proper UUID for user_id
        const userId = randomUUID();
        console.log('🆔 Generated UUID:', userId);
        
        // Generate API key
        const apiKey = generateApiKey(email);
        console.log('🔑 API key generated:', apiKey.substring(0, 20) + '...');
        
        // Save API key to database (with user_email for easier lookup)
        console.log('💾 Saving API key to database...');
        const { error: apiKeyInsertError } = await supabase
            .from('api_keys')
            .insert({
                user_id: userId,
                api_key: apiKey,
                user_email: email, // Add email for easier lookups
                is_active: true,
                created_at: new Date().toISOString()
            });
            
        if (apiKeyInsertError) {
            console.error('❌ Failed to save API key:', apiKeyInsertError);
            throw new Error(`Failed to save API key: ${apiKeyInsertError.message}`);
        }
        
        // Save user usage info
        console.log('📊 Creating user usage record...');
        const trialEndDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const { error: usageInsertError } = await supabase
            .from('user_usage')
            .insert({
                user_id: userId,
                user_email: email, // Add email here too
                plan: 'trial',
                trial_ends_at: trialEndDate.toISOString(),
                uploads_today: 0,
                uploads_this_month: 0,
                total_uploads: 0,
                created_at: new Date().toISOString()
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
                userId: userId
            },
            trial: {
                isActive: true,
                daysRemaining: 7,
                unlimited: true,
                expiresAt: trialEndDate.toISOString()
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
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}

function generateApiKey(email) {
    const timestamp = Date.now();
    const randomStr = Math.random().toString(36).substring(2, 15);
    const emailHash = Buffer.from(email).toString('base64').substring(0, 8);
    
    return `csvw_${emailHash}_${timestamp}_${randomStr}`;
}
