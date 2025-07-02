import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// Progressive pricing calculation based on trial days remaining
function calculateProgressivePricing(daysRemaining, isTrialUser, planTier = 'basic') {
    // For paid users, return their plan pricing
    if (!isTrialUser) {
        const basePrice = planTier === 'enterprise' ? 15.99 : 9.99;
        return {
            currentPrice: basePrice,
            regularPrice: basePrice,
            discount: 0,
            urgencyMessage: null,
            showDiscount: false
        };
    }
    
    // Progressive pricing strategy
    let currentPrice = 9.99;
    let discount = 0;
    let urgencyMessage = null;
    let showDiscount = false;
    
    // Progressive pricing strategy - price increases daily
    let nextDayPrice = null;
    
    if (daysRemaining === 5) {
        currentPrice = 6.99;
        discount = 3.00;
        nextDayPrice = 7.99;
        urgencyMessage = "Save $3.00 today - Price increases to $7.99 tomorrow!";
        showDiscount = true;
    } else if (daysRemaining === 6) {
        currentPrice = 7.99;
        discount = 2.00;
        nextDayPrice = 8.99;
        urgencyMessage = "Save $2.00 today - Price increases to $8.99 tomorrow!";
        showDiscount = true;
    } else if (daysRemaining === 7) {
        currentPrice = 8.99;
        discount = 1.00;
        nextDayPrice = 9.99;
        urgencyMessage = "Final discount! Save $1.00 - Full price $9.99 starts tomorrow!";
        showDiscount = true;
    } else if (daysRemaining <= 4 && daysRemaining > 0) {
        // Days 1-4: Show early bird messaging
        urgencyMessage = `Only ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left in your trial`;
        showDiscount = false;
    }
    
    return {
        currentPrice: currentPrice,
        regularPrice: 9.99,
        discount: discount,
        urgencyMessage: urgencyMessage,
        showDiscount: showDiscount,
        nextDayPrice: nextDayPrice,
        daysLeft: daysRemaining
    };
}

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
        
        // Get user from API key - now includes user_email
        const { data: apiKeyData, error: apiKeyError } = await supabase
            .from('api_keys')
            .select('user_id, user_email, is_active, created_at')
            .eq('api_key', apiKey)
            .eq('is_active', true)
            .single();
        
        if (apiKeyError || !apiKeyData) {
            console.error('API key lookup failed:', apiKeyError);
            return res.status(401).json({
                success: false,
                error: 'Invalid API key'
            });
        }
        
        const userId = apiKeyData.user_id;
        const userEmail = apiKeyData.user_email;
        
        // Get user usage and trial info
        const { data: usageData, error: usageError } = await supabase
            .from('user_usage')
            .select('plan, created_at, trial_ends_at, uploads_today, uploads_this_month, total_uploads')
            .eq('user_id', userId)
            .single();
        
        if (usageError) {
            console.error('Usage data lookup failed:', usageError);
            return res.status(404).json({
                success: false,
                error: 'User usage data not found'
            });
        }
        
        // Calculate trial status with debugging
        const now = new Date();
        const trialEnd = new Date(usageData.trial_ends_at);
        
        // Enhanced debug logging for trial time comparison
        console.log('===== TRIAL TIME DEBUG =====');
        console.log('Current time (server):', now.toISOString(), '| Timestamp:', now.getTime());
        console.log('Trial end time:', trialEnd.toISOString(), '| Timestamp:', trialEnd.getTime());
        console.log('Time difference (ms):', trialEnd.getTime() - now.getTime());
        console.log('Hours remaining:', (trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60));
        console.log('Days remaining (raw):', (trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        console.log('User plan:', usageData.plan);
        console.log('Trial end from DB:', usageData.trial_ends_at);
        
        // More precise trial expiration check - give a few minutes buffer
        const bufferMinutes = 5; // 5 minute buffer
        const trialEndWithBuffer = new Date(trialEnd.getTime() + (bufferMinutes * 60 * 1000));
        const isTrialExpired = now > trialEndWithBuffer;
        
        // Calculate days remaining more precisely for pricing logic
        const millisecondsRemaining = trialEnd.getTime() - now.getTime();
        const hoursRemaining = millisecondsRemaining / (1000 * 60 * 60);
        const daysRemainingFloat = millisecondsRemaining / (24 * 60 * 60 * 1000);
        const daysRemaining = Math.max(0, Math.ceil(daysRemainingFloat));
        
        // Use EXACT same logic as frontend for day calculation
        // Frontend: daysElapsed = totalDays - trialInfo.daysRemaining; Day = daysElapsed + 1
        const totalTrialDays = 7;
        const daysElapsed = totalTrialDays - daysRemaining;
        const currentTrialDay = daysElapsed + 1;
        
        console.log('📊 TRIAL CALCULATION DEBUG (SIMPLIFIED):');
        console.log('- Hours remaining:', hoursRemaining);
        console.log('- Days remaining (float):', daysRemainingFloat);
        console.log('- Days remaining (ceil):', daysRemaining);
        console.log('- Days elapsed:', daysElapsed);
        console.log('- Current trial day (1-7):', currentTrialDay);
        console.log('- Using currentTrialDay for pricing logic');
        
        // Check if user has a paid plan
        const isPaidPlan = usageData.plan === 'pro' || usageData.plan === 'basic' || usageData.plan === 'enterprise';
        
        // Determine plan tier for feature restrictions
        const isBasicPlan = usageData.plan === 'pro' || usageData.plan === 'basic'; // $9.99 plans
        const isEnterprisePlan = usageData.plan === 'enterprise'; // $15.99 plan
        
        const trialStatus = {
            isActive: !isTrialExpired && usageData.plan === 'trial',
            isExpired: isTrialExpired && usageData.plan === 'trial',
            daysRemaining: daysRemaining, // Keep original days remaining for frontend calculation
            endsAt: usageData.trial_ends_at,
            unlimited: isPaidPlan || (!isTrialExpired && usageData.plan === 'trial'),
            needsUpgrade: isTrialExpired && usageData.plan === 'trial'
        };
        
        // Calculate progressive pricing based on current trial day (5, 6, 7)
        const planTier = isEnterprisePlan ? 'enterprise' : (isBasicPlan ? 'basic' : 'trial');
        const pricingInfo = calculateProgressivePricing(currentTrialDay, usageData.plan === 'trial', planTier);
        
        // Debug final trial status
        console.log('===== FINAL TRIAL STATUS =====');
        console.log('isTrialExpired:', isTrialExpired);
        console.log('daysRemaining (time left):', daysRemaining);
        console.log('currentTrialDay (day 1-7):', currentTrialDay);
        console.log('isPaidPlan:', isPaidPlan);
        console.log('Progressive pricing:', JSON.stringify(pricingInfo, null, 2));
        console.log('Final trialStatus:', JSON.stringify(trialStatus, null, 2));
        console.log('===============================');
        
        res.json({
            success: true,
            user: {
                userId: userId,
                email: userEmail, // Use email from API key record
                plan: usageData.plan,
                planTier: isEnterprisePlan ? 'enterprise' : (isBasicPlan ? 'basic' : 'trial'),
                hasEnterpriseFeatures: isEnterprisePlan,
                memberSince: usageData.created_at
            },
            trial: trialStatus,
            pricing: pricingInfo,
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
