import crypto from 'crypto';
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
    
    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed - use POST'
        });
    }
    
    try {
        const { email, googleData } = req.body;
        
        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }
        
        console.log('🔑 Generating API key for trial user:', email);
        
        // Create or get user
        const { data: userData, error: userError } = await supabase.auth.admin.createUser({
            email: email,
            email_confirm: true,
            user_metadata: googleData || {}
        });
        
        if (userError && !userError.message.includes('already registered')) {
            throw userError;
        }
        
        // Get existing user if creation failed due to existing user
        let userId = userData?.user?.id;
        if (!userId) {
            const { data: existingUser } = await supabase.auth.admin.getUserByEmail(email);
            userId = existingUser?.user?.id;
        }
        
        if (!userId) {
            throw new Error('Failed to create or find user');
        }
        
        // Generate unique API key
        const apiKey = 'csv_' + crypto.randomBytes(32).toString('hex');
        
        // Store API key with trial plan
        const { data: apiKeyData, error: apiKeyError } = await supabase
            .from('api_keys')
            .upsert({
                user_id: userId,
                api_key: apiKey,
                plan: 'trial',
                is_active: true,
                created_at: new Date().toISOString()
            }, {
                onConflict: 'user_id'
            });
        
        if (apiKeyError) {
            throw apiKeyError;
        }
        
        // Create user profile with 7-day trial
        const trialStartDate = new Date();
        const trialEndDate = new Date(trialStartDate.getTime() + (7 * 24 * 60 * 60 * 1000));
        
        await supabase
            .from('user_usage')
            .upsert({
                user_id: userId,
                plan: 'trial',
                created_at: trialStartDate.toISOString(),
                trial_ends_at: trialEndDate.toISOString(),
                uploads_today: 0,
                uploads_this_month: 0,
                total_uploads: 0
            }, {
                onConflict: 'user_id'
            });
        
        res.json({
            success: true,
            apiKey: apiKey,
            userId: userId,
            plan: 'trial',
            trialDaysRemaining: 7,
            trialEndsAt: trialEndDate.toISOString(),
            unlimited: true
        });
        
    } catch (error) {
        console.error('Error generating API key:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate API key',
            message: error.message
        });
    }
}
