// Complete API Key Generation with Trial Security Fix
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
            error: 'Method not allowed'
        });
    }
    
    try {
        const { email, googleData } = req.body;
        
        if (!email || !googleData) {
            return res.status(400).json({
                success: false,
                error: 'Email and Google data are required'
            });
        }
        
        console.log('🔑 API key generation request for:', email);
        
        // SECURITY FIX: Check if user already exists by email
        const { data: existingUser, error: existingError } = await supabase
            .from('api_keys')
            .select('api_key, user_id, created_at')
            .eq('user_email', email)
            .eq('is_active', true)
            .single();
        
        if (existingUser && !existingError) {
            console.log('👤 Returning existing user API key (no trial reset)');
            
            // Get existing trial status
            const { data: existingUsage, error: usageError } = await supabase
                .from('user_usage')
                .select('*')
                .eq('user_id', existingUser.user_id)
                .single();
            
            if (existingUsage && !usageError) {
                const now = new Date();
                const trialEnd = new Date(existingUsage.trial_ends_at);
                const daysRemaining = Math.max(0, Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24)));
                const isActive = now <= trialEnd;
                
                return res.json({
                    success: true,
                    apiKey: existingUser.api_key,
                    isNewUser: false,
                    trial: {
                        isActive: isActive,
                        daysRemaining: daysRemaining,
                        endDate: existingUsage.trial_ends_at,
                        plan: existingUsage.plan || 'trial',
                        totalUploads: existingUsage.total_uploads || 0
                    },
                    user: {
                        email: email,
                        name: googleData.name,
                        registeredAt: existingUser.created_at
                    }
                });
            }
        }
        
        // New user - create API key and trial
        console.log('🆕 Creating new user with 7-day trial');
        
        // Generate proper UUID for user_id
        const userId = crypto.randomUUID();
        
        // Generate API key
        const timestamp = Date.now();
        const randomStr = Math.random().toString(36).substring(2, 15);
        const apiKey = `csvw_${userId.substring(0, 8)}_${timestamp}_${randomStr}`;
        
        console.log('🆔 Generated UUID:', userId);
        console.log('🔑 Generated API key:', apiKey.substring(0, 20) + '...');
        
        // Insert API key record
        const { data: apiKeyRecord, error: apiKeyError } = await supabase
            .from('api_keys')
            .insert({
                user_id: userId,
                api_key: apiKey,
                user_email: email,
                is_active: true,
                created_at: new Date().toISOString()
            })
            .select()
            .single();
        
        if (apiKeyError) {
            console.error('❌ Failed to save API key:', apiKeyError);
            throw new Error('Failed to save API key: ' + apiKeyError.message);
        }
        
        console.log('✅ API key saved successfully');
        
        // Create user usage record with 7-day trial
        const trialEndDate = new Date();
        trialEndDate.setDate(trialEndDate.getDate() + 7); // 7 days from now
        
        const { data: usageRecord, error: usageError } = await supabase
            .from('user_usage')
            .insert({
                user_id: userId,
                user_email: email,
                plan: 'trial',
                trial_ends_at: trialEndDate.toISOString(),
                uploads_today: 0,
                uploads_this_month: 0,
                total_uploads: 0,
                created_at: new Date().toISOString()
            })
            .select()
            .single();
        
        if (usageError) {
            console.error('❌ Failed to create usage record:', usageError);
            
            // Clean up API key if usage creation fails
            await supabase
                .from('api_keys')
                .delete()
                .eq('user_id', userId);
                
            throw new Error('Failed to create user trial: ' + usageError.message);
        }
        
        console.log('✅ Trial created successfully, expires:', trialEndDate.toISOString());
        
        // Return success response
        res.json({
            success: true,
            apiKey: apiKey,
            isNewUser: true,
            trial: {
                isActive: true,
                daysRemaining: 7,
                endDate: trialEndDate.toISOString(),
                plan: 'trial',
                totalUploads: 0,
                unlimited: true // During trial
            },
            user: {
                email: email,
                name: googleData.name || 'User',
                picture: googleData.picture,
                registeredAt: new Date().toISOString()
            },
            message: 'Account created successfully with 7-day free trial'
        });
        
    } catch (error) {
        console.error('❌ API key generation failed:', error);
        res.status(500).json({
            success: false,
            error: 'API key generation failed: ' + error.message
        });
    }
}
