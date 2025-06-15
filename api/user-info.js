import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    
    if (req.method !== 'GET') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed - use GET'
        });
    }
    
    try {
        console.log('📊 User info request received');
        console.log('Headers:', JSON.stringify(req.headers, null, 2));
        
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log('❌ Missing or invalid auth header');
            return res.status(401).json({
                success: false,
                error: 'Authorization header required'
            });
        }
        
        const apiKey = authHeader.substring(7);
        console.log('🔑 API key received:', apiKey.substring(0, 20) + '...');
        
        // Debug: Check if API key exists in database
        console.log('🔍 Looking up API key in database...');
        const { data: apiKeyData, error: apiKeyError } = await supabase
            .from('api_keys')
            .select('user_id, plan, is_active')
            .eq('api_key', apiKey)
            .eq('is_active', true)
            .single();
        
        console.log('📦 API key lookup result:', {
            data: apiKeyData,
            error: apiKeyError
        });
        
        if (apiKeyError || !apiKeyData) {
            console.log('❌ API key not found in database');
            
            // Debug: Let's see what API keys ARE in the database
            const { data: allKeys } = await supabase
                .from('api_keys')
                .select('api_key, user_id, is_active')
                .limit(5);
            
            console.log('🗂️ Sample API keys in database:', allKeys);
            
            return res.status(401).json({
                success: false,
                error: 'Invalid API key - not found in database',
                debug: {
                    apiKeyReceived: apiKey.substring(0, 20) + '...',
                    apiKeysInDb: allKeys?.length || 0
                }
            });
        }
        
        const userId = apiKeyData.user_id;
        console.log('✅ Found user ID:', userId);
        
        // Get user usage and trial info
        console.log('📊 Looking up user usage...');
        const { data: usageData, error: usageError } = await supabase
            .from('user_usage')
            .select('plan, created_at, trial_ends_at, uploads_today, uploads_this_month, total_uploads')
            .eq('user_id', userId)
            .single();
        
        console.log('📦 User usage result:', {
            data: usageData,
            error: usageError
        });
        
        if (usageError) {
            console.log('❌ User usage not found');
            return res.status(404).json({
                success: false,
                error: 'User usage data not found',
                debug: { userId, usageError }
            });
        }
        
        // Calculate trial status
        const now = new Date();
        const trialEnd = new Date(usageData.trial_ends_at);
        const isTrialExpired = now > trialEnd;
        const daysRemaining = Math.max(0, Math.ceil((trialEnd - now) / (24 * 60 * 60 * 1000)));
        
        const isPaidPlan = usageData.plan === 'pro' || usageData.plan === 'basic';
        
        const trialStatus = {
            isActive: !isTrialExpired && usageData.plan === 'trial',
            isExpired: isTrialExpired && usageData.plan === 'trial',
            daysRemaining: daysRemaining,
            endsAt: usageData.trial_ends_at,
            unlimited: isPaidPlan || (!isTrialExpired && usageData.plan === 'trial'),
            needsUpgrade: isTrialExpired && usageData.plan === 'trial'
        };
        
        // Get user email from auth
        const { data: authUser } = await supabase.auth.admin.getUserById(userId);
        
        console.log('✅ Sending successful response');
        res.json({
            success: true,
            user: {
                userId: userId,
                email: authUser?.user?.email || null,
                plan: usageData.plan,
                memberSince: usageData.created_at
            },
            trial: trialStatus,
            usage: {
                today: usageData.uploads_today || 0,
                thisMonth: usageData.uploads_this_month || 0,
                total: usageData.total_uploads || 0,
                unlimited: trialStatus.unlimited
            }
        });
        
    } catch (error) {
        console.error('❌ User info error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get user info',
            message: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
}
