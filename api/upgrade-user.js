import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
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
        const { email, newPlan, adminKey } = req.body;
        
        // Basic validation
        if (!email || !newPlan) {
            return res.status(400).json({
                success: false,
                error: 'Email and newPlan are required'
            });
        }
        
        // Admin key validation (simple security)
        const expectedAdminKey = process.env.ADMIN_UPGRADE_KEY || 'csv-wizard-admin-2024';
        if (adminKey !== expectedAdminKey) {
            return res.status(401).json({
                success: false,
                error: 'Invalid admin key'
            });
        }
        
        // Validate plan options
        const validPlans = ['trial', 'basic', 'pro', 'enterprise'];
        if (!validPlans.includes(newPlan)) {
            return res.status(400).json({
                success: false,
                error: `Invalid plan. Must be one of: ${validPlans.join(', ')}`
            });
        }
        
        console.log(`🔄 Upgrading user ${email} to ${newPlan} plan...`);
        
        // Find user by email
        const { data: apiKeyData, error: apiKeyError } = await supabase
            .from('api_keys')
            .select('user_id, user_email')
            .eq('user_email', email)
            .eq('is_active', true)
            .single();
        
        if (apiKeyError || !apiKeyData) {
            console.error('User lookup failed:', apiKeyError);
            return res.status(404).json({
                success: false,
                error: 'User not found with that email'
            });
        }
        
        const userId = apiKeyData.user_id;
        
        // Get current user usage data
        const { data: currentUsage, error: usageError } = await supabase
            .from('user_usage')
            .select('plan, trial_ends_at, created_at')
            .eq('user_id', userId)
            .single();
        
        if (usageError || !currentUsage) {
            console.error('Usage lookup failed:', usageError);
            return res.status(404).json({
                success: false,
                error: 'User usage data not found'
            });
        }
        
        // Prepare update data
        const updateData = {
            plan: newPlan,
            updated_at: new Date().toISOString()
        };
        
        // If upgrading from trial to paid, extend or nullify trial end date
        if (currentUsage.plan === 'trial' && newPlan !== 'trial') {
            // Set trial end to far future (essentially unlimited)
            const farFuture = new Date();
            farFuture.setFullYear(farFuture.getFullYear() + 10);
            updateData.trial_ends_at = farFuture.toISOString();
            console.log('📅 Extended trial end date for paid user');
        }
        
        // Update user plan
        const { data: updatedUser, error: updateError } = await supabase
            .from('user_usage')
            .update(updateData)
            .eq('user_id', userId)
            .select()
            .single();
        
        if (updateError) {
            console.error('❌ Failed to update user plan:', updateError);
            return res.status(500).json({
                success: false,
                error: 'Failed to update user plan: ' + updateError.message
            });
        }
        
        console.log('✅ User plan updated successfully');
        
        // Log the upgrade for audit trail
        console.log(`📊 PLAN UPGRADE LOG: ${email} (${userId}) upgraded from ${currentUsage.plan} to ${newPlan} at ${new Date().toISOString()}`);
        
        res.json({
            success: true,
            message: `User ${email} successfully upgraded to ${newPlan} plan`,
            user: {
                email: email,
                userId: userId,
                previousPlan: currentUsage.plan,
                newPlan: newPlan,
                upgradedAt: updateData.updated_at
            }
        });
        
    } catch (error) {
        console.error('Plan upgrade error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to upgrade user plan',
            message: error.message
        });
    }
}
