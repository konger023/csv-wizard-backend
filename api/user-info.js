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
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'Authorization header required'
            });
        }
        
        const apiKey = authHeader.substring(7);
        
        // Get user from API key - FIXED: removed 'plan' column
        const { data: apiKeyData, error: apiKeyError } = await supabase
            .from('api_keys')
            .select('user_id, is_active')  // ✅ Fixed: removed plan column
            .eq('api_key', apiKey)
            .eq('is_active', true)
            .single();
        
        if (apiKeyError || !apiKeyData) {
            return res.status(401).json({
                success: false,
                error: 'Invalid API key'
            });
        }
        
        const userId = apiKeyData.user_id;
        
        // Get user usage and trial info
        const { data: usageData, error: usageError } = await supabase
            .from('user_usage')
            .select('plan, created_at, trial_ends_at, uploads_today, uploads_this_month, total_uploads')
            .eq('user_id', userId)
            .single();
        
        if (usageError) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        // Calculate trial status
        const now = new Date();
        const trialEnd = new Date(usageData.trial_ends_at);
        const isTrialExpired = now > trialEnd;
        const daysRemaining = Math.max(0, Math.ceil((trialEnd - now) / (24 * 60 * 60 * 1000)));
        
        // Check if user has a paid plan
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
        console.error('User info error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get user info',
            message: error.message
        });
    }
}
